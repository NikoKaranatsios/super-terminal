import path from 'node:path';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { run, env, quote, tmuxRun, dataDir, validHost } from './core.mjs';

function dependencies(context) {
  return { run: context.run || run, tmuxRun: context.tmuxRun || tmuxRun, signal: context.signal || ((pid, signal) => process.kill(pid, signal)) };
}
const controlLocks = new WeakMap();
function sshArgs(target, command) {
  const owner = target.remoteUser || (target.requiresSudo ? target.owner : null);
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', validHost(target.host), owner ? `sudo -n -u ${quote(owner)} sh -lc ${quote(command)}` : command];
}
async function execute(target, command, args, io) {
  return target.host === 'local' ? io.run(command, args, { env: { ...env, LC_ALL: 'C' }, timeout: 5000 }) : io.run('ssh', sshArgs(target, ['env', 'LC_ALL=C', command, ...args].map(quote).join(' ')), { env, timeout: 10000 });
}
async function signalJob(target, desired, io) {
  let pid = target.pid, group = null;
  if (target.kind === 'external') {
    if (!target.startedAt) throw new Error('Process start identity is unavailable; refresh before controlling it.');
    const comm = (await execute(target, 'ps', ['-p', String(pid), '-o', 'comm='], io)).stdout.trim();
    if (path.basename(comm) !== target.provider) throw new Error('Process identity changed; refresh before controlling it.');
    const started = (await execute(target, 'ps', ['-p', String(pid), '-o', 'lstart='], io)).stdout.trim();
    if (!Number.isFinite(Date.parse(started)) || Date.parse(started) !== Date.parse(target.startedAt)) throw new Error('Process start identity changed; refresh before controlling it.');
  } else {
    let tty = target.tty;
    if (target.kind === 'managed' && target.host !== 'local') tty = (await io.run('ssh', sshArgs(target, `tmux list-panes -t ${quote(target.tmuxName)} -F '#{pane_tty}'`), { env, timeout: 10000 })).stdout.trim().split('\n')[0];
    if (typeof tty !== 'string' || !tty || !/^(?:\/dev\/)?[\w/-]+$/.test(tty)) throw new Error('Cannot identify the foreground process for this terminal.');
    const records = (await execute(target, 'ps', ['-t', tty.replace('/dev/', ''), '-o', 'pid=,pgid=,stat='], io)).stdout.trim().split('\n').map(line => line.trim().split(/\s+/));
    const foreground = records.filter(r => r[2]?.includes('+'));
    const paused = records.filter(r => r[2]?.startsWith('T'));
    const candidates = (desired === 'running' || desired === 'stopped') && paused.length ? paused : foreground;
    const groups = new Set(candidates.map(r => Number(r[1])));
    if (!candidates.length || groups.size !== 1) throw new Error('Cannot identify one foreground job safely.');
    pid = Number(candidates[0][0]); group = Number(candidates[0][1]);
    // Recheck the selected process group immediately before signalling.
    const current = Number((await execute(target, 'ps', ['-p', String(pid), '-o', 'pgid='], io)).stdout.trim());
    if (current !== group) throw new Error('Foreground job changed; refresh before controlling it.');
  }
  if (!Number.isInteger(pid) || pid <= 1 || (group !== null && (!Number.isInteger(group) || group <= 1))) throw new Error('Invalid process identity.');
  const destination = group === null ? pid : -group;
  const signal = { running: 'CONT', paused: 'STOP', stopped: 'TERM' }[desired];
  const signals = desired === 'stopped' && target.status === 'paused' ? ['CONT', signal] : [signal];
  for (const item of signals) {
    if (target.host === 'local') io.signal(destination, `SIG${item}`);
    else await io.run('ssh', sshArgs(target, `${target.requiresSudo && !target.owner && !target.remoteUser ? 'sudo -n ' : ''}kill -${item} -- ${destination}`), { env, timeout: 10000 });
  }
  if (desired === 'stopped' && target.kind === 'external') {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const started = (await execute(target, 'ps', ['-p', String(pid), '-o', 'lstart='], io)).stdout.trim();
        if (!started || Date.parse(started) !== Date.parse(target.startedAt)) return;
      } catch (error) { if (error.code === 1) return; throw error; }
      await delay(25);
    }
    throw new Error('Termination requested; the process has not confirmed exit yet.');
  }
}
function revoke(store, id) {
  const record = store.state.sessions?.find(s => s.id === id);
  if (record) { delete record.agentToken; record.enrollmentRevokedAt ||= new Date().toISOString(); }
}
async function cleanCredentials(target, context, io) {
  if (context.removeBridge) return context.removeBridge(target);
  if (!/^[a-zA-Z0-9_-]+$/.test(target.id)) throw new Error('Invalid owned credential identity.');
  fs.rmSync(path.join(dataDir, 'agents', `${target.id}.json`), { force: true });
  if (target.host !== 'local') await io.run('ssh', sshArgs(target, `rm -f -- "$HOME/.super-terminal/agent-${target.id}.json"`), { env, timeout: 10000 });
}

