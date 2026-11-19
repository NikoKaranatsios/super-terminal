import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeTasks, createTask, updateTask, recordTaskEvent, taskSummary, taskDescendsFrom } from '../server/tasks.mjs';

function fixture() {
  const state = { projects: [{ id: 'p', name: 'Example', host: 'local', cwd: '/fixture/example' }, { id: 'other', name: 'Other', host: 'local', cwd: '/fixture/other' }], sessions: [], workSessions: [{ id: 'w', title: 'Work', status: 'active', projects: [{ id: 'nested', canonicalProjectId: 'p', name: 'Example', host: 'local', cwd: '/fixture/example', goals: [{ id: 'g', title: 'Review', status: 'todo', notes: '' }] }] }] };
  initializeTasks(state);
  const agent = { id: 'a', projectId: 'p', scope: { workSessionId: 'w', projectId: 'nested', goalId: 'g' }, assignmentRevision: 2, attemptId: 'attempt' };
  state.sessions.push(agent);
  return { state, agent };
}
test('migration retains IDs, completion history, canonical project links, and is repeat-safe', () => {
  const { state } = fixture();
  const canonical = state.tasks[0];
  assert.equal(canonical.id, 'g'); assert.equal(canonical.projectId, 'p');
  const before = JSON.stringify(state);
  initializeTasks(state);
  assert.equal(JSON.stringify(state), before);
  updateTask(state, 'g', { status: 'done', notes: 'Fixture checks passed' });
  assert.equal(state.workSessions[0].projects[0].goals[0].status, 'done');
  assert.equal(state.tasks[0].evidence[0].kind, 'reported');
});
test('invalid completion and stale revisions cannot partly mutate task or legacy goal', () => {
  const { state } = fixture();
  const before = JSON.stringify(state);
  assert.throws(() => updateTask(state, 'g', { title: 'Changed', status: 'done' }), /evidence/);
  assert.equal(JSON.stringify(state), before);
  updateTask(state, 'g', { status: 'doing' }, { expectedRevision: 1 });
  assert.throws(() => updateTask(state, 'g', { notes: 'stale' }, { expectedRevision: 1 }), /changed/);
  assert.equal(state.tasks[0].notes, '');
});
test('new scoped tasks appear in legacy project goals and keep canonical IDs', () => {
  const { state } = fixture();
  const task = createTask(state, { title: 'Additional check', projectId: 'p', scope: { workSessionId: 'w', projectId: 'p' } });
  assert.equal(task.scope.goalId, task.id);
  assert.equal(state.workSessions[0].projects[0].goals[1].id, task.id);
  initializeTasks(state);
  assert.equal(state.tasks.length, 2);
});
test('agent events are scoped, attributed, ordered and exact retries are idempotent', () => {
  const { state, agent } = fixture();
  const event = { taskId: 'g', eventId: 'event', sequence: 1, assignmentRevision: 2, attemptId: 'attempt', status: 'done', notes: 'Checks passed' };
  const first = recordTaskEvent(state, agent, event);
  const revision = first.task.revision;
  assert.equal(recordTaskEvent(state, agent, event).duplicate, true);
  assert.equal(state.tasks[0].revision, revision);
  assert.equal(state.tasks[0].evidence[0].actor, 'agent:a');
  assert.throws(() => recordTaskEvent(state, agent, { ...event, notes: 'Different' }), /different content/);
  assert.throws(() => recordTaskEvent(state, agent, { ...event, eventId: 'new' }), /Stale event/);
  assert.throws(() => recordTaskEvent(state, agent, { ...event, assignmentRevision: 1 }), /Assignment changed/);
  assert.throws(() => recordTaskEvent(state, agent, { ...event, attemptId: 'old' }), /attempt changed/);
  const outsider = createTask(state, { title: 'Other', projectId: 'other' });
  assert.throws(() => recordTaskEvent(state, agent, { taskId: outsider.id, notes: 'Forged' }), /outside/);
});
test('agent creation is retry-safe, links subtasks and never grants new project scope', () => {
  const { state, agent } = fixture();
  const event = { operation: 'create', title: 'Regression test', clientKey: 'subtask', eventId: 'create-1', notes: 'Add coverage' };
  const first = recordTaskEvent(state, agent, event);
  assert.equal(first.task.parentTaskId, 'g');
  assert.equal(first.task.projectId, 'p');
  assert.equal(first.task.agentId, agent.id);
  assert.equal(recordTaskEvent(state, agent, { ...event, eventId: 'retry-id' }).task.id, first.task.id);
  assert.equal(state.tasks.length, 2);
  assert.throws(() => recordTaskEvent(state, agent, { ...event, clientKey: 'bad', projectId: 'other' }), /outside|conflicts/);
  assert.throws(() => recordTaskEvent(state, agent, { operation: 'create', title: 'No retry identity' }), /stable/);
  const sessionAgent = { ...agent, scope: { workSessionId: 'w' }, projectId: null };
  assert.throws(() => recordTaskEvent(state, sessionAgent, { ...event, clientKey: 'foreign', projectId: 'other' }), /outside/);
});
test('team role agents create and report descendants while sibling role grants remain separate', () => {
  const { state, agent } = fixture();
  const role = createTask(state, { title: 'Role work', projectId: 'p', scope: agent.scope, parentTaskId: 'g', agentId: agent.id });
  agent.taskId = role.id;
  const child = recordTaskEvent(state, agent, { operation: 'create', title: 'Role check', clientKey: 'role-check' }).task;
  assert.equal(child.parentTaskId, role.id);
  assert.equal(taskDescendsFrom(state, child, 'g'), true);
  recordTaskEvent(state, agent, { taskId: child.id, status: 'doing', notes: 'Started fixture check' });
  const deeper = createTask(state, { title: 'Nested check', projectId: 'p', scope: agent.scope, parentTaskId: child.id, agentId: agent.id });
  recordTaskEvent(state, agent, { taskId: deeper.id, status: 'done', notes: 'Fixture checks passed' });
  const sibling = createTask(state, { title: 'Other role', projectId: 'p', scope: agent.scope, parentTaskId: 'g' });
  assert.throws(() => recordTaskEvent(state, agent, { taskId: sibling.id, notes: 'Cannot take over another role' }), /assigned task/);
});
test('ancestor grants reject cycles, broken links, scope escapes, and excessive depth', () => {
  const { state, agent } = fixture();
  const root = state.tasks.find(t => t.id === 'g');
  const child = createTask(state, { title: 'Child', projectId: 'p', scope: agent.scope, parentTaskId: 'g', agentId: agent.id });
  const report = () => recordTaskEvent(state, agent, { taskId: child.id, notes: 'Must be rejected' });
  root.parentTaskId = child.id;
  assert.equal(taskDescendsFrom(state, child, 'g'), false);
  assert.throws(report, /invalid ancestry/);
  delete root.parentTaskId;
  child.parentTaskId = 'missing'; assert.throws(report, /invalid ancestry/);
  const bridge = { ...root, id: 'bridge', parentTaskId: 'g', projectId: 'other' };
  state.tasks.push(bridge); child.parentTaskId = bridge.id;
  assert.throws(report, /invalid ancestry/);
  bridge.projectId = 'p'; bridge.scope = { ...root.scope, workSessionId: 'other-session' };
  assert.throws(report, /invalid ancestry/);
  assert.throws(() => createTask(state, { title: 'Escaped parent', projectId: 'p', scope: agent.scope, parentTaskId: bridge.id }), /outside/);
  let previous = 'g';
  for (let i = 0; i < 64; i++) { const row = { ...root, id: `depth-${i}`, parentTaskId: previous }; state.tasks.push(row); previous = row.id; }
  child.parentTaskId = previous;
  assert.throws(report, /invalid ancestry/);
  assert.equal(child.notes, '');
});
test('revoked agents and agents assigned to other tasks cannot change progress', () => {
  const { state, agent } = fixture();
  assert.throws(() => recordTaskEvent(state, { ...agent, enrollmentRevokedAt: 'revoked' }, { taskId: 'g', notes: 'Late' }), /not active/);
  state.sessions.push({ id: 'b' });
  updateTask(state, 'g', { agentId: 'b' });
  assert.throws(() => recordTaskEvent(state, agent, { taskId: 'g', notes: 'Late' }), /another agent/);
});
test('unprojected explicitly assigned tasks can report and create only their subtasks', () => {
  const state = { projects: [], sessions: [{ id: 'a' }], tasks: [] };
  const task = createTask(state, { title: 'Ad hoc', agentId: 'a' });
  const agent = { id: 'a', taskId: task.id };
  recordTaskEvent(state, agent, { notes: 'Started', status: 'doing' });
  const child = recordTaskEvent(state, agent, { operation: 'create', title: 'Child', clientKey: 'child' }).task;
  assert.equal(child.parentTaskId, task.id);
});
test('bounded task activity preserves latest evidence and receipt compaction rejects old sequences', () => {
  const { state, agent } = fixture();
  for (let i = 1; i <= 505; i++) recordTaskEvent(state, agent, { taskId: 'g', eventId: `e${i}`, sequence: i, notes: `Milestone ${i}` });
  assert.equal(state.tasks[0].activity.length, 40);
  assert.equal(state.taskEvents.length, 500);
  assert.throws(() => recordTaskEvent(state, agent, { taskId: 'g', eventId: 'e1', sequence: 1, notes: 'Milestone 1' }), /Stale/);
  assert.equal(taskSummary(state, { workSessionId: 'w' }).total, 1);
});
