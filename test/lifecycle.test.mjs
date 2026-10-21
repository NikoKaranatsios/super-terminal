import test from 'node:test';
import assert from 'node:assert/strict';
import { controlAgent, removeAgent } from '../server/lifecycle.mjs';

function fixture(overrides = {}) {
  const target = { id: 'owned-fixture', kind: 'managed', host: 'local', tmuxName: 'st-fixture', title: 'Fixture agent', status: 'running', tty: '/dev/ttys999', agentToken: 'fixture-token', ...overrides };
  const calls = [];
  const context = { store: { state: { sessions: [{ ...target }], lifecycle: {}, tasks: [] }, save() {} }, allowedHosts: ['fixture-host'], tmuxRun: async args => { calls.push(['tmux', ...args]); return { stdout: '' }; }, run: async (command, args) => { calls.push([command, ...args]); return { stdout: args.includes('pgid=') ? '100' : '101 100 T+' }; }, signal: (pid, signal) => calls.push([pid, signal]), removeBridge: async () => calls.push(['credentials']), closeBrowser: async () => calls.push(['browser']) };
  return { target, context, calls };
}
test('managed stop revokes credentials, closes owned resources and removal is safe', async () => {
  const { target, context, calls } = fixture();
  const outcome = await removeAgent(target, context);
  assert.equal(outcome.removed, true); assert.equal(outcome.ok, true);
  assert.equal(context.store.state.sessions.length, 0);
  assert.ok(calls.some(c => c[0] === 'tmux' && c[1] === 'kill-session'));
  assert.ok(calls.some(c => c[0] === 'credentials'));
  assert.ok(calls.some(c => c[0] === 'browser'));
});
test('lost remote stop keeps unknown process record while revoking its token', async () => {
  const { target, context, calls } = fixture({ host: 'fixture-host', connectionLost: true });
  context.run = async () => { throw new Error('Fixture SSH unavailable'); };
  const outcome = await removeAgent(target, context);
  assert.equal(outcome.removed, false); assert.equal(outcome.state, 'unknown');
  assert.equal(context.store.state.sessions.length, 1);
  assert.equal(context.store.state.sessions[0].agentToken, undefined);
  assert.ok(context.store.state.sessions[0].enrollmentRevokedAt);
  assert.ok(calls.some(c => c[1] === 'kill-session'));
  assert.match(outcome.results.find(r => r.resource === 'remote-process').error, /SSH/);
});
test('pause and resume resolve only one foreground process group', async () => {
  const { target, context, calls } = fixture();
  assert.equal((await controlAgent(target, 'paused', context)).ok, true);
  assert.ok(calls.some(c => c[0] === -100 && c[1] === 'SIGSTOP'));
  assert.equal(context.store.state.sessions[0].agentToken, 'fixture-token');
  context.run = async () => ({ stdout: '101 100 S+\n201 200 S+' });
  const result = await controlAgent(target, 'paused', context);
  assert.equal(result.ok, false); assert.match(result.results[0].error, /one foreground job/);
});
test('a paused remote managed job resumes before its tmux session is stopped', async () => {
  const { target, context, calls } = fixture({ host: 'fixture-host', status: 'paused' });
  context.run = async (command, args) => {
    const text = args.at(-1); calls.push([command, text]);
    return { stdout: text.includes('list-panes') ? '/dev/pts/1' : text.includes('pgid=') && !text.includes('pid=,') ? '100' : '101 100 T+' };
  };
  const outcome = await controlAgent(target, 'stopped', context);
  assert.equal(outcome.ok, true);
  const resume = calls.findIndex(c => c[0] === 'ssh' && c[1].includes('kill -CONT'));
  const stop = calls.findIndex(c => c[0] === 'ssh' && c[1].includes('tmux kill-session'));
  assert.ok(resume >= 0 && stop > resume);
});
test('PID reuse and shared provider services are protected', async () => {
  const { target, context, calls } = fixture({ kind: 'external', provider: 'codex', pid: 101, startedAt: '2020-01-01T00:00:00.000Z' });
  context.run = async (_command, args) => ({ stdout: args.includes('comm=') ? 'codex' : 'Thu Jan  2 00:00:00 2020' });
  const outcome = await controlAgent(target, 'paused', context);
  assert.equal(outcome.ok, false); assert.match(outcome.results[0].error, /start identity changed/);
  assert.ok(!calls.some(c => typeof c[0] === 'number'));
  await assert.rejects(controlAgent({ ...target, runtime: true }, 'stopped', context), /shared provider/);
});
test('browser cleanup failure is explicit and keeps retryable record', async () => {
  const { target, context } = fixture();
  context.closeBrowser = async () => { throw new Error('Fixture browser failure'); };
  const outcome = await removeAgent(target, context);
  assert.equal(outcome.state, 'stopped'); assert.equal(outcome.partial, true); assert.equal(outcome.removed, false);
  assert.equal(context.store.state.sessions.length, 1);
});
