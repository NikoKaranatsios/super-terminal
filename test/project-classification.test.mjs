import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyProjects, classificationIdentity, matchingAssignment, setProjectAssignment, discoverRepositoryRoot } from '../server/project-classification.mjs';
import { identifyTmuxPanes, parseTmuxPanes } from '../server/discovery.mjs';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-project-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return fs.realpathSync(root);
}
function repository(root) {
  fs.mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/fixture\n');
  return root;
}
const project = (id, cwd, host = 'local') => ({ id, cwd, host, name: path.posix.basename(cwd), status: 'active' });
const processRow = (cwd, overrides = {}) => ({ id: 'external:42', kind: 'external', provider: 'codex', host: 'local', pid: 42, startedAt: '2020-01-01T00:00:00.000Z', cwd, ...overrides });

test('classification uses longest canonical root with segment boundaries and exact environment', t => {
  const root = temporary(t), nested = path.join(root, 'app', 'service');
  fs.mkdirSync(path.join(nested, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'application'));
  const state = { projects: [project('outer', path.join(root, 'app')), project('nested', nested), project('remote', nested, 'fixture-host')] };
  const result = classifyProjects(state, { sessions: [processRow(path.join(nested, 'src')), processRow(path.join(root, 'application'), { id: 'other' }), processRow(nested, { id: 'remote', host: 'fixture-host' })] });
  assert.deepEqual(result.sessions.map(s => s.projectId), ['nested', null, 'remote']);
  assert.equal(result.sessions[0].projectAssignment.source, 'path');
  assert.equal(result.changed, false);
});
test('symlink aliases resolve safely, including a missing path beneath a real symlink', t => {
  const root = temporary(t), first = path.join(root, 'first'), second = path.join(root, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  fs.symlinkSync(second, path.join(first, 'outside'));
  const state = { projects: [project('first', first), project('second', second)] };
  const result = classifyProjects(state, { history: [{ id: 'h', kind: 'history', host: 'local', cwd: path.join(first, 'outside', 'deleted') }] });
  assert.equal(result.history[0].projectId, 'second');
  assert.equal(result.history[0].projectAssignment.verified, false);
});
test('verified repository discovery is idempotent and never groups by equal basenames', t => {
  const root = temporary(t), first = repository(path.join(root, 'one', 'app')), second = repository(path.join(root, 'two', 'app'));
  fs.mkdirSync(path.join(first, 'src'));
  const state = { projects: [] };
  const inventory = { sessions: [processRow(path.join(first, 'src')), processRow(second, { id: 'external:43', pid: 43 })] };
  const initial = classifyProjects(state, inventory, { discover: true, now: 'fixture-time' });
  assert.equal(initial.createdProjects.length, 2);
  assert.notEqual(initial.sessions[0].projectId, initial.sessions[1].projectId);
  assert.equal(initial.sessions[0].projectAssignment.source, 'repository');
  assert.deepEqual(state.projects.map(p => p.name), ['app', 'app']);
  assert.equal(classifyProjects(state, inventory, { discover: true }).changed, false);
  assert.equal(state.projects.length, 2);
});
test('empty Git markers and nonrepository working directories do not create projects', t => {
  const root = temporary(t), empty = path.join(root, 'empty');
  fs.mkdirSync(path.join(empty, '.git'), { recursive: true });
  const state = { projects: [] };
  const result = classifyProjects(state, { sessions: [processRow(empty), processRow(root, { id: 'other' })] }, { discover: true });
  assert.equal(result.createdProjects.length, 0); assert.ok(result.sessions.every(s => s.projectId === null));
});
test('malformed FIFO Git markers do not block local or remote discovery', t => {
  const root = temporary(t), marker = path.join(root, '.git');
  execFileSync('python3', ['-c', 'import os,sys;os.mkfifo(sys.argv[1])', marker]);
  assert.equal(discoverRepositoryRoot(root), null);
  const source = fs.readFileSync(new URL('../server/remote-reader.py', import.meta.url), 'utf8').split('result=discover()')[0];
  assert.equal(execFileSync('python3', ['-c', `${source}\nprint(repository_root(sys.argv[1]))`, root], { encoding: 'utf8', timeout: 3000 }).trim(), 'None');
});
test('Git worktrees with a gitdir file and common object store are discoverable', t => {
  const root = temporary(t), main = repository(path.join(root, 'main')), worktree = path.join(root, 'worktree'), metadata = path.join(main, '.git', 'worktrees', 'fixture');
  fs.mkdirSync(worktree); fs.mkdirSync(metadata, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${metadata}\n`);
  fs.writeFileSync(path.join(metadata, 'HEAD'), 'a'.repeat(40));
  fs.writeFileSync(path.join(metadata, 'commondir'), '../..\n');
  assert.equal(discoverRepositoryRoot(worktree), worktree);
});
test('manual project moves override cwd without moving it and clear prior access fields', t => {
  const root = temporary(t), a = path.join(root, 'a'), b = path.join(root, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const row = processRow(a, { projectId: 'a', teamId: 'old-team', taskId: 'old-task', scope: { workSessionId: 'old-session' } });
  const state = { projects: [project('a', a), project('b', b)], assignments: {} };
  const assigned = setProjectAssignment(state, row, 'b');
  assert.equal(assigned.scope, null); assert.equal(assigned.teamId, null); assert.equal(assigned.taskId, null);
  const result = classifyProjects(state, { sessions: [row] }, { discover: true });
  assert.equal(result.sessions[0].projectId, 'b'); assert.equal(result.sessions[0].cwd, a);
  assert.equal(result.sessions[0].projectAssignment.source, 'manual');
  assert.equal(result.sessions[0].scope, null); assert.equal(result.sessions[0].taskId, null);
});
test('explicit Unassigned persists without rediscovery or prior team/task scope', t => {
  const root = repository(temporary(t));
  const row = processRow(root, { projectId: 'p', taskId: 'old', scope: { workSessionId: 'old' } });
  const state = { projects: [project('p', root)] };
  setProjectAssignment(state, row, null);
  const result = classifyProjects(state, { sessions: [row] }, { discover: true });
  assert.equal(result.sessions[0].projectId, null); assert.equal(result.sessions[0].scope, null);
  assert.equal(result.sessions[0].projectAssignment.reason, 'user-unassigned');
  assert.equal(result.createdProjects.length, 0);
});
test('managed launch assignment survives automatic classification and manual Unassigned', t => {
  const root = temporary(t), row = { id: 'managed', kind: 'managed', host: 'local', cwd: root, projectId: 'p' };
  const state = { projects: [project('p', path.join(root, 'configured'))], sessions: [row] };
  assert.equal(classifyProjects(state, { sessions: [row] }).sessions[0].projectAssignment.source, 'assigned');
  setProjectAssignment(state, row, null);
  assert.equal(state.sessions[0].projectId, null);
  assert.equal(classifyProjects(state, { sessions: [row] }).sessions[0].projectAssignment.source, 'manual');
});
test('managed enrollment preserves later explicit cross-project team and task changes', t => {
  const root = temporary(t), row = { id: 'managed', kind: 'managed', host: 'local', cwd: root, projectId: 'p' };
  const state = { projects: [project('p', root), project('other', path.join(root, 'other'))], sessions: [row] };
  setProjectAssignment(state, row, 'p');
  state.assignments[row.id].teamId = 'old-team'; state.assignments[row.id].taskId = 'old-task';
  Object.assign(row, { teamId: 'explicit-cross-project-team', taskId: 'new-task', scope: { workSessionId: 'new-session' } });
  const classified = classifyProjects(state, { sessions: [row] }).sessions[0];
  assert.equal(classified.teamId, 'explicit-cross-project-team'); assert.equal(classified.taskId, 'new-task');
  assert.equal(classified.scope.workSessionId, 'new-session');
  row.projectId = 'other';
  assert.equal(classifyProjects(state, { sessions: [row] }).sessions[0].projectId, 'other');
});
test('manual cross-host moves reject without mutation and equal names never imply identity', () => {
  const row = processRow('/repo/app', { host: 'fixture-a', processStartIdentity: 'boot:1' });
  const state = { projects: [project('a', '/repo/app', 'fixture-a'), project('b', '/repo/app', 'fixture-b')] };
  const before = JSON.stringify(state);
  assert.throws(() => setProjectAssignment(state, row, 'b'), /environment/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(classifyProjects(state, { sessions: [row] }).sessions[0].projectId, 'a');
});
test('PID reuse ignores the entire old assignment and freshly classifies by cwd', t => {
  const root = temporary(t), oldRoot = path.join(root, 'old'), nextRoot = path.join(root, 'next');
  fs.mkdirSync(oldRoot); fs.mkdirSync(nextRoot);
  const state = { projects: [project('old', oldRoot), project('next', nextRoot)] };
  const old = processRow(oldRoot); setProjectAssignment(state, old, 'old');
  state.assignments[old.id].scope = { workSessionId: 'old' };
  const replacement = { ...old, cwd: nextRoot, startedAt: '2020-01-02T00:00:00.000Z' };
  assert.equal(matchingAssignment(state, replacement).assignment, null);
  const result = classifyProjects(state, { sessions: [replacement] });
  assert.equal(result.sessions[0].projectId, 'next'); assert.equal(result.sessions[0].scope, undefined);
  assert.equal(result.sessions[0].projectAssignment.stale, true);
  assert.equal(result.diagnostics[0].reason, 'assignment-process-changed');
});
test('local legacy assignment needs exact start evidence; remote elapsed-time estimates never suffice', () => {
  const row = processRow('/fixture');
  const state = { assignments: { [row.id]: { projectId: 'p', startedAt: row.startedAt } } };
  assert.equal(matchingAssignment(state, row).reason, 'legacy-manual-assignment');
  assert.equal(matchingAssignment(state, { ...row, startedAt: null }).assignment, null);
  assert.equal(classificationIdentity({ ...row, host: 'fixture-host' }), null);
  assert.equal(matchingAssignment(state, { ...row, host: 'fixture-host' }).assignment, null);
});
test('stable tmux server and pane identities survive polling but reject server/PID/owner reuse', () => {
  const row = { id: 'tmux:%1', kind: 'tmux', host: 'local', pane: '%1', socket: 'fixture', serverIdentity: '100:start' };
  const state = { projects: [] }; setProjectAssignment(state, row, null);
  assert.ok(matchingAssignment(state, { ...row }).assignment);
  assert.equal(matchingAssignment(state, { ...row, serverIdentity: '100:replacement' }).assignment, null);
  assert.equal(matchingAssignment(state, { ...row, owner: 'other' }).assignment, null);
  assert.throws(() => setProjectAssignment(state, { ...row, serverIdentity: null }, null), /stable discovery identity/);
});
test('remote root discovery requires verified reader evidence, never touches the local filesystem', () => {
  const state = { projects: [] }, filesystem = new Proxy({}, { get() { throw new Error('Remote path used local filesystem'); } });
  const row = { id: 'remote', kind: 'external', host: 'fixture-host', cwd: '/srv/app/src', repository: '/srv/app', repositoryVerified: true };
  const result = classifyProjects(state, { sessions: [row] }, { discover: true, fs: filesystem, allowedHosts: ['fixture-host'] });
  assert.equal(result.createdProjects.length, 1); assert.equal(result.sessions[0].projectAssignment.source, 'repository');
  for (const variant of [{ ...row, repositoryVerified: false }, { ...row, repository: '/other' }, { ...row, cwd: '~/app' }]) {
    assert.equal(classifyProjects({ projects: [] }, { sessions: [variant] }, { discover: true, fs: filesystem }).createdProjects.length, 0);
  }
  assert.equal(classifyProjects({ projects: [] }, { sessions: [row] }, { discover: true, fs: filesystem, allowedHosts: [] }).sessions[0].projectId, null);
});
test('verified history roots classify live rows in the same pass with deterministic project IDs', () => {
  const state = { projects: [] }, live = { id: 'live', kind: 'external', host: 'fixture-host', cwd: '/srv/app/src' };
  const history = { id: 'history', kind: 'history', host: 'fixture-host', cwd: '/srv/app', repository: '/srv/app', repositoryVerified: true };
  const result = classifyProjects(state, { sessions: [live], history: [history] }, { discover: true });
  assert.equal(result.sessions[0].projectId, result.history[0].projectId);
  const second = classifyProjects({ projects: [] }, { history: [history] }, { discover: true });
  assert.equal(result.createdProjects[0].id, second.createdProjects[0].id);
});
test('ambiguous roots and shared background runtimes stay unclassified', t => {
  const root = temporary(t), state = { projects: [project('a', root), project('b', root)] };
  const result = classifyProjects(state, { sessions: [processRow(root), processRow(root, { id: 'runtime', runtime: true })] });
  assert.equal(result.sessions[0].projectAssignment.reason, 'ambiguous-project-root');
  assert.equal(result.sessions[1].projectAssignment.reason, 'shared-provider-runtime');
});
test('automatic project creation has a bounded batch size', t => {
  const root = temporary(t), state = { projects: [] };
  const rows = [0, 1, 2].map(i => processRow(repository(path.join(root, `repo-${i}`)), { id: `agent-${i}` }));
  assert.equal(classifyProjects(state, { sessions: rows }, { discover: true, maxDiscoveries: 1 }).createdProjects.length, 1);
  assert.equal(state.projects.length, 1);
});
test('local tmux identity enrichment reads each server once and contains identity failures', async () => {
  const rows = parseTmuxPanes('$0\tfixture\t/tmp\tcodex\t/dev/ttys999\t%1\t0\t123\n$0\tfixture\t/tmp\tclaude\t/dev/ttys998\t%2\t0\t123');
  let calls = 0;
  const identified = await identifyTmuxPanes(rows, async (command, args) => { calls++; assert.equal(command, 'ps'); assert.equal(args[1], '123'); return { stdout: 'Wed Jan  1 00:00:00 2020' }; });
  assert.equal(calls, 1); assert.equal(identified[0].serverIdentity, identified[1].serverIdentity);
  assert.equal((await identifyTmuxPanes(rows, async () => { throw new Error('Fixture failure'); }))[0].serverIdentity, null);
});
test('remote reader verifies fixture repositories and kernel start identities without discovery', t => {
  const root = temporary(t), repo = repository(path.join(root, 'repo')), proc = path.join(root, 'proc');
  fs.mkdirSync(path.join(proc, 'sys/kernel/random'), { recursive: true }); fs.mkdirSync(path.join(proc, '42'));
  fs.writeFileSync(path.join(proc, 'sys/kernel/random/boot_id'), '00000000-0000-0000-0000-000000000001\n');
  const fields = ['S', ...Array(18).fill('0'), '123456', '0'];
  fs.writeFileSync(path.join(proc, '42/stat'), `42 (name with ) parentheses) ${fields.join(' ')}`);
  const source = fs.readFileSync(new URL('../server/remote-reader.py', import.meta.url), 'utf8').split('result=discover()')[0];
  const script = `${source}\nprint(json.dumps(dict(repository=repository_metadata(sys.argv[1]),identity=process_start_identity(42,sys.argv[2]))))`;
  const result = JSON.parse(execFileSync('python3', ['-c', script, repo, proc], { encoding: 'utf8' }));
  assert.equal(result.repository.repository, repo); assert.equal(result.repository.repositoryVerified, true);
  assert.equal(result.identity, '00000000-0000-0000-0000-000000000001:123456');
});
