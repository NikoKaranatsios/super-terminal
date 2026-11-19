import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createWorkspaceStore, embedRecord } from '../server/markdown-store.mjs';
import { compareRecoverySources, inspectWorkspaceRecovery } from '../server/workspace-recovery.mjs';

const source = patch => ({ sessions: [], hosts: [], ...patch });
const turn = id => ({ id, prompt: 'private-prompt', answer: 'private-answer' });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'super-terminal-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseline = source({
    projects: [{ id: 'private-project', name: 'private-name' }],
    teams: [{ id: 'private-team', projectId: 'private-project', roster: [{ role: 'private-role', provider: 'codex', task: 'private-task' }] }],
    conductor: { turns: [turn('old')], actionReceipts: { old: { status: 'uncertain', result: { error: 'private-error' } } } },
  });
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(baseline));
  createWorkspaceStore(root, fs);
  const legacy = source({ sessions: [{ id: 'private-agent', agentToken: 'private-token', host: 'private-host', cwd: '/private/path' }],
    conductor: { turns: [turn('new')], actionReceipts: { new: { status: 'started' } } } });
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(legacy));
  return { root, baseline, legacy };
}
function files(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true }).sort()
    .filter(file => fs.statSync(path.join(root, file)).isFile())
    .map(file => [file, fs.readFileSync(path.join(root, file))]));
}

test('inspection preserves both stores and backup byte-for-byte and reports unique work without exposing content', t => {
  const { root } = fixture(t), before = files(root);
  const report = inspectWorkspaceRecovery(root);
  assert.equal(report.mode, 'read-only');
  assert.equal(report.applySupported, false);
  assert.equal(report.collections.teams.onlyWorkspace, 1);
  assert.equal(report.collections.sessions.onlyLegacy, 1);
  assert.equal(report.conductors[0].turns.onlyLegacy, 1);
  assert.equal(report.conductors[0].turns.onlyWorkspace, 1);
  assert.equal(report.conductors[0].pending.legacy.startedOccurrences, 1);
  assert.equal(report.conductors[0].pending.workspace.uncertainOccurrences, 1);
  assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(report), /private-|\/private\/|super-terminal-recovery-/);
  assert.deepEqual(files(root), before);
  assert.deepEqual(inspectWorkspaceRecovery(root), report, 'the read-only result is deterministic');
});

test('same-ID privacy, process, receipt and content differences require review instead of choosing the newer store', () => {
  const baseline = source({ sessions: [{ id: 'agent', projectId: 'p', agentToken: 'old' }],
    projects: [{ id: 'p', notes: 'private-notes', historyRoots: [{ host: 'local', cwd: '/old' }] }],
    historyProvenance: { history: ['p'] }, lifecycle: { agent: 'stopped' },
    conductor: { turns: [turn('shared')], contextMemory: { 'project:p': 'private-memory' },
      actionReceipts: { effect: { status: 'started' } } } });
  const legacy = structuredClone(baseline), workspace = structuredClone(baseline);
  legacy.sessions[0].projectId = 'other'; legacy.sessions[0].agentToken = 'private-new-token';
  legacy.projects[0].notes = ''; delete legacy.projects[0].historyRoots;
  legacy.historyProvenance.history = ['other']; legacy.lifecycle.agent = 'running';
  legacy.conductor.turns[0].answer = 'different private-answer';
  legacy.conductor.actionReceipts.effect = { status: 'executed' };
  workspace.conductor.actionReceipts.effect = { status: 'uncertain' };
  workspace.conductor.contextMemory['project:p'] = 'different private-memory';
  const before = structuredClone({ baseline, legacy, workspace });
  const report = compareRecoverySources({ baseline, legacy, workspace });
  assert.deepEqual(report.collections.sessions.differences[0].groups, ['boundary', 'identity']);
  assert.equal(report.collections.projects.differences[0].baseline, 'matches-workspace');
  assert.deepEqual(report.collections.projects.differences[0].groups, ['content', 'relationships']);
  assert.equal(report.maps.historyProvenance.differences.length, 1);
  assert.equal(report.maps.lifecycle.differences.length, 1);
  assert.equal(report.conductors[0].turns.differences.length, 1);
  assert.equal(report.conductors[0].receipts.differences[0].baseline, 'differs-from-both');
  assert.equal(report.conductors[0].contextMemory.differences.length, 1);
  assert.deepEqual({ baseline, legacy, workspace }, before);
  assert.doesNotMatch(JSON.stringify(report), /private-|project:p/);
});

test('missing current records are retained in baseline-only counts and unknown fields are disclosed without their names', () => {
  const baseline = source({ tasks: [{ id: 'lost', title: 'Keep me' }], consolidations: [{ from: 'private-source', to: 'private-target' }], 'private-extension': { secret: 'private-value' } });
  const report = compareRecoverySources({ baseline, legacy: source(), workspace: source() });
  assert.equal(report.collections.tasks.baselineOnly, 1);
  assert.equal(report.extensionFields.length, 1);
  assert.deepEqual(report.extensionFields[0].present, [true, false, false]);
  assert.deepEqual(report.consolidations.counts, [1, 0, 0]);
  assert.doesNotMatch(JSON.stringify(report), /private-|Keep me/);
});

