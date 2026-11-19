import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceStore, loadWorkspace, ensureEnvironmentDirectories } from '../server/markdown-store.mjs';
import { readRecoverySources } from '../server/workspace-recovery.mjs';
import { reconcileRecoverySources, applyWorkspaceRecovery, previewWorkspaceRecovery, recoveryTree } from '../server/workspace-reconcile.mjs';

const source = patch => ({ sessions: [], hosts: [], ...patch });
const turn = id => ({ id, status: 'complete', prompt: 'private prompt', answer: 'private answer' });
function fixture(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'st-reconcile-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'data'), archive = path.join(parent, 'archive');
  fs.mkdirSync(root);
  const baseline = source({ projects: [{ id: 'p', name: 'Saved', notes: 'Saved notes', host: 'local', cwd: '/project' }],
    teams: [{ id: 't', projectId: 'p', roster: [{ role: 'Core', provider: 'codex', task: 'saved task' }] }],
    sessions: [{ id: 'saved-agent', host: 'local', projectId: 'p', agentToken: 'saved-secret', tmuxSession: 'saved-tmux' }],
    conductor: { turns: [turn('old')], memory: 'saved memory', contextMemory: { 'project:p': 'saved project memory' }, loop: { state: 'running' }, actionReceipts: { old: { status: 'executed' } } },
  });
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(baseline));
  createWorkspaceStore(root, fs);
  const legacy = source({ projects: [{ ...baseline.projects[0], name: 'Current', notes: '' }],
    sessions: [{ id: 'new-agent', host: 'local', projectId: 'p', agentToken: 'current-secret', tmuxSession: 'current-tmux' }],
    conductor: { turns: [turn('new')], memory: 'current memory', contextMemory: {}, loop: { state: 'running' }, actionReceipts: { newer: { status: 'executed' } } },
  });
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(legacy));
  fs.writeFileSync(path.join(root, 'workspaces/local/custom.txt'), 'retain this private file');
  return { root, archive, baseline, legacy };
}
function apply(root, archive, options = {}) { return applyWorkspaceRecovery(root, archive, { assertOffline() {}, ...options }); }

test('recovery preview preserves sources and describes current-field policy without private values', t => {
  const { root } = fixture(t), before = recoveryTree(root);
  const report = previewWorkspaceRecovery(root);
  assert.equal(report.ready, true); assert.equal(report.applied, false);
  assert.equal(report.counts.teams, 1); assert.equal(report.counts.sessions, 2); assert.equal(report.conversations, 2);
  assert.doesNotMatch(JSON.stringify(report), /private|secret|Saved notes|saved-tmux/);
  assert.deepEqual(recoveryTree(root), before);
});

