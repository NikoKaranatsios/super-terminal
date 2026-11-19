import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { loadWorkspace } from './markdown-store.mjs';
import { validateState } from './state-schema.mjs';

const COLLECTIONS = ['sessions', 'projects', 'tasks', 'teams', 'workSessions', 'messages', 'activity', 'taskEvents'];
const MAPS = ['lifecycle', 'assignments', 'historyProvenance', 'taskEventCursors', 'remoteIndexes'];
const hash = value => createHash('sha256').update(value).digest('hex');
const reference = (kind, id) => hash(JSON.stringify([kind, id])).slice(0, 16);
const own = (row, key) => Object.hasOwn(row || {}, key);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

// Values, user-defined keys, IDs, hosts, paths and parser errors never enter the
// public report. Detailed source data remains in the original stores.
const FIELD_GROUPS = {
  boundary: ['projectId', 'teamId', 'scope', 'contextProjectId', 'contextIsolation', 'contentProjectIds', 'sourceProjectIds', 'sharedProjectIds', 'projectAssignment', 'assignmentRevision'],
  identity: ['host', 'cwd', 'provider', 'pid', 'tmuxSession', 'tmuxServerPid', 'attemptId', 'historyId', 'agentToken', 'token', 'enrollmentKey', 'enrollmentFingerprint'],
  lifecycle: ['status', 'launchState', 'enrollmentRevokedAt', 'stoppedAt', 'exitedAt'],
  delivery: ['delivery', 'read', 'acknowledgedAt', 'from', 'to'],
  content: ['name', 'title', 'notes', 'mission', 'text', 'prompt', 'answer', 'memory', 'roster', 'roles'],
  relationships: ['agentId', 'taskId', 'parentTaskId', 'projects', 'goals', 'canonicalProjectId', 'mergedIntoProjectId', 'historyRoots'],
  evidence: ['actions', 'trace', 'events', 'context', 'provenance', 'runtime'],
  metadata: ['createdAt', 'updatedAt', 'startedAt', 'endedAt', 'completedAt', 'group'],
};
function changedGroups(left, right) {
  if (!object(left) || !object(right)) return ['value'];
  const groups = new Set();
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (own(left, key) === own(right, key) && equal(left[key], right[key])) continue;
    groups.add(Object.entries(FIELD_GROUPS).find(([, fields]) => fields.includes(key))?.[0] || 'extension');
  }
  return [...groups].sort();
}
function difference(kind, id, base, legacy, workspace) {
  return {
    ref: reference(kind, id),
    baseline: base === undefined ? 'absent' : equal(base, legacy) ? 'matches-legacy' : equal(base, workspace) ? 'matches-workspace' : 'differs-from-both',
    groups: changedGroups(legacy, workspace),
  };
}
function compareMaps(kind, base = {}, legacy = {}, workspace = {}) {
  const report = { baseline: Object.keys(base).length, legacy: Object.keys(legacy).length, workspace: Object.keys(workspace).length,
    identical: 0, onlyLegacy: 0, onlyWorkspace: 0, baselineOnly: 0, differences: [] };
  for (const id of new Set([...Object.keys(base), ...Object.keys(legacy), ...Object.keys(workspace)])) {
    if (!own(legacy, id) && !own(workspace, id)) report.baselineOnly++;
    else if (!own(legacy, id)) report.onlyWorkspace++;
    else if (!own(workspace, id)) report.onlyLegacy++;
    else if (equal(legacy[id], workspace[id])) report.identical++;
    else report.differences.push(difference(kind, id, own(base, id) ? base[id] : undefined, legacy[id], workspace[id]));
  }
  report.differences.sort((a, b) => a.ref.localeCompare(b.ref));
  return report;
}
function rowsById(rows = []) {
  if (rows.some(row => !object(row) || typeof row.id !== 'string' || !row.id)) throw new Error('Recovery inspection requires stable record IDs. Sources were not changed.');
  return Object.fromEntries(rows.map(row => [row.id, row]));
}
function conductors(state) {
  const result = { ...state.conductors };
  if (state.conductor) {
    if (result.local && !equal(state.conductor, result.local)) throw new Error('The local Conductor has conflicting aliases. Sources were not changed.');
    result.local = state.conductor;
  }
  return result;
}
function validateSource(state) {
  validateState(state);
  for (const kind of COLLECTIONS) rowsById(state[kind]);
  for (const bucket of Object.values(conductors(state))) {
    // The existing validator checks the local alias; also check every remote
    // bucket explicitly before trusting any comparison.
    validateState({ sessions: [], hosts: [], conductor: bucket });
    rowsById(bucket.turns);
  }
  for (const kind of MAPS) if (state[kind] !== undefined && !object(state[kind])) throw new Error('Invalid recovery map.');
  if (state.consolidations !== undefined && !object(state.consolidations) && (!Array.isArray(state.consolidations) || state.consolidations.some(row => !object(row)))) throw new Error('Invalid consolidation records.');
}
function pendingActions(bucket = {}) {
  let started = 0, uncertain = 0;
  const visit = receipt => {
    if (!object(receipt)) return;
    if (receipt.status === 'started') started++;
    if (receipt.status === 'uncertain') uncertain++;
    if (receipt.dispatch) visit(receipt.dispatch);
    for (const child of Array.isArray(receipt.actions) ? receipt.actions : []) visit(child);
  };
  for (const receipt of Object.values(bucket.actionReceipts || {})) visit(receipt);
  for (const turn of bucket.turns || []) for (const receipt of turn.actions || []) visit(receipt);
  // Counts are occurrences, not unique effects: a receipt may also be in a turn.
  return { startedOccurrences: started, uncertainOccurrences: uncertain,
    activeTurns: (bucket.turns || []).filter(turn => ['running', 'pending', 'started'].includes(turn.status)).length };
}

