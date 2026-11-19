import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { migrateState, validateState } from './state-schema.mjs';

const SECRET = new Set(['agentToken', 'enrollmentKey', 'enrollmentFingerprint', 'token']);
const WORK = ['projects', 'tasks', 'teams', 'workSessions', 'messages', 'activity', 'taskEvents'];

export function assertRecoveryUnlocked(root, io = fs) {
  if (io.existsSync(path.join(root, 'recovery.lock'))) throw new Error('Workspace recovery is in progress or needs rollback. Keep the recovery archive and lock intact; finish the offline recovery before opening Super Terminal.');
}

export function environmentSlug(host) {
  if (!host || host === 'local') return 'local';
  return 'env-' + createHash('sha256').update(host).digest('hex').slice(0, 12);
}
export function defaultEnvironmentDirectories(homeDir, connections = []) {
  const base = path.join(homeDir, 'Super Terminal');
  const directories = { local: path.join(base, 'Local') };
  for (const connection of connections) {
    const host = connection?.target;
    if (!host || host === 'local') continue;
    const name = String(connection.name || 'Remote').replace(/[\\/:\0]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Remote';
    directories[host] = path.join(base, name);
  }
  return directories;
}
export function readDirectories(root, io = fs) {
  const file = path.join(root, 'directories.json');
  if (!io.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(io.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
export function workspaceDirectory(root, host, directories = {}) {
  const configured = directories?.[host];
  if (typeof configured === 'string' && path.isAbsolute(configured)) return configured;
  return path.join(root, 'workspaces', environmentSlug(host));
}
export function ensureEnvironmentDirectories(root, homeDir, connections = [], io = fs) {
  assertRecoveryUnlocked(root, io);
  if (process.env.SUPER_TERMINAL_TEST) return readDirectories(root, io);
  io.mkdirSync(root, { recursive: true, mode: 0o700 });
  const current = readDirectories(root, io);
  let changed = !io.existsSync(path.join(root, 'directories.json'));
  for (const [host, directory] of Object.entries(defaultEnvironmentDirectories(homeDir, connections))) {
    if (!current[host]) { current[host] = directory; changed = true; }
  }
  if (changed) io.writeFileSync(path.join(root, 'directories.json'), JSON.stringify(current, null, 2), { mode: 0o600 });
  for (const directory of Object.values(current)) if (typeof directory === 'string' && path.isAbsolute(directory)) io.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return current;
}
function attachDirectories(root, state, io) {
  const configured = readDirectories(root, io);
  const hosts = ['local', ...(state.hosts || []), ...Object.keys(state.conductors || {}), ...Object.keys(configured)];
  state.directories = Object.fromEntries([...new Set(hosts)].filter(Boolean).map(host => [host, workspaceDirectory(root, host, configured)]));
  return state.directories;
}

function marker() { return Buffer.from('```json super-terminal\n'); }
export function embedRecord(record) {
  const json = JSON.stringify(record, null, 2);
  return '```json super-terminal\n' + Buffer.byteLength(json) + '\n' + json + '\n```\n';
}
export function extractRecord(markdown) {
  const source = Buffer.from(String(markdown));
  const start = source.indexOf(marker());
  if (start < 0) throw new Error('This workspace file has no Super Terminal record.');
  const lengthAt = start + marker().length;
  const lineEnd = source.indexOf(0x0a, lengthAt);
  const length = Number(source.subarray(lengthAt, lineEnd).toString('utf8'));
  if (!Number.isInteger(length) || length < 2) throw new Error('This workspace file has a damaged record.');
  return JSON.parse(source.subarray(lineEnd + 1, lineEnd + 1 + length).toString('utf8'));
}

function prose(title, lines, body) {
  const summary = lines.filter(Boolean).map(line => `- ${line}`).join('\n');
  return `# ${String(title || 'Record').replace(/\n/g, ' ')}\n\n${summary}\n\n${body ? String(body).trim() + '\n\n' : ''}`;
}
function publicCopy(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET.has(key)));
}
function safeId(id) {
  const value = String(id || '');
  return /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : createHash('sha256').update(value).digest('hex').slice(0, 24);
}
function hostOf(state, kind, row) {
  if (row.host) return row.host;
  if (kind === 'tasks') return state.projects?.find(project => project.id === row.projectId)?.host || 'local';
  if (kind === 'messages') return state.sessions?.find(session => session.id === row.to || session.id === row.from)?.host || state.teams?.find(team => team.id === row.teamId)?.host || 'local';
  if (kind === 'taskEvents') return hostOf(state, 'tasks', state.tasks?.find(task => task.id === row.taskId) || {});
  return 'local';
}
function renderWork(kind, row) {
  if (kind === 'projects') return prose(row.name || 'Project', [`Status: ${row.status || 'active'}`, row.cwd ? `Directory: \`${row.cwd}\`` : ''], row.notes);
  if (kind === 'tasks') return prose(row.title || row.name || 'Task', [`Status: ${row.status || 'todo'}`, row.agentId ? `Agent: \`${row.agentId}\`` : ''], [row.notes, row.blocker ? `Blocker: ${row.blocker}` : ''].filter(Boolean).join('\n\n'));
  if (kind === 'teams') return prose(row.name || 'Team', [row.cwd ? `Directory: \`${row.cwd}\`` : ''], row.mission || row.text || '');
  if (kind === 'workSessions') return prose(row.title || row.name || 'Working session', [`Status: ${row.status || 'active'}`], row.notes || row.summary || '');
  if (kind === 'messages') return prose('Message', [`From: \`${row.from || ''}\``, `To: \`${row.to || ''}\``, `Delivery: ${row.delivery || 'queued'}`], row.text || '');
  if (kind === 'activity') return prose(row.title || 'Activity', [row.host || 'local'], row.text || row.summary || '');
  return prose(row.title || row.name || kind, [`Status: ${row.status || ''}`], row.notes || row.text || '');
}
function renderTurn(turn) {
  return prose('Conductor turn', [`Status: ${turn.status || 'complete'}`, turn.createdAt ? `When: ${turn.createdAt}` : ''], `## You\n\n${turn.prompt || ''}\n\n## Conductor\n\n${turn.answer || ''}\n`);
}
function renderAgent(session) {
  return prose(session.title || 'Agent', [`Provider: ${session.provider || 'shell'}`, `Status: ${session.status || ''}`, session.cwd ? `Directory: \`${session.cwd}\`` : '', session.role ? `Role: ${session.role}` : ''], session.mission || '');
}

function writeFile(io, file, content) {
  io.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  io.writeFileSync(file, content, { mode: 0o600 });
}
function filesUnder(io, dir, acc = []) {
  if (!io.existsSync(dir)) return acc;
  for (const name of io.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (io.statSync(full).isDirectory()) filesUnder(io, full, acc);
    else acc.push(full);
  }
  return acc;
}

export function runtimePayload(state) {
  return {
    stateVersion: state.stateVersion,
    hosts: state.hosts,
    sessions: state.sessions,
    lifecycle: state.lifecycle || {},
    preferences: state.preferences || {},
    prompts: state.prompts || {},
    assignments: state.assignments || {},
    historyProvenance: state.historyProvenance || {},
    remoteIndexes: state.remoteIndexes || {},
    taskEventCursors: state.taskEventCursors || {},
    consolidations: state.consolidations || {},
    taskSchemaVersion: state.taskSchemaVersion
  };
}

function place(io, from, to) {
  io.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
  try { io.renameSync(from, to); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    io.copyFileSync(from, to);
    io.rmSync(from, { force: true });
  }
}
export function writeWorkspace(root, state, io) {
  const pending = path.join(root, `.pending-${process.pid}-${randomUUID()}`);
  const directories = attachDirectories(root, state, io);
  const jobs = [];
  const put = (destination, content) => {
    const from = path.join(pending, String(jobs.length));
    writeFile(io, from, content);
    jobs.push({ from, to: destination });
  };
  try {
    put(path.join(root, 'runtime', 'runtime.json'), JSON.stringify(runtimePayload(state), null, 2));
    const hosts = new Set(['local', ...(state.hosts || []), ...Object.keys(directories)]);
    for (const kind of WORK) for (const row of state[kind] || []) hosts.add(hostOf(state, kind, row));
    for (const session of state.sessions || []) hosts.add(session.host || 'local');
    const conductors = { ...(state.conductors || {}) };
    if (state.conductor) conductors.local = state.conductor;
    for (const host of Object.keys(conductors)) hosts.add(host);
    const kept = new Map();
    for (const host of hosts) {
      if (!host) continue;
      const directory = directories[host] || workspaceDirectory(root, host, directories);
      const keep = new Set();
      const note = prose(host === 'local' ? 'Local' : host, [`Directory: \`${directory}\``], 'This directory is the environment. Projects, teams, tasks, messages, working sessions, agents, and the Conductor conversation documented here belong to this directory only.');
      const readme = path.join(directory, 'README.md');
      put(readme, note + embedRecord({ host, directory }));
      keep.add(readme);
      for (const kind of WORK) {
        const folder = kind === 'workSessions' ? 'work-sessions' : kind === 'taskEvents' ? 'task-events' : kind;
        for (const row of state[kind] || []) {
          if (!row?.id || hostOf(state, kind, row) !== host) continue;
          const file = path.join(directory, folder, `${safeId(row.id)}.md`);
          put(file, renderWork(kind, row) + embedRecord(row));
          keep.add(file);
        }
      }
      for (const session of state.sessions || []) {
        if (!session?.id || (session.host || 'local') !== host) continue;
        const file = path.join(directory, 'agents', `${safeId(session.id)}.md`);
        put(file, renderAgent(session) + embedRecord(publicCopy(session)));
        keep.add(file);
      }
      const conductor = conductors[host];
      if (conductor) {
        const { turns, ...rest } = conductor;
        const file = path.join(directory, 'conductor.md');
        put(file, prose('Conductor', ['Memory and coordination for this directory'], rest.memory || '') + embedRecord(rest));
        keep.add(file);
        for (const turn of turns || []) if (turn?.id) {
          const turnFile = path.join(directory, 'turns', `${safeId(turn.id)}.md`);
          put(turnFile, renderTurn(turn) + embedRecord(turn));
          keep.add(turnFile);
        }
      }
      kept.set(directory, keep);
    }
    for (const job of jobs) place(io, job.from, job.to);
    for (const [directory, keep] of kept) {
      for (const folder of ['projects', 'tasks', 'teams', 'work-sessions', 'messages', 'activity', 'task-events', 'agents', 'turns']) {
        for (const file of filesUnder(io, path.join(directory, folder))) if (!keep.has(file)) io.rmSync(file, { force: true });
      }
    }
    const runtimeKeep = new Set([path.join(root, 'runtime', 'runtime.json')]);
    for (const file of filesUnder(io, path.join(root, 'runtime'))) if (!runtimeKeep.has(file)) io.rmSync(file, { force: true });
    io.rmSync(path.join(root, 'environments'), { recursive: true, force: true });
    io.rmSync(pending, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`Cannot save workspace: ${error.message}. The original files were left untouched. Pending file: ${pending}`, { cause: error });
  }
}

function readRecords(io, dir) {
  if (!io.existsSync(dir)) return [];
  return io.readdirSync(dir).filter(name => name.endsWith('.md')).map(name => extractRecord(io.readFileSync(path.join(dir, name), 'utf8')));
}

function folderName(kind) {
  if (kind === 'workSessions') return 'work-sessions';
  if (kind === 'taskEvents') return 'task-events';
  return kind;
}
function loadDirectory(state, io, directory, fallbackHost) {
  if (!directory || !io.existsSync(directory)) return;
  const markerFile = io.existsSync(path.join(directory, 'README.md')) ? path.join(directory, 'README.md') : path.join(directory, 'environment.md');
  let host = fallbackHost;
  if (io.existsSync(markerFile)) { try { host = extractRecord(io.readFileSync(markerFile, 'utf8')).host || host; } catch { /* A directory without a record is not a workspace. */ } }
  if (!host) return;
  for (const kind of WORK) state[kind].push(...readRecords(io, path.join(directory, folderName(kind))));
  const agents = new Map(readRecords(io, path.join(directory, 'agents')).map(row => [row.id, row]));
  state.sessions = state.sessions.map(session => {
    const work = agents.get(session.id);
    if (!work) return session;
    return { ...work, ...session, agentToken: session.agentToken, enrollmentKey: session.enrollmentKey, enrollmentFingerprint: session.enrollmentFingerprint };
  });
  const conductorFile = path.join(directory, 'conductor.md');
  if (io.existsSync(conductorFile)) {
    const bucket = extractRecord(io.readFileSync(conductorFile, 'utf8'));
    bucket.turns = readRecords(io, path.join(directory, 'turns')).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    state.conductors[host] = bucket;
  }
}
export function loadWorkspace(root, io) {
  const runtimeFile = path.join(root, 'runtime', 'runtime.json');
  let runtime;
  try { runtime = JSON.parse(io.readFileSync(runtimeFile, 'utf8')); }
  catch (error) { throw new Error(`Cannot load ${runtimeFile}: ${error.message}. The original file was left untouched.`, { cause: error }); }
  const state = { ...runtime, sessions: runtime.sessions || [], hosts: runtime.hosts || [], projects: [], tasks: [], teams: [], workSessions: [], messages: [], activity: [], taskEvents: [], conductors: {} };
  const directories = attachDirectories(root, state, io);
  for (const [host, directory] of Object.entries(directories)) loadDirectory(state, io, directory, host);
  const legacy = path.join(root, 'environments');
  if (io.existsSync(legacy)) {
    for (const slug of io.readdirSync(legacy)) {
      const dir = path.join(legacy, slug);
      if (!io.statSync(dir).isDirectory()) continue;
      let host = slug === 'local' ? 'local' : '';
      const markerFile = path.join(dir, 'environment.md');
      if (io.existsSync(markerFile)) { try { host = extractRecord(io.readFileSync(markerFile, 'utf8')).host || host; } catch { host = ''; } }
      if (!host || state.projects.some(project => (project.host || 'local') === host) || state.conductors[host]) continue;
      loadDirectory(state, io, dir, host);
    }
  }
  if (state.conductors.local) state.conductor = state.conductors.local;
  attachDirectories(root, state, io);
  return migrateState(state);
}

export function createWorkspaceStore(root, io, legacy) {
  assertRecoveryUnlocked(root, io);
  const runtimeFile = path.join(root, 'runtime', 'runtime.json');
  const legacyFile = path.join(root, legacy || 'state.json');
  const requireSingleStore = () => {
    assertRecoveryUnlocked(root, io);
    if (io.existsSync(legacyFile)) {
      throw new Error(`Legacy state ${legacyFile} exists alongside the Markdown workspace. An older build may have saved additional work, or migration may be incomplete. Close Super Terminal services, preserve both stores and state.migrated.json, then reconcile their records before reopening. Existing files were left untouched.`);
    }
  };
  const openedStore = state => ({ state, save() {
    // An older app can recreate state.json after this workspace was opened.
    requireSingleStore();
    validateState(state);
    writeWorkspace(root, state, io);
  } });
  const hasRuntime = io.existsSync(runtimeFile);
  if (hasRuntime) requireSingleStore();
  if (!hasRuntime && io.existsSync(legacyFile)) {
    let parsed;
    try { parsed = JSON.parse(io.readFileSync(legacyFile, 'utf8')); }
    catch (error) { throw new Error(`Cannot load ${legacyFile}: ${error.message}. The original file was left untouched.`, { cause: error }); }
    let state;
    try { state = migrateState(parsed); }
    catch (error) { throw new Error(`Cannot load ${legacyFile}: ${error.message}. The original file was left untouched.`, { cause: error }); }
    if (state.conductor) { state.conductors ||= {}; state.conductors.local = state.conductor; }
    // Only the initial migration may write while its legacy source exists.
    validateState(state);
    writeWorkspace(root, state, io);
    const check = loadWorkspace(root, io);
    if (check.sessions.length !== state.sessions.length || check.projects.length !== (state.projects?.length || 0) || (check.conductor?.turns?.length || 0) !== (state.conductor?.turns?.length || 0)) {
      throw new Error(`Cannot load ${legacyFile}: workspace migration did not preserve the records. The original file was left untouched.`);
    }
    io.renameSync(legacyFile, path.join(root, 'state.migrated.json'));
    attachDirectories(root, state, io);
    return openedStore(state);
  }
  const state = hasRuntime ? loadWorkspace(root, io) : migrateState({ sessions: [], hosts: [] });
  attachDirectories(root, state, io);
  return openedStore(state);
}
