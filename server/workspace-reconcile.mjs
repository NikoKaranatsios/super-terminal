import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { readRecoverySources, compareRecoverySources } from './workspace-recovery.mjs';
import { loadWorkspace, writeWorkspace, embedRecord } from './markdown-store.mjs';
import { migrateState } from './state-schema.mjs';

const COLLECTIONS = ['sessions', 'projects', 'tasks', 'teams', 'workSessions', 'messages', 'activity', 'taskEvents'];
const MAPS = ['lifecycle', 'assignments', 'historyProvenance', 'taskEventCursors'];
const PROJECT_DISPLAY = new Set(['name', 'notes', 'historyRoots', 'createdAt', 'updatedAt']);
const hash = value => createHash('sha256').update(value).digest('hex');
const own = (value, key) => Object.hasOwn(value || {}, key);
const buckets = state => ({ ...state.conductors, ...(state.conductor ? { local: state.conductor } : {}) });
const byId = rows => Object.fromEntries((rows || []).map(row => [row.id, row]));
const conflict = kind => { throw new Error(`Conflicting ${kind} records require explicit review. No recovery was applied.`); };

function union(kind, left = {}, right = {}, resolve) {
  const result = { ...right, ...left };
  for (const key of Object.keys(left)) if (own(right, key) && !equal(left[key], right[key])) {
    result[key] = resolve ? resolve(left[key], right[key]) : conflict(kind);
  }
  return result;
}
function projectCurrent(current, saved) {
  const keys = new Set([...Object.keys(current), ...Object.keys(saved)]);
  for (const key of keys) if (!PROJECT_DISPLAY.has(key) && !equal(current[key], saved[key])) conflict('project identity or authority');
  // Keep the active app's fields as a whole, including intentional empty values.
  // The alternate version is retained in the verified recovery archive.
  return current;
}
function consolidations(left, right) {
  if (!left || !Object.keys(left).length) return right || {};
  if (!right || !Object.keys(right).length) return left;
  if (Array.isArray(left) !== Array.isArray(right)) conflict('consolidation');
  if (!Array.isArray(left)) return union('consolidation', left, right);
  return [...left, ...right.filter(row => !left.some(other => equal(row, other)))];
}