/** Shared process control. A partial remote stop retains its record and never claims termination. */
export async function controlAgent(target, desired, context) {
  if (!target) throw new Error('Agent not found.');
  let locks = controlLocks.get(context.store);
  if (!locks) { locks = new Map(); controlLocks.set(context.store, locks); }
  while (locks.has(target.id)) await locks.get(target.id);
  let release;
  locks.set(target.id, new Promise(resolve => { release = resolve; }));
  try { return await controlAgentUnlocked(target, desired, context); }
  finally { locks.delete(target.id); release(); }
}
async function controlAgentUnlocked(target, desired, context) {
  desired = ({ pause: 'paused', resume: 'running', stop: 'stopped' })[desired] || desired;
  if (!target || !['running', 'paused', 'stopped'].includes(desired)) throw new Error('Choose an existing agent and running, paused, or stopped.');
  if (target.runtime) throw new Error('This process is a shared provider service; control its individual agent in the provider app.');
  if (desired !== 'stopped' && context.store.state.sessions?.find(s => s.id === target.id)?.enrollmentRevokedAt) throw new Error('That enrollment has ended; resume the saved conversation instead.');
  if (target.host !== 'local' && context.allowedHosts && !context.allowedHosts.includes(target.host)) throw new Error('Environment is not enabled.');
  if (desired !== 'stopped' && ['stopped', 'exited'].includes(target.status)) throw new Error('That agent has stopped; start or resume its conversation instead.');
  if (desired !== 'stopped' && target.connectionLost) throw new Error('Connection lost; remote process state is unknown.');
  const io = dependencies(context), results = [], store = context.store;
  async function attempt(resource, fn) {
    try { await fn(); results.push({ resource, status: 'succeeded' }); return true; }
    catch (error) { results.push({ resource, status: 'failed', error: error.message }); return false; }
  }
  let stopped = false;
  if (desired === 'stopped' && target.kind === 'managed') {
    // Revocation is durable even if transport termination fails.
    revoke(store, target.id); store.save();
    let remote = true;
    if (target.host !== 'local') remote = await attempt('remote-process', async () => {
      if (target.status === 'paused') await signalJob(target, 'running', io);
      const command = `if ! command -v tmux >/dev/null 2>&1; then echo 'Remote tmux is unavailable; termination is unknown.' >&2; exit 1; fi; if tmux has-session -t ${quote(target.tmuxName)} 2>/dev/null; then tmux kill-session -t ${quote(target.tmuxName)}; fi`;
      await io.run('ssh', sshArgs(target, command), { env, timeout: 10000 });
    });
    const local = await attempt('local-transport', async () => {
      if (['stopped', 'exited'].includes(target.status)) return;
      if (target.host === 'local' && target.status === 'paused') await signalJob(target, 'running', io);
      try { await io.tmuxRun(['has-session', '-t', target.tmuxName]); }
      catch (error) { if (error.code === 1 && /(?:can't find session|no server running|error connecting)/i.test(error.stderr || error.message || '')) return; throw error; }
      await io.tmuxRun(['kill-session', '-t', target.tmuxName]);
    });
    stopped = remote && local;
    if (context.closeBrowser) await attempt('browser', () => context.closeBrowser(target.id));
    await attempt('credentials', () => cleanCredentials(target, context, io));
  } else if (desired === 'stopped' && ['stopped', 'exited'].includes(target.status)) {
    stopped = true;
    revoke(store, target.id);
  } else {
    const success = await attempt('foreground-job', () => signalJob(target, desired, io));
    if (success && desired === 'stopped') revoke(store, target.id);
    stopped = success && desired === 'stopped';
  }
  const processSuccess = desired === 'stopped' ? stopped : results.some(r => r.resource === 'foreground-job' && r.status === 'succeeded');
  store.state.lifecycle ||= {};
  const record = store.state.sessions?.find(s => s.id === target.id);
  if (processSuccess) {
    store.state.lifecycle[target.id] = desired;
    if (record) record.status = desired;
  } else if (desired === 'stopped') {
    store.state.lifecycle[target.id] = 'unknown';
    if (record) record.status = 'unknown';
  }
  const outcome = { id: target.id, requestedState: desired, state: processSuccess ? desired : desired === 'stopped' ? 'unknown' : target.status, ok: processSuccess && results.every(r => r.status === 'succeeded'), partial: !processSuccess || results.some(r => r.status === 'failed'), results, result: processSuccess ? `${desired === 'running' ? 'Resumed' : desired === 'paused' ? 'Paused' : 'Stopped'} ${target.title || target.id}` : `Could not confirm ${desired} for ${target.title || target.id}` };
  if (record) record.lastControl = { ...outcome, at: new Date().toISOString() };
  store.save(); context.invalidate?.();
  return outcome;
}

export async function removeAgent(target, context) {
  if (target.kind !== 'managed') throw new Error('Only managed agent records can be removed.');
  const outcome = await controlAgent(target, 'stopped', context);
  if (!outcome.ok) return { ...outcome, removed: false };
  context.store.state.sessions = context.store.state.sessions.filter(s => s.id !== target.id);
  delete context.store.state.lifecycle?.[target.id];
  delete context.store.state.assignments?.[target.id];
  for (const task of context.store.state.tasks || []) if (task.agentId === target.id) task.agentId = null;
  context.store.save();
  return { ...outcome, removed: true };
}