export function compareRecoverySources({ baseline, legacy, workspace }) {
  for (const state of [baseline, legacy, workspace]) validateSource(state);
  const report = { version: 1, mode: 'read-only', applySupported: false, collections: {}, maps: {}, conductors: [], settings: [] };
  for (const kind of COLLECTIONS) report.collections[kind] = compareMaps(kind, ...[baseline, legacy, workspace].map(state => rowsById(state[kind])));
  for (const kind of MAPS) report.maps[kind] = compareMaps(kind, ...[baseline, legacy, workspace].map(state => state[kind] || {}));
  const buckets = [baseline, legacy, workspace].map(conductors);
  for (const host of [...new Set(buckets.flatMap(Object.keys))].sort()) {
    const [b, l, w] = buckets.map(source => source[host] || {});
    const item = {
      environment: host === 'local' ? 'local' : reference('environment', host),
      turns: compareMaps('turns:' + host, ...[b, l, w].map(bucket => rowsById(bucket.turns))),
      receipts: compareMaps('receipts:' + host, b.actionReceipts, l.actionReceipts, w.actionReceipts),
      pending: { baseline: pendingActions(b), legacy: pendingActions(l), workspace: pendingActions(w) },
      contextMemory: compareMaps('contextMemory:' + host, b.contextMemory, l.contextMemory, w.contextMemory),
      changedSettings: [], otherSettings: [],
    };
    // Memory and loop state are review inputs, never recovered execution grants.
    for (const key of ['memory', 'loop', 'settings', 'focus', 'usageTotals', 'assessments']) {
      if (!equal(l[key], w[key])) item.changedSettings.push({ kind: key, ...difference('conductor:' + host, key, b[key], l[key], w[key]) });
    }
    const described = new Set(['turns', 'actionReceipts', 'contextMemory', 'memory', 'loop', 'settings', 'focus', 'usageTotals', 'assessments']);
    for (const key of new Set([b, l, w].flatMap(Object.keys))) {
      if (!described.has(key) && !equal(l[key], w[key])) item.otherSettings.push(difference('conductor:' + host, key, b[key], l[key], w[key]));
    }
    report.conductors.push(item);
  }
  for (const key of ['hosts', 'preferences', 'prompts', 'taskSchemaVersion']) {
    if (!equal(legacy[key], workspace[key])) report.settings.push({ kind: key, ...difference('state', key, baseline[key], legacy[key], workspace[key]) });
  }
  // Older builds retain consolidation evidence as an ID-less array. Do not
  // invent identities or infer that missing entries authorize undoing a move.
  report.consolidations = { counts: [baseline, legacy, workspace].map(state => Object.keys(state.consolidations || {}).length),
    shapes: [baseline, legacy, workspace].map(state => state.consolidations === undefined ? 'absent' : Array.isArray(state.consolidations) ? 'array' : 'object'),
    equal: equal(legacy.consolidations || [], workspace.consolidations || []) };
  const known = new Set([...COLLECTIONS, ...MAPS, 'consolidations', 'stateVersion', 'hosts', 'preferences', 'prompts', 'taskSchemaVersion', 'conductors', 'conductor', 'directories']);
  report.extensionFields = [...new Set([baseline, legacy, workspace].flatMap(Object.keys))].filter(key => !known.has(key)).map(key => ({
    ref: reference('extension', key), present: [baseline, legacy, workspace].map(state => own(state, key)), equal: equal(legacy[key], workspace[key]),
  }));
  report.requirements = [
    'Retain unique and baseline-only records; absence does not establish deletion intent.',
    'Review differing identities, assignments, provenance, lifecycle, content and receipts before applying recovery.',
    'Preserve environment and project partitions; do not merge memory or infer authorization from saved records.',
    'Reconcile started or uncertain actions against their actual effects; never replay them from this report.',
    'Finish active turns and stop app/service writers before a validated recovery operation; preserve agent processes.',
  ];
  return report;
}