// This is a recovery policy, not a grant to run saved work. Live records absent
// from both current stores stay in the archive, rather than being resurrected.
export function reconcileRecoverySources(sources) {
  const report = compareRecoverySources(sources);
  const { baseline, legacy, workspace } = sources;
  if (report.extensionFields.length) conflict('unknown top-level extension');
  const state = structuredClone(legacy);
  delete state.conductor; delete state.conductors; delete state.directories;
  for (const kind of COLLECTIONS) {
    state[kind] = Object.values(union(kind, byId(legacy[kind]), byId(workspace[kind]), kind === 'projects' ? projectCurrent : null));
  }
  for (const kind of MAPS) state[kind] = union(kind, legacy[kind], workspace[kind]);
  // These are expendable observations, never source-of-truth assignments.
  state.remoteIndexes = { ...workspace.remoteIndexes, ...legacy.remoteIndexes };
  state.consolidations = consolidations(legacy.consolidations, workspace.consolidations);
  for (const key of ['hosts', 'preferences', 'prompts', 'taskSchemaVersion']) {
    if (own(legacy, key) && own(workspace, key) && !equal(legacy[key], workspace[key])) conflict('settings');
    if (!own(state, key) && own(workspace, key)) state[key] = structuredClone(workspace[key]);
  }
  state.preferences ||= {}; state.prompts ||= {};
  state.conductors = {};
  const [b, l, w] = [baseline, legacy, workspace].map(buckets);
  for (const host of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(w)])) {
    const current = l[host] || w[host] || b[host];
    const bucket = structuredClone(current);
    // Memory/settings come from one source in the same environment. No global
    // memory is copied into a project partition and no memories are concatenated.
    bucket.turns = Object.values(union('conversation', union('conversation', byId(l[host]?.turns), byId(w[host]?.turns)), byId(b[host]?.turns)))
      .sort((a, z) => String(a.createdAt || '').localeCompare(String(z.createdAt || '')) || a.id.localeCompare(z.id));
    bucket.actionReceipts = union('action receipt', union('action receipt', l[host]?.actionReceipts, w[host]?.actionReceipts), b[host]?.actionReceipts);
    bucket.loop = { ...bucket.loop, state: 'stopped', nextRoundAt: null, retryAt: null };
    state.conductors[host] = bucket;
  }
  if (state.conductors.local) state.conductor = state.conductors.local;
  // Duplicate live identities or credentials must never be silently enrolled.
  for (const key of ['agentToken', 'enrollmentKey', 'tmuxSession']) {
    const seen = new Set();
    for (const row of state.sessions) if (row[key]) {
      const identity = JSON.stringify([row.host || 'local', row[key]]);
      if (seen.has(identity)) conflict('session identity');
      seen.add(identity);
    }
  }
  compareRecoverySources({ baseline: state, legacy: state, workspace: state });
  const blockers = [];
  for (const c of report.conductors) for (const source of ['baseline', 'legacy', 'workspace']) {
    const pending = c.pending[source];
    if (pending.activeTurns) blockers.push('active-conversation');
    if (pending.startedOccurrences || pending.uncertainOccurrences) blockers.push('unresolved-action');
  }
  return { state: migrateState(structuredClone(state)), report: {
    version: 1, policy: 'retain-current-project-fields', ready: !blockers.length,
    blockers: [...new Set(blockers)], counts: Object.fromEntries(COLLECTIONS.map(kind => [kind, state[kind].length])),
    conversations: Object.values(state.conductors).reduce((n, c) => n + c.turns.length, 0),
    projectAlternativesArchived: report.collections.projects.differences.length,
    baselineOnlyArchived: Object.fromEntries(COLLECTIONS.map(kind => [kind, report.collections[kind].baselineOnly])),
    loops: 'stopped', agentsLaunched: 0,
    policyNotes: [
      'Keep current project display fields; preserve alternate values and all baseline-only records in the archive.',
      'Retain unique current records and historical conversations/receipts with their original identities and provenance.',
      'Refuse conflicting authority, identities, conversations, receipts or settings.',
      'Keep each environment memory from one source; stop recovered coordination loops. No agent is launched or stopped.',
    ],
  } };
}

// Snapshots cover every file, including custom non-record files. Symlinks are
// refused so a recovery cannot traverse into an unrelated directory.
export function recoveryTree(directory, io = fs) {
  const entries = {};
  const visit = (file, relative) => {
    const stat = io.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Recovery sources must not contain symbolic links.');
    if (stat.isDirectory()) {
      entries[relative] = { directory: true };
      for (const name of io.readdirSync(file).sort()) visit(path.join(file, name), relative ? `${relative}/${name}` : name);
    } else if (stat.isFile()) entries[relative] = { hash: hash(io.readFileSync(file)), bytes: stat.size };
    else throw new Error('Recovery sources must contain only regular files and directories.');
  };
  visit(directory, '');
  return entries;
}
function assertPlainParents(file, io) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    if (io.existsSync(current) && io.lstatSync(current).isSymbolicLink()) throw new Error('Recovery paths must not contain symbolic links.');
    if (path.dirname(current) === current) break;
  }
}
const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
function destinations(root, sources, io) {
  const directories = sources.workspace.directories;
  const paths = [path.join(root, 'runtime'), ...Object.values(directories)];
  for (const value of paths) {
    assertPlainParents(value, io);
    if (!path.isAbsolute(value) || !io.statSync(value).isDirectory()) throw new Error('Recovery requires existing absolute workspace directories.');
  }
  for (let a = 0; a < paths.length; a++) for (let b = a + 1; b < paths.length; b++) {
    if (within(paths[a], paths[b]) || within(paths[b], paths[a])) throw new Error('Recovery directories must not overlap.');
  }
  // Avoid two generations of the same environment participating in a swap.
  if (io.existsSync(path.join(root, 'environments'))) throw new Error('Legacy environment directories require separate review before recovery.');
  return { directories, paths };
}
function normalized(state) {
  // The loader adds optional undefined credential keys; JSON has no undefined.
  const result = JSON.parse(JSON.stringify(state));
  delete result.directories; delete result.conductor;
  for (const kind of COLLECTIONS) result[kind] = (result[kind] || []).sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
function secureCopy(io, source, target) {
  const stat = io.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Recovery sources changed to a symbolic link.');
  if (stat.isDirectory()) {
    io.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of io.readdirSync(source)) secureCopy(io, path.join(source, name), path.join(target, name));
  } else if (stat.isFile()) {
    io.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    io.writeFileSync(target, io.readFileSync(source), { mode: 0o600, flush: true });
  } else throw new Error('Recovery sources changed to a special file.');
}