test('offline recovery backs up, stages, reopens and preserves both histories, roster, credentials and custom files', t => {
  const { root, archive } = fixture(t), before = recoveryTree(root);
  const result = apply(root, archive);
  assert.equal(result.applied, true); assert.equal(result.agentsLaunched, 0);
  const state = createWorkspaceStore(root, fs).state;
  assert.deepEqual(state.conductor.turns.map(t => t.id).sort(), ['new', 'old']);
  assert.equal(state.teams[0].roster[0].role, 'Core');
  assert.equal(state.sessions.length, 2);
  assert.deepEqual(state.sessions.map(s => s.agentToken).sort(), ['current-secret', 'saved-secret']);
  assert.equal(state.projects[0].notes, '', 'active project fields are not replaced by older values');
  assert.equal(state.conductor.memory, 'current memory');
  assert.deepEqual(state.conductor.contextMemory, {});
  assert.equal(state.conductor.loop.state, 'stopped');
  assert.equal(Object.keys(state.conductor.actionReceipts).length, 2);
  assert.equal(fs.readFileSync(path.join(root, 'workspaces/local/custom.txt'), 'utf8'), 'retain this private file');
  assert.equal(fs.existsSync(path.join(root, 'state.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'recovery.lock')), false);
  const journal = JSON.parse(fs.readFileSync(path.join(archive, 'journal.json')));
  assert.equal(journal.status, 'complete');
  assert.equal(JSON.parse(fs.readFileSync(path.join(archive, 'source-values.json'))).workspace.projects[0].notes, 'Saved notes');
  assert.equal(recoveryTree(path.join(archive, 'sources/state.json'))[''].hash, before['state.json'].hash);
  assert.equal(fs.statSync(path.join(archive, 'source-values.json')).mode & 0o777, 0o600);
  assert.ok(fs.readdirSync(path.dirname(root)).every(name => !name.startsWith('.st-')));
});

test('active conversations and uncertain nested actions block application without writes', t => {
  for (const patch of [ { status: 'running' }, { actions: [{ status: 'executed', dispatch: { actions: [{ status: 'uncertain' }] } }] } ]) {
    const { root, archive, legacy } = fixture(t);
    Object.assign(legacy.conductor.turns[0], patch);
    fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(legacy));
    const before = recoveryTree(root);
    assert.equal(previewWorkspaceRecovery(root).ready, false);
    assert.throws(() => apply(root, archive), /blocked/);
    assert.deepEqual(recoveryTree(root), before); assert.equal(fs.existsSync(archive), false);
  }
});

test('identity, boundary, receipt, conversation and settings conflicts fail closed', t => {
  for (const mutate of [
    s => { s.legacy.projects[0].cwd = '/different-project'; },
    s => { s.legacy.sessions = [{ ...s.workspace.sessions[0], projectId: 'other' }]; },
    s => { s.legacy.conductor.turns = [{ ...turn('old'), answer: 'different' }]; },
    s => { s.legacy.conductor.actionReceipts.old = { status: 'failed' }; },
    s => { s.legacy.preferences = { fontSize: 19 }; s.workspace.preferences = { fontSize: 13 }; },
    s => { s.legacy.sessions[0].tmuxSession = s.workspace.sessions[0].tmuxSession; },
  ]) {
    const { root } = fixture(t), { sources } = readRecoverySources(root); mutate(sources);
    assert.throws(() => reconcileRecoverySources(sources), /Conflicting/);
  }
});

test('baseline-only live records remain archived while baseline history stays readable', () => {
  const baseline = source({ tasks: [{ id: 'removed-task', status: 'doing' }], conductor: { turns: [turn('baseline')] } });
  const input = { baseline, legacy: source(), workspace: source() }, before = structuredClone(input);
  const { state, report } = reconcileRecoverySources(input);
  assert.equal(state.tasks.length, 0); assert.equal(report.baselineOnlyArchived.tasks, 1);
  assert.equal(state.conductor.turns[0].id, 'baseline'); assert.equal(state.conductor.loop.state, 'stopped');
  assert.deepEqual(input, before);
});

test('environment memory and historical turns remain in their source environment', () => {
  const input = { baseline: source(), legacy: source({ conductor: { turns: [turn('same')], memory: 'local' } }),
    workspace: source({ conductors: { remote: { turns: [turn('same')], memory: 'remote', contextMemory: { 'project:r': 'remote-project' } } } }) };
  const { state } = reconcileRecoverySources(input);
  assert.equal(state.conductor.memory, 'local'); assert.equal(state.conductors.remote.memory, 'remote');
  assert.deepEqual(state.conductors.remote.contextMemory, { 'project:r': 'remote-project' });
  assert.equal(state.conductors.remote.turns.length, 1);
});

test('writer checks, stale fingerprints and existing archive/lock fail without overwriting sources', t => {
  const { root, archive } = fixture(t), before = recoveryTree(root);
  assert.throws(() => applyWorkspaceRecovery(root, archive), /offline writer check/);
  assert.throws(() => apply(root, archive, { assertOffline() { throw new Error('writer active'); } }), /writer active/);
  assert.throws(() => apply(root, archive, { expectedFingerprint: 'outdated' }), /stale/);
  fs.mkdirSync(archive); assert.throws(() => apply(root, archive), /new recovery archive/);
  assert.deepEqual(recoveryTree(root), before);
  fs.rmSync(archive, { recursive: true }); fs.writeFileSync(path.join(root, 'recovery.lock'), 'existing');
  assert.throws(() => apply(root, archive), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(root, 'recovery.lock'), 'utf8'), 'existing');
});

test('recovery lock prevents startup, directory initialization and already-open saves', t => {
  const { root } = fixture(t);
  fs.renameSync(path.join(root, 'state.json'), path.join(root, 'legacy-away.json'));
  const opened = createWorkspaceStore(root, fs);
  fs.writeFileSync(path.join(root, 'recovery.lock'), 'offline recovery');
  const before = recoveryTree(root);
  assert.throws(() => createWorkspaceStore(root, fs), /recovery/);
  assert.throws(() => ensureEnvironmentDirectories(root, root, [], fs), /recovery/);
  assert.throws(() => opened.save(), /recovery/);
  assert.deepEqual(recoveryTree(root), before);
});

test('a source write during staging aborts without replacing any original tree', t => {
  const { root, archive } = fixture(t); let checks = 0;
  const original = recoveryTree(path.join(root, 'workspaces/local'));
  assert.throws(() => apply(root, archive, { assertOffline() {
    if (++checks === 2) fs.writeFileSync(path.join(root, 'workspaces/local/custom.txt'), 'new owner content');
  } }), /changed before replacement/);
  const current = recoveryTree(path.join(root, 'workspaces/local'));
  delete original['custom.txt']; delete current['custom.txt']; assert.deepEqual(current, original);
  assert.equal(fs.readFileSync(path.join(root, 'workspaces/local/custom.txt'), 'utf8'), 'new owner content');
  assert.equal(fs.existsSync(path.join(root, 'state.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'recovery.lock')), false);
});

test('partial replacement rolls back every original source byte and keeps verified backups', t => {
  const { root, archive } = fixture(t), before = recoveryTree(root); let failed = false;
  const io = new Proxy(fs, { get(target, key) {
    if (key !== 'renameSync') return target[key];
    return (from, to) => {
      if (!failed && from.includes('.st-next-') && to.endsWith('/local')) { failed = true; throw new Error('injected replacement failure'); }
      return target.renameSync(from, to);
    };
  } });
  assert.throws(() => apply(root, archive, { io }), /original sources are preserved/);
  assert.deepEqual(recoveryTree(root), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(archive, 'journal.json'))).status, 'rolled-back');
  assert.equal(fs.existsSync(path.join(archive, 'sources/state.json')), true);
});

test('failed rollback retains the startup lock and verified original backups', t => {
  const { root, archive } = fixture(t); let fail = false;
  const io = new Proxy(fs, { get(target, key) {
    if (key !== 'renameSync') return target[key];
    return (from, to) => {
      if (from.includes('.st-next-') && to.endsWith('/local')) { fail = true; throw new Error('replacement failed'); }
      if (fail && from.includes('.st-old-')) throw new Error('rollback failed');
      return target.renameSync(from, to);
    };
  } });
  assert.throws(() => apply(root, archive, { io }), /manual rollback/);
  assert.equal(fs.existsSync(path.join(root, 'recovery.lock')), true);
  assert.equal(fs.existsSync(path.join(archive, 'sources/tree-0/runtime.json')), true);
  assert.throws(() => createWorkspaceStore(root, fs), /recovery/);
});

test('symlinks and an archive inside a source directory are refused', t => {
  const { root, archive } = fixture(t);
  assert.throws(() => apply(root, path.join(root, 'archive')), /outside/);
  fs.symlinkSync('/tmp', path.join(root, 'workspaces/local/link'));
  assert.throws(() => apply(root, archive), /symbolic link/);
  assert.equal(fs.existsSync(path.join(root, 'state.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'recovery.lock')), false);
});