test('environment conversations and memories stay partitioned, and remote malformed state fails validation', () => {
  const baseline = source({ conductor: { turns: [turn('same')] } });
  const workspace = source({ conductor: { turns: [turn('same')] }, conductors: {
    'private-remote': { turns: [turn('same')], contextMemory: { 'project:private': 'remote private-memory' } },
  } });
  const report = compareRecoverySources({ baseline, legacy: baseline, workspace });
  assert.equal(report.conductors.length, 2);
  assert.equal(report.conductors.find(c => c.environment === 'local').turns.identical, 1);
  assert.equal(report.conductors.find(c => c.environment !== 'local').turns.onlyWorkspace, 1);
  assert.doesNotMatch(JSON.stringify(report), /private-/);
  workspace.conductors['private-remote'].turns = {};
  assert.throws(() => compareRecoverySources({ baseline, legacy: baseline, workspace }));
});

test('started actions in nested dispatches and active turns are reported without counting them as completed', () => {
  const legacy = source({ conductor: { turns: [{ ...turn('active'), status: 'running', actions: [
    { status: 'started', dispatch: { status: 'started', actions: [{ status: 'uncertain' }] } },
  ] }] } });
  const report = compareRecoverySources({ baseline: source(), legacy, workspace: source() });
  assert.deepEqual(report.conductors[0].pending.legacy, { startedOccurrences: 2, uncertainOccurrences: 1, activeTurns: 1 });
});

test('malformed, missing, future and identity-free input fails without writes or private parser output', t => {
  const { root } = fixture(t);
  const file = path.join(root, 'state.json');
  for (const bad of ['{"private-secret": "bad', JSON.stringify(source({ stateVersion: 999 })), JSON.stringify(source({ projects: [{ name: 'private-name' }] }))]) {
    fs.writeFileSync(file, bad); const before = files(root);
    assert.throws(() => inspectWorkspaceRecovery(root), error => {
      assert.match(error.message, /Cannot inspect legacy state/);
      assert.doesNotMatch(error.message, /private-|super-terminal-recovery-/); return true;
    });
    assert.deepEqual(files(root), before);
  }
  fs.rmSync(file);
  assert.throws(() => inspectWorkspaceRecovery(root), /Cannot inspect legacy state/);
});

test('invalid directory configuration cannot silently hide a saved environment', t => {
  const { root } = fixture(t), config = path.join(root, 'directories.json');
  for (const value of ['invalid private-config', '[]', JSON.stringify({ local: '/nonexistent-private-directory' }), JSON.stringify({ local: root, other: root })]) {
    fs.writeFileSync(config, value); const before = files(root);
    assert.throws(() => inspectWorkspaceRecovery(root), /Cannot inspect workspace directories/);
    assert.deepEqual(files(root), before);
  }
});

test('changes during inspection fail closed, including newly added turn files', t => {
  for (const mutation of ['legacy', 'new-turn']) {
    const { root } = fixture(t); let fired = false;
    const file = path.join(root, 'state.json');
    const io = new Proxy(fs, { get(target, key) {
      if (key !== 'readFileSync') return target[key];
      return (...args) => {
        const result = target.readFileSync(...args);
        if (!fired && args[0] === path.join(root, 'runtime', 'runtime.json')) {
          fired = true;
          if (mutation === 'legacy') fs.writeFileSync(file, JSON.stringify(source({ conductor: { turns: [turn('newer')] } })));
          else fs.writeFileSync(path.join(root, 'workspaces', 'local', 'turns', 'new.md'), embedRecord(turn('newer')));
        }
        return result;
      };
    } });
    if (mutation === 'legacy') assert.throws(() => inspectWorkspaceRecovery(root, { io }), /Cannot inspect source consistency/);
    else {
      // A change before a directory's first read is a valid new snapshot.
      assert.equal(inspectWorkspaceRecovery(root, { io }).conductors[0].turns.workspace, 2);
      const dirs = path.join(root, 'workspaces', 'local', 'turns'); let seen = 0;
      const late = new Proxy(fs, { get(target, key) {
        if (key !== 'readdirSync') return target[key];
        return (...args) => {
          const result = target.readdirSync(...args);
          if (args[0] === dirs && ++seen === 1) fs.writeFileSync(path.join(dirs, 'late.md'), embedRecord(turn('late')));
          return result;
        };
      } });
      assert.throws(() => inspectWorkspaceRecovery(root, { io: late }), /Cannot inspect source consistency/);
    }
  }
});

test('the CLI performs only inspection and rejects apply-like arguments', t => {
  const { root } = fixture(t), before = files(root);
  const script = new URL('../scripts/inspect-workspace-recovery.mjs', import.meta.url);
  const report = JSON.parse(execFileSync(process.execPath, [script.pathname, root], { encoding: 'utf8' }));
  assert.equal(report.applySupported, false);
  const denied = spawnSync(process.execPath, [script.pathname, root, '--apply'], { encoding: 'utf8' });
  assert.equal(denied.status, 1); assert.match(denied.stderr, /no apply operation/);
  assert.deepEqual(files(root), before);
});