export function previewWorkspaceRecovery(root, { io = fs } = {}) {
  const { sources, report } = readRecoverySources(root, { io });
  const plan = reconcileRecoverySources(sources);
  destinations(path.resolve(root), sources, io);
  return { ...plan.report, fingerprint: report.fingerprint, mode: 'preview', applied: false };
}

// Called only by the offline owner recovery command, never by an agent action.
// The caller holds the service port and checks app/server writers. The lock also
// blocks startup and ordinary saves in cooperating builds during replacement.
export function applyWorkspaceRecovery(root, archive, { io = fs, assertOffline, expectedFingerprint } = {}) {
  root = path.resolve(root); archive = path.resolve(archive);
  if (typeof assertOffline !== 'function') throw new Error('An offline writer check is required.');
  assertOffline(); assertPlainParents(root, io); assertPlainParents(archive, io);
  const { sources, report: inspection } = readRecoverySources(root, { io });
  if (expectedFingerprint && inspection.fingerprint !== expectedFingerprint) throw new Error('Recovery inspection is stale.');
  const plan = reconcileRecoverySources(sources);
  if (!plan.report.ready) throw new Error(`Recovery is blocked: ${plan.report.blockers.join(', ')}.`);
  const { directories, paths } = destinations(root, sources, io);
  if (within(archive, root) || paths.some(p => within(archive, p) || within(p, archive))) throw new Error('The archive must be outside the source workspace directories.');
  if (io.existsSync(archive)) throw new Error('Use a new recovery archive directory.');
  const lock = path.join(root, 'recovery.lock');
  const id = randomUUID();
  io.writeFileSync(lock, JSON.stringify({ version: 1, id, archive }), { flag: 'wx', mode: 0o600, flush: true });
  const journal = { version: 1, id, status: 'preparing', root, archive, swaps: [], legacyRetired: false };
  const saveJournal = () => io.writeFileSync(path.join(archive, 'journal.json'), JSON.stringify(journal, null, 2), { mode: 0o600, flush: true });
  let mutated = false, complete = false;
  const retired = path.join(root, `.state-recovered-${id}.json`);
  try {
    io.mkdirSync(archive, { mode: 0o700, recursive: true });
    const trees = paths.map(p => recoveryTree(p, io));
    const sourceFiles = ['state.json', 'state.migrated.json', 'directories.json'].filter(name => io.existsSync(path.join(root, name)));
    for (const name of sourceFiles) secureCopy(io, path.join(root, name), path.join(archive, 'sources', name));
    for (let i = 0; i < paths.length; i++) {
      const backup = path.join(archive, 'sources', `tree-${i}`);
      secureCopy(io, paths[i], backup);
      if (!equal(recoveryTree(backup, io), trees[i])) throw new Error('Recovery backup verification failed.');
      journal.swaps.push({ target: paths[i], backup, before: trees[i], old: path.join(path.dirname(paths[i]), `.st-old-${id}-${i}`), stage: path.join(path.dirname(paths[i]), `.st-next-${id}-${i}`), moved: false, placed: false });
    }
    // Retain each input, not just the selected value, for later review/rollback.
    io.writeFileSync(path.join(archive, 'source-values.json'), JSON.stringify(sources, null, 2), { mode: 0o600, flush: true });
    io.writeFileSync(path.join(archive, 'report.json'), JSON.stringify({ ...plan.report, fingerprint: inspection.fingerprint }, null, 2), { mode: 0o600, flush: true });
    const staging = path.join(archive, 'generated');
    const stagingDirectories = Object.fromEntries(Object.keys(directories).map((host, i) => [host, path.join(staging, 'workspaces', String(i))]));
    io.mkdirSync(staging, { recursive: true, mode: 0o700 });
    io.writeFileSync(path.join(staging, 'directories.json'), JSON.stringify(stagingDirectories), { mode: 0o600 });
    writeWorkspace(staging, structuredClone(plan.state), io);
    if (!equal(normalized(loadWorkspace(staging, io)), normalized(plan.state))) throw new Error('Staged workspace did not preserve the recovered records.');
    const generatedPaths = [path.join(staging, 'runtime'), ...Object.values(stagingDirectories)];
    for (let i = 0; i < paths.length; i++) {
      const job = journal.swaps[i];
      if (io.existsSync(job.old) || io.existsSync(job.stage)) throw new Error('Recovery staging path already exists.');
      secureCopy(io, job.backup, job.stage);
      secureCopy(io, generatedPaths[i], job.stage);
      if (i > 0) {
        const host = Object.keys(directories)[i - 1], directory = paths[i];
        io.writeFileSync(path.join(job.stage, 'README.md'), `# ${host === 'local' ? 'Local' : host}\n\nThis directory contains this environment's workspace records.\n\n` + embedRecord({ host, directory }), { mode: 0o600, flush: true });
      }
      job.after = recoveryTree(job.stage, io);
    }
    // This catches old builds writing while a backup or stage was being made.
    assertOffline();
    if (readRecoverySources(root, { io }).report.fingerprint !== inspection.fingerprint) throw new Error('Recovery sources changed before replacement.');
    for (let i = 0; i < paths.length; i++) if (!equal(recoveryTree(paths[i], io), trees[i])) throw new Error('Recovery source files changed before replacement.');
    for (const name of sourceFiles) if (!equal(io.readFileSync(path.join(root, name)), io.readFileSync(path.join(archive, 'sources', name)))) throw new Error('Recovery source backup does not match.');
    journal.status = 'replacing'; saveJournal();
    for (const job of journal.swaps) {
      assertOffline();
      io.renameSync(job.target, job.old); job.moved = true; mutated = true; saveJournal();
      io.renameSync(job.stage, job.target); job.placed = true; saveJournal();
    }
    if (!equal(normalized(loadWorkspace(root, io)), normalized(plan.state))) throw new Error('Recovered workspace verification failed.');
    assertOffline();
    if (!equal(io.readFileSync(path.join(root, 'state.json')), io.readFileSync(path.join(archive, 'sources', 'state.json')))) throw new Error('Legacy state changed during replacement.');
    io.renameSync(path.join(root, 'state.json'), retired); journal.legacyRetired = true; saveJournal();
    if (io.existsSync(path.join(root, 'state.json'))) throw new Error('An older writer recreated legacy state during recovery.');
    journal.status = 'complete'; saveJournal(); complete = true;
    // Originals are removed only after the byte-verified private backups and
    // reopened recovered workspace have both passed. Providers are untouched.
    for (const job of journal.swaps) io.rmSync(job.old, { recursive: true });
    io.rmSync(retired);
    io.rmSync(lock);
    return { ...plan.report, mode: 'applied', applied: true, archive };
  } catch (error) {
    if (complete) throw new Error(`Recovery completed, but cleanup failed. Keep the archive and recovery.lock for review: ${archive}`, { cause: error });
    try {
      if (journal.legacyRetired) {
        if (io.existsSync(path.join(root, 'state.json'))) throw new Error('Another writer recreated legacy state.');
        io.renameSync(retired, path.join(root, 'state.json'));
      }
      for (const job of [...journal.swaps].reverse()) {
        if (job.placed) io.renameSync(job.target, job.stage);
        if (job.moved) io.renameSync(job.old, job.target);
        if (job.moved && !equal(recoveryTree(job.target, io), job.before)) throw new Error('Rollback verification failed.');
      }
      journal.status = mutated ? 'rolled-back' : 'not-applied';
      if (io.existsSync(archive)) saveJournal();
      for (const job of journal.swaps) if (io.existsSync(job.stage)) io.rmSync(job.stage, { recursive: true });
      io.rmSync(lock);
    } catch (rollbackError) {
      throw new Error(`Recovery needs manual rollback. Original backups and the writer lock are retained at ${archive}.`, { cause: rollbackError });
    }
    throw new Error(`Recovery was not applied; original sources are preserved. ${error.message}`, { cause: error });
  }
}