// A read-only adapter both prevents accidental saves and detects observations
// changing during inspection. It is not a lock or permission to apply later.
function observedReader(io) {
  const observations = new Map();
  const signature = (method, args) => {
    const value = io[method](...args);
    if (method === 'readFileSync') return hash(Buffer.isBuffer(value) ? value : Buffer.from(value));
    if (method === 'readdirSync') return [...value].sort();
    if (method === 'statSync') return { directory: value.isDirectory(), file: value.isFile() };
    return value;
  };
  const reader = {};
  for (const method of ['readFileSync', 'readdirSync', 'existsSync', 'statSync']) reader[method] = (...args) => {
    const value = io[method](...args);
    const key = JSON.stringify([method, ...args]);
    const digest = method === 'readFileSync' ? hash(Buffer.isBuffer(value) ? value : Buffer.from(value))
      : method === 'readdirSync' ? [...value].sort()
        : method === 'statSync' ? { directory: value.isDirectory(), file: value.isFile() } : value;
    const prior = observations.get(key);
    if (prior && !equal(prior.digest, digest)) throw new Error('Recovery sources changed during inspection.');
    observations.set(key, { method, args, digest });
    return value;
  };
  return { reader, verify() {
    for (const { method, args, digest } of observations.values()) {
      if (!equal(digest, signature(method, args))) throw new Error('Recovery sources changed during inspection.');
    }
    return hash(JSON.stringify([...observations].sort(([a], [b]) => a.localeCompare(b))));
  } };
}

// Source values are private recovery inputs, never part of the CLI report.
export function readRecoverySources(root, { io = fs } = {}) {
  const observed = observedReader(io), reader = observed.reader;
  let phase = 'migration backup';
  try {
    const baseline = JSON.parse(reader.readFileSync(path.join(root, 'state.migrated.json'), 'utf8'));
    validateSource(baseline);
    phase = 'legacy state';
    const legacy = JSON.parse(reader.readFileSync(path.join(root, 'state.json'), 'utf8'));
    validateSource(legacy);
    phase = 'workspace directories';
    const configFile = path.join(root, 'directories.json');
    if (reader.existsSync(configFile)) {
      const config = JSON.parse(reader.readFileSync(configFile, 'utf8'));
      if (!object(config)) throw new Error('Invalid directories.');
      const seen = new Set();
      for (const directory of Object.values(config)) {
        if (typeof directory !== 'string' || !path.isAbsolute(directory) || seen.has(path.resolve(directory)) || !reader.statSync(directory).isDirectory()) throw new Error('Invalid directory.');
        seen.add(path.resolve(directory));
      }
    }
    phase = 'Markdown workspace';
    const workspace = loadWorkspace(root, reader);
    const report = compareRecoverySources({ baseline, legacy, workspace });
    phase = 'source consistency';
    report.fingerprint = observed.verify();
    report.consistency = 'unchanged-during-inspection';
    return { sources: { baseline, legacy, workspace }, report };
  } catch {
    // JSON/schema/filesystem exceptions can contain transcript values or paths.
    throw new Error(`Cannot inspect ${phase}: sources are missing, invalid or changed during the read. Sources were not changed by the inspector.`);
  }
}

export function inspectWorkspaceRecovery(root, options) {
  return readRecoverySources(root, options).report;
}
