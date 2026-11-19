import fs from 'node:fs';
import path from 'node:path';
import { run, env, tmuxRun, socket, providerOf, repository, validHost, quote } from './core.mjs';
import { providerProcessArguments, claudeProcessSession } from './provider-process.mjs';

export async function scanTmux(targetSocket=socket,runner=tmuxRun,processRunner=run){
  try{const {stdout}=await runner(['list-panes','-a','-F','#{session_id}\t#{session_name}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_tty}\t#{pane_id}\t#{pane_dead}\t#{pid}\t#{pane_pid}'],targetSocket);const rows=await identifyTmuxPanes(parseTmuxPanes(stdout,targetSocket),processRunner),healthy=rows.every(row=>row.processInspectionHealthy);return{rows,healthy,warnings:healthy?[]:['Some terminal processes could not be inspected; their state is unknown.']};}
  catch(error){const absent=/no server running|no sessions|error connecting.*No such file|failed to connect.*No such file/i.test(error.stderr || '');return{rows:[],healthy:absent,warnings:absent?[]:['tmux scan unavailable: '+error.message]};}
}
export async function tmuxSessions(targetSocket = socket) {return (await scanTmux(targetSocket)).rows;}
export const localPaneId = pane => `tmux:${pane.socket?'managed:':''}${pane.pane}`;

