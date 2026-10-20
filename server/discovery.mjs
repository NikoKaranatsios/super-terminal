import fs from 'node:fs';
import path from 'node:path';
import { run, env, tmuxRun, socket, providerOf, repository, validHost } from './core.mjs';

export async function tmuxSessions(targetSocket = socket) {
  try {
    const { stdout } = await tmuxRun(['list-panes', '-a', '-F', '#{session_id}\t#{session_name}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_tty}\t#{pane_id}\t#{pane_dead}'], targetSocket);
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [target, name, cwd, command, tty, pane, dead] = line.split('\t');
      return { target, name, cwd, command, tty, pane, dead: dead === '1', socket: targetSocket };
    });
  } catch { return []; }
}
export async function externalTerminals(excludeTtys = []) {
  const excluded = new Set(excludeTtys.map(t => t.replace('/dev/', '')));
  let stdout;
  try { ({ stdout } = await run('ps', ['-axo', 'pid=,ppid=,tty=,comm='], { timeout: 3000 })); } catch { return []; }
  const byTty = new Map();
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!m || m[3] === '??' || m[3] === '?' || excluded.has(m[3])) continue;
    const [pid, ppid, tty, command] = m.slice(1);
    const name = path.basename(command);
    if (!['codex', 'claude', 'grok', 'zsh', 'bash', 'fish', 'ssh'].includes(name)) continue;
    const score = ['codex', 'claude', 'grok'].includes(name) ? 3 : name === 'ssh' ? 2 : 1;
    if ((byTty.get(tty)?.score || 0) >= score) continue;
    byTty.set(tty, { pid: Number(pid), ppid: Number(ppid), tty, command: name, score });
  }
  return Promise.all([...byTty.values()].map(async p => {
    let cwd = '';
    try {
      const { stdout } = await run('lsof', ['-a', '-p', String(p.pid), '-d', 'cwd', '-Fn'], { timeout: 2500, maxBuffer: 64000 });
      cwd = stdout.split('\n').find(s => s.startsWith('n'))?.slice(1) || '';
    } catch {
      try { cwd = fs.readlinkSync(`/proc/${p.pid}/cwd`); } catch {}
    }
    const repo = repository(cwd);
    return { id: `external:${p.pid}`, kind: 'external', provider: providerOf(p.command), title: `${p.command} · ${p.tty}`, host: 'local', cwd, repository: repo, group: repo ? path.basename(repo) : path.basename(cwd) || 'Loose sessions', pid: p.pid, tty: p.tty, status: 'external' };
  }));
}
export async function scanRemote(host) {
  validHost(host);
  // Read-only discovery. No host-key bypass, password capture, installation, or background polling.
  const script = 'printf "__ST_TMUX__\\n"; tmux list-panes -a -F \'#{session_id}|#{session_name}|#{pane_current_path}|#{pane_current_command}|#{pane_id}\' 2>/dev/null; printf "__ST_PS__\\n"; ps -axo pid=,tty=,comm= 2>/dev/null; printf "__ST_CWD__\\n"; for p in $(pgrep -x "codex|claude|grok"); do printf "%s|" "$p"; readlink "/proc/$p/cwd" 2>/dev/null || printf "\\n"; done; printf "__ST_END__\\n"';
  const { stdout } = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', host, script], { env, timeout: 10000, maxBuffer: 1024 * 1024 });
  const tmuxPart = stdout.split('__ST_TMUX__\n')[1]?.split('__ST_PS__')[0] || '';
  const sessions = tmuxPart.trim().split('\n').filter(Boolean).map(line => {
    const [target, name, cwd, command, pane] = line.split('|');
    return { id: `remote:${host}:${pane}`, kind: 'remote', host, target, pane, title: name, cwd, provider: providerOf(command), group: `${host} / ${path.posix.basename(cwd || '') || 'Sessions'}`, status: 'running' };
  }).filter(r => /^\$\d+$/.test(r.target) && /^%\d+$/.test(r.pane));
  const cwdPart = stdout.split('__ST_CWD__\n')[1]?.split('__ST_END__')[0] || '';
  const cwdByPid = Object.fromEntries(cwdPart.trim().split('\n').filter(Boolean).map(l => { const i = l.indexOf('|'); return [l.slice(0, i), l.slice(i + 1)]; }));
  const psPart = stdout.split('__ST_PS__\n')[1]?.split('__ST_CWD__')[0] || '';
  const processes = psPart.split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    return m && ['codex', 'claude', 'grok'].includes(path.posix.basename(m[3])) ?
      [{ id: `remote-process:${host}:${m[1]}`, kind: 'external', host, pid: Number(m[1]), tty: m[2], provider: path.posix.basename(m[3]), cwd: cwdByPid[m[1]] || '', group: `${host} / ${path.posix.basename(cwdByPid[m[1]] || '') || 'Agents'}`, title: `${path.posix.basename(m[3])} · PID ${m[1]}`, status: 'external' }] : [];
  });
  return { host, sessions, processes, scannedAt: new Date().toISOString() };
}