export function parseTmuxPanes(stdout, targetSocket = socket) {
  return String(stdout || '').split('\n').flatMap(line => {
    const fields = line.replace(/\r$/, '').split('\t');
    if (![7, 8, 9].includes(fields.length)) return [];
    const [target, name, cwd, command, tty, pane, dead, serverPid, panePid] = fields;
    if (!/^\$\d+$/.test(target) || !/^%\d+$/.test(pane) || !name || !['0','1'].includes(dead)) return [];
    return [{ target, name, cwd, command, tty, pane, dead: dead === '1', socket: targetSocket, ...(serverPid && /^\d+$/.test(serverPid) && Number(serverPid) > 1 ? { serverPid: Number(serverPid) } : {}),...(panePid&&/^\d+$/.test(panePid)&&Number(panePid)>1?{panePid:Number(panePid)}:{}) }];
  });
}
export async function identifyTmuxPanes(panes, runner = run) {
  const identities = new Map();
  let processes=[],processInspectionHealthy=true;
  if(panes.some(p=>p.panePid))try{processes=(await runner('ps',['-axo','pid=,ppid=,comm='],{timeout:1500,env})).stdout.split('\n').flatMap(line=>{const match=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);return match?[{pid:Number(match[1]),ppid:Number(match[2]),command:path.basename(match[3])}]:[];});}catch{processInspectionHealthy=false;}
  await Promise.all([...new Set(panes.map(p => p.serverPid).filter(Number.isSafeInteger))].map(async pid => {
    try {
      const started = (await runner('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 1500, env: { ...env, LC_ALL: 'C' } })).stdout.trim();
      if (Number.isFinite(Date.parse(started))) identities.set(pid, `${pid}:${new Date(started).toISOString()}`);
    } catch { /* Missing identity remains explicit; a pane ID is not sufficient. */ }
  }));
  return panes.map(p => {
    const descendants=new Set([p.panePid]);
    for(let depth=0;depth<32;depth++){const before=descendants.size;for(const process of processes)if(descendants.has(process.ppid))descendants.add(process.pid);if(descendants.size===before)break;}
    return { ...p, serverIdentity: identities.get(p.serverPid) || null,processInspectionHealthy:p.dead || (processInspectionHealthy&&processes.some(process=>process.pid===p.panePid)),processCommands:processes.filter(process=>descendants.has(process.pid)&&['ssh','codex','claude','grok'].includes(process.command)).map(process=>process.command) };
  });
}
export function terminalTty(value) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/^\/dev\//, '') : null;
}
export async function externalTerminals(excludeTtys = [],{strict=false,runner=run,onWarning=()=>{}}={}) {
  const excluded = new Set(excludeTtys.map(terminalTty).filter(Boolean));
  let stdout;
  try { ({ stdout } = await runner('ps', ['-axo', 'pid=,ppid=,tty=,stat=,comm='], { timeout: 3000 })); } catch(error) {if(strict)throw error;return [];}
  const byTty = new Map();
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!m || m[4].startsWith('Z') || excluded.has(m[3])) continue;
    const [pid, ppid, tty, state, command] = m.slice(1);
    if ((tty === '?' || tty === '??') && !['codex', 'claude', 'grok'].includes(path.basename(command))) continue;
    const name = path.basename(command);
    if (!['codex', 'claude', 'grok', 'zsh', 'bash', 'fish', 'ssh'].includes(name)) continue;
    const score = ['codex', 'claude', 'grok'].includes(name) ? 3 : name === 'ssh' ? 2 : 1;
    const key = ['?', '??'].includes(tty) ? pid : tty;
    if ((byTty.get(key)?.score || 0) >= score) continue;
    byTty.set(key, { pid: Number(pid), ppid: Number(ppid), tty, command: name, processState: state, score });
  }
  return (await Promise.all([...byTty.values()].map(async p => {
    let cwd = '', files = [], runtime = false, resumeId = null, startedAt = null;
    if (p.command !== 'shell') {
      try {
        const args = (await runner('ps', ['-p', String(p.pid), '-o', 'args='], { timeout: 1500 })).stdout;
        if (/\smcp-server(?:\s|$)/.test(args) || args.includes('coordinator-instructions.md')) return null;
        ({runtime,resumeId}=providerProcessArguments(p.command,args,p.tty));
        const started = (await runner('ps', ['-p', String(p.pid), '-o', 'lstart='], { timeout: 1500, env: { ...env, LC_ALL: 'C' } })).stdout.trim();
        if (Number.isFinite(Date.parse(started))) startedAt = new Date(started).toISOString();
      } catch {onWarning('A process disappeared or could not be inspected.');return null;}
    }
    try {
      const { stdout } = await runner('lsof', ['-a', '-p', String(p.pid), '-Ffn'], { timeout: 2500, maxBuffer: 1024 * 1024 });
      const lines = stdout.split('\n');
      const index = lines.indexOf('fcwd');
      cwd = index >= 0 && lines[index + 1]?.startsWith('n') ? lines[index + 1].slice(1) : '';
      files = lines.filter(s => s.startsWith('n') && s.endsWith('.jsonl')).map(s => s.slice(1));
    } catch {
      try { cwd = fs.readlinkSync(`/proc/${p.pid}/cwd`); } catch {}
    }
    const repo = repository(cwd);
    const nativeSession=p.command==='claude' && !runtime ? claudeProcessSession({pid:p.pid,cwd,startedAt}) : null;
    if(nativeSession)resumeId=nativeSession.sessionId;
    return { id: `external:${p.pid}`, kind: 'external', provider: providerOf(p.command), title: nativeSession?.title || `${p.command} · ${p.tty}`, ...(nativeSession?.title?{conversationTitle:nativeSession.title}:{}), host: 'local', cwd, repository: repo, group: repo ? path.basename(repo) : path.basename(cwd) || 'Loose sessions', pid: p.pid, tty: p.tty, files, runtime, resumeId, startedAt, status: p.processState.startsWith('T') ? 'paused' : 'external' };
  }))).filter(Boolean);
}
const remoteScript = fs.readFileSync(new URL('./remote-reader.py', import.meta.url), 'utf8');
export async function remoteRead(host, mode, id = '', cursor) {
  validHost(host);
  if (cursor !== undefined && cursor !== '' && (!Number.isSafeInteger(Number(cursor)) || Number(cursor) < 0)) throw new Error('Invalid output cursor.');
  const reader = ['python3', '-c', remoteScript, mode, ...(id ? [id] : []), ...(cursor === undefined || cursor === '' ? [] : [String(cursor)])].map(quote).join(' ');
  // Use only privileges the account already has, with no password prompt or permission changes.
  const command = `if sudo -n true 2>/dev/null; then sudo -n ${reader}; else ${reader}; fi`;
  const { stdout } = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', host, command], { env, timeout: 25000, maxBuffer: 12 * 1024 * 1024 });
  return JSON.parse(stdout);
}
export async function scanRemote(host, includeHistory = false, reader = remoteRead) {
  const data = await reader(host, includeHistory ? 'index' : 'scan');
  if(!Array.isArray(data.processes)||!Array.isArray(data.panes))throw new Error('Remote inventory is malformed.');
  const warnings=[...(data.warnings || [])];
  const processes = data.processes.filter(p=>p&&typeof p.cwd==='string'&&typeof p.provider==='string'&&Number.isSafeInteger(p.pid));
  const panes=data.panes.filter(p=>p&&typeof p.cwd==='string'&&typeof p.pane==='string');
  if(processes.length!==data.processes.length||panes.length!==data.panes.length)warnings.push('Malformed remote rows were omitted.');
  const sessions = panes.filter(p => !p.dead).map(p => {
    const tty = terminalTty(p.tty);
    const process = tty ? processes.find(a => terminalTty(a.tty) === tty && (!p.owner || a.owner === p.owner)) : null;
    // The pane's shell may stay in its launch folder while the agent changes cwd.
    // Keep cwd and all repository evidence from the same inspected process.
    const location=process?.cwd?process:p;
    return { ...p, id: `remote:${host}:${p.owner}:${p.pane}`, kind: 'remote', host, runtime:!!process?.runtime, provider: process?.provider || providerOf(p.command), group: path.posix.basename(location.cwd), status: process?.status === 'paused' ? 'paused' : 'running', files: process?.files || [],resumeId:process?.resumeId,startedAt:process?.startedAt, pid: process?.pid, processStartIdentity: process?.processStartIdentity || null, ...Object.fromEntries(['cwd','canonicalCwd','repository','repositoryVerified','repositoryProjectRoot','repositoryCommonDir','repositoryGroupVerified','branch','worktreeRoot'].map(key=>[key,location[key]])) };
  });
  return { host, healthy:!warnings.length,warnings, elevatedRead: data.elevatedRead, sessions, processes: processes.filter(p => !sessions.some(s => s.pid === p.pid)).map(p => ({
    ...p, id: `remote-process:${host}:${p.pid}`, kind: 'external', host, group: path.posix.basename(p.cwd), title: `${p.provider} · ${p.tty === '?' ? 'PID ' + p.pid : p.tty}`, status: p.status
  })), history: data.history?.map(r => ({ ...r, id: `${host}:${r.provider}:${r.sessionId}`, host, kind: 'history', group: path.posix.basename(r.cwd) })), scannedAt: new Date().toISOString() };
}
