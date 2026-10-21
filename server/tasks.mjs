import { createHash, randomUUID } from 'node:crypto';
import { resolveScope } from './work-sessions.mjs';
import { projectOf, allowedProjectIds, canReadProjectContent } from './project-access.mjs';

export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done', 'stopped'];
const own = (value, key) => Object.hasOwn(value, key);
const now = () => new Date().toISOString();
function string(value, name, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0') || (required && !value.trim())) throw new Error(`${name} must be ${required ? 'nonempty ' : ''}text of up to ${limit} characters.`);
  return value.trim();
}
function actorName(actor = 'user') { return typeof actor === 'string' ? actor : `${actor.type || 'agent'}:${actor.id}`; }
function evidenceRows(value, actor, at) {
  if (value === undefined) return [];
  const rows = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(rows) || rows.length > 12) throw new Error('Evidence must contain at most 12 concise reports.');
  return rows.map(row => {
    if (typeof row === 'string') row = { summary: row };
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid evidence report.');
    const result = { summary: string(row.summary || row.text || '', 'Evidence summary', 2000, true), actor, createdAt: at, kind: 'reported' };
    for (const field of ['command', 'result', 'ref']) if (row[field] !== undefined) result[field] = string(row[field], `Evidence ${field}`, 2000);
    return result;
  });
}
function validateStatus(status) {
  if (!TASK_STATUSES.includes(status)) throw new Error(`Task status must be ${TASK_STATUSES.join(', ')}.`);
  return status;
}
function taskScope(state, input) {
  return input ? resolveScope(state.workSessions || [], input) : null;
}
function projectForScope(state, scope) {
  const p = state.workSessions?.find(s => s.id === scope?.workSessionId)?.projects.find(p => p.id === scope?.projectId);
  return p?.canonicalProjectId || (state.projects?.some(c => c.id === p?.id) ? p.id : null);
}
function projectId(state, input, scope) {
  const scoped = projectForScope(state, scope);
  const id = input || scoped || null;
  if (id && !state.projects?.some(p => p.id === id)) throw new Error('Project not found.');
  if (scoped && id !== scoped) throw new Error('Task project conflicts with its working-session scope.');
  return id;
}
function contentSources(...values) {
  const sources = new Set();
  for (const value of values) {
    if (value == null) continue;
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id || id.length > 200 || id.includes('\0'))) throw new Error('Invalid content project provenance.');
    for (const id of value) sources.add(id);
  }
  return [...sources].sort();
}
function inheritedSources(state, task) {
  const sources = [], seen = new Set([task.id]);
  let id = task.parentTaskId || (task.scope?.goalId !== task.id ? task.scope?.goalId : null) || task.carriedFromTaskId;
  for (let depth = 0; id && depth < 64; depth++) {
    if (seen.has(id)) throw new Error('Invalid content project ancestry.');
    seen.add(id);
    const parent = state.tasks?.find(t => t.id === id);
    if (!parent) break;
    sources.push(...contentSources(parent.contentProjectIds, parent.projectId ? [parent.projectId] : []));
    id = parent.parentTaskId || (parent.scope?.goalId !== parent.id ? parent.scope?.goalId : null) || parent.carriedFromTaskId;
    if (depth === 63 && id) throw new Error('Invalid content project ancestry.');
  }
  return sources;
}
function mirror(state, task) {
  for (const s of state.workSessions || []) for (const p of s.projects || []) {
    const goal = p.goals?.find(g => g.id === task.id);
    if (goal) Object.assign(goal, { title: task.title, status: task.status, notes: task.notes, taskId: task.id, revision: task.revision, contentProjectIds: [...(task.contentProjectIds || [])] });
  }
}
function activity(task, type, actor, summary, at) {
  const event = { id: randomUUID(), type, actor, summary, status: task.status, revision: task.revision, createdAt: at };
  task.activity = [...(task.activity || []), event].slice(-40);
  return event;
}

/** Idempotent, non-destructive migration. Canonical tasks retain legacy goal IDs. */
export function initializeTasks(state) {
  state.projects ||= [];
  state.tasks ||= [];
  state.taskEvents ||= [];
  state.taskEventCursors ||= {};
  if (!Array.isArray(state.tasks) || !Array.isArray(state.projects) || !Array.isArray(state.taskEvents) || !state.taskEventCursors || typeof state.taskEventCursors !== 'object' || Array.isArray(state.taskEventCursors)) throw new Error('Invalid persisted task state; original data must be preserved.');
  const ids = new Set();
  for (const task of state.tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || ids.has(task.id) || typeof task.title !== 'string' || typeof task.notes !== 'string' || !Number.isSafeInteger(task.revision) || task.revision < 1 || !Array.isArray(task.evidence) || !Array.isArray(task.activity)) throw new Error('Invalid persisted task record; original data must be preserved.');
    validateStatus(task.status); contentSources(task.contentProjectIds); ids.add(task.id);
  }
  for (const s of state.workSessions || []) for (const p of s.projects || []) {
    let canonical = state.projects.find(c => c.id === p.canonicalProjectId || c.id === p.id);
    if (!canonical) canonical = state.projects.find(c => c.name?.toLowerCase() === p.name?.toLowerCase() && c.host === (p.host || 'local') && c.cwd === p.cwd);
    if (!canonical) {
      canonical = { id: randomUUID(), name: p.name, host: p.host || 'local', cwd: p.cwd, notes: '', status: 'active', createdAt: s.startedAt || now() };
      state.projects.push(canonical);
    }
    p.canonicalProjectId = canonical.id;
    for (const g of p.goals || []) {
      let task = state.tasks.find(t => t.id === g.id);
      if (!task) {
        const at = s.startedAt || now();
        task = { id: g.id, projectId: canonical.id, title: string(g.title, 'Goal title', 800, true), status: validateStatus(g.status || 'todo'), notes: string(g.notes || '', 'Goal notes', 6000), evidence: [], agentId: null, scope: { workSessionId: s.id, projectId: p.id, goalId: g.id }, revision: 1, createdAt: at, updatedAt: at, activity: [], legacyGoalId: g.id, carriedFromTaskId: g.carriedFromGoalId || null, contentProjectIds: contentSources([canonical.id], g.contentProjectIds) };
        if (task.status === 'done') task.evidence = task.notes ? evidenceRows(task.notes.slice(0, 2000), 'legacy', at) : [];
        state.tasks.push(task);
      } else if (g.title !== task.title || g.status !== task.status || (g.notes || '') !== task.notes) {
        // Compatibility for old goal routes; shared API callers should updateTask directly.
        updateTask(state, task.id, { title: g.title, status: g.status, notes: g.notes || '' }, { actor: 'legacy', contentProjectIds: g.contentProjectIds });
      }
      task.contentProjectIds = contentSources(task.contentProjectIds, g.contentProjectIds);
      mirror(state, task);
    }
  }
  for (const task of state.tasks) {
    task.contentProjectIds = contentSources(task.contentProjectIds, task.projectId ? [task.projectId] : [], inheritedSources(state, task));
    mirror(state, task);
  }
  state.taskSchemaVersion = 1;
  return state.tasks;
}

export function createTask(state, input, options = {}) {
  const actor = actorName(options.actor), at = options.now || now();
  const title = string(input.title || input.name || '', 'Task title', 800, true);
  const notes = string(input.notes ?? '', 'Task notes', 6000);
  const scope = taskScope(state, input.scope || (input.workSessionId ? { workSessionId: input.workSessionId, projectId: input.scopeProjectId || input.projectId, goalId: input.goalId || null } : null));
  const project = projectId(state, input.projectId, scope);
  const status = validateStatus(input.status || 'todo');
  const evidence = evidenceRows(input.evidence, actor, at);
  if (status === 'done' && !evidence.length && !notes) throw new Error('Include evidence for completion.');
  if (input.agentId && !state.sessions?.some(a => a.id === input.agentId)) throw new Error('Assigned agent not found.');
  if (input.parentTaskId && !taskDescendsFrom(state, { id: '', projectId: project, scope, parentTaskId: input.parentTaskId }, input.parentTaskId)) throw new Error('Parent task is invalid or outside this project and working session.');
  const task = { id: randomUUID(), projectId: project, title, status, notes, evidence: evidence.length ? evidence : status === 'done' ? evidenceRows(notes.slice(0, 2000), actor, at) : [], agentId: input.agentId || null, scope, revision: 1, createdAt: at, updatedAt: at, activity: [], ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}) };
  task.contentProjectIds = contentSources(project ? [project] : [], input.contentProjectIds, options.contentProjectIds, inheritedSources(state, task));
  activity(task, 'created', actor, notes || title, at);
  state.tasks ||= [];
  state.tasks.push(task);
  if (scope?.projectId && !input.parentTaskId) {
    const nested = state.workSessions.find(s => s.id === scope.workSessionId).projects.find(p => p.id === scope.projectId);
    nested.goals.push({ id: task.id, taskId: task.id, title, notes, status, revision: task.revision, contentProjectIds: [...task.contentProjectIds] });
    task.scope = { ...scope, goalId: task.id };
  }
  return task;
}

export function updateTask(state, id, patch, options = {}) {
  const original = state.tasks?.find(t => t.id === id);
  if (!original) throw new Error('Task not found.');
  const expected = options.expectedRevision ?? patch.expectedRevision ?? patch.revision;
  if (expected !== undefined && expected !== original.revision) throw new Error('Task changed; refresh before updating it.');
  const actor = actorName(options.actor), at = options.now || now();
  const next = { ...original };
  if (own(patch, 'title')) next.title = string(patch.title, 'Task title', 800, true);
  if (own(patch, 'notes')) next.notes = string(patch.notes, 'Task notes', 6000);
  if (own(patch, 'status')) next.status = validateStatus(patch.status);
  if (own(patch, 'scope')) next.scope = taskScope(state, patch.scope);
  if (own(patch, 'projectId') || own(patch, 'scope')) next.projectId = projectId(state, own(patch, 'projectId') ? patch.projectId : next.projectId, next.scope);
  if (own(patch, 'agentId')) {
    if (patch.agentId && !state.sessions?.some(a => a.id === patch.agentId)) throw new Error('Assigned agent not found.');
    next.agentId = patch.agentId || null;
  }
  next.contentProjectIds = contentSources(original.contentProjectIds, original.projectId ? [original.projectId] : [], next.projectId ? [next.projectId] : [], patch.contentProjectIds, options.contentProjectIds, inheritedSources(state, next));
  const added = evidenceRows(patch.evidence, actor, at);
  if (next.status === 'done' && (original.status !== 'done' || patch.status === 'done')) {
    if (!added.length && !patch.notes?.trim()) throw new Error('Include evidence for completion.');
    if (!added.length) added.push(...evidenceRows(patch.notes.slice(0, 2000), actor, at));
  }
  next.evidence = [...(original.evidence || []), ...added].slice(-30);
  next.revision = original.revision + 1;
  next.updatedAt = at;
  activity(next, options.eventType || 'updated', actor, patch.notes || (patch.status ? `Status: ${next.status}` : 'Task updated'), at);
  Object.assign(original, next);
  mirror(state, original);
  return original;
}

/** Follow only same-scope ancestry; malformed graphs never widen a grant. */
export function taskDescendsFrom(state, task, ancestorId) {
  if (!ancestorId || !task) return false;
  const tasks = new Map((state.tasks || []).map(t => [t.id, t]));
  const seen = new Set();
  let current = task, found = false;
  for (let depth = 0; depth < 64; depth++) {
    if (!current || seen.has(current.id) || current.projectId !== task.projectId || (current.scope?.workSessionId || null) !== (task.scope?.workSessionId || null) || (current.scope?.projectId || null) !== (task.scope?.projectId || null)) return false;
    seen.add(current.id);
    if (current.id === ancestorId) found = true;
    // Continue after finding the grant to reject cycles/broken ancestry above it too.
    if (!current.parentTaskId) return found;
    current = tasks.get(current.parentTaskId);
  }
  return false;
}

function agentScope(state, agent, task) {
  if (!agent || agent.enrollmentRevokedAt || agent.status === 'stopped' || !agent.id) throw new Error('Agent enrollment is not active.');
  if (task.agentId && task.agentId !== agent.id) throw new Error('Task is assigned to another agent.');
  const project = projectOf(state, agent);
  const ownUnprojectedTask = !project && !task.projectId && agent.taskId && taskDescendsFrom(state,task,agent.taskId);
  if (agent.contextIsolation || (!ownUnprojectedTask && (!project || task.projectId !== project))) throw new Error('Task is outside your assigned project.');
  if (!canReadProjectContent(state, agent, task)) throw new Error('Task contains shared project content outside your current grant.');
  const scope = agent.scope;
  if (scope?.workSessionId) {
    if (task.scope?.workSessionId !== scope.workSessionId) throw new Error('Task is outside your assigned working session.');
    if (scope.projectId && task.scope?.projectId !== scope.projectId) throw new Error('Task is outside your assigned project.');
    if (scope.goalId && !taskDescendsFrom(state, task, scope.goalId)) throw new Error('Task is outside your assigned goal or has invalid ancestry.');
  } else if ((!agent.projectId || task.projectId !== agent.projectId) && !(agent.taskId && taskDescendsFrom(state, task, agent.taskId))) throw new Error('Ask the user to assign you to this project first.');
  if (agent.taskId && !taskDescendsFrom(state, task, agent.taskId)) throw new Error('Task is outside your assigned task or has invalid ancestry.');
}

/** Data updates only: accepting an event never launches agents or grants permissions. */
export function recordTaskEvent(state, agent, input) {
  if (!agent?.id) throw new Error('Agent credential required.');
  if (agent.enrollmentRevokedAt || agent.status === 'stopped') throw new Error('Agent enrollment is not active.');
  state.tasks ||= []; state.taskEvents ||= []; state.taskEventCursors ||= {};
  const actor = `agent:${agent.id}`;
  const reportSources = contentSources([...allowedProjectIds(state, agent)], agent.contentProjectIds);
  if (!canReadProjectContent(state, agent, { contentProjectIds: reportSources })) throw new Error('Agent retains project content outside its current grant; start a fresh agent.');
  const creating = input.operation === 'create' || input.command === 'create';
  const eventId = string(input.eventId || input.clientKey || randomUUID(), 'Event ID', 160, true);
  if (input.assignmentRevision !== undefined && Number(input.assignmentRevision) !== (agent.assignmentRevision || 0)) throw new Error('Assignment changed; refresh context before reporting.');
  if (input.attemptId && input.attemptId !== (agent.attemptId || agent.id)) throw new Error('Execution attempt changed; refresh context before reporting.');
  const sequence = input.sequence == null ? null : Number(input.sequence);
  if (sequence !== null && (!Number.isSafeInteger(sequence) || sequence < 1)) throw new Error('Event sequence must be a positive integer.');
  const taskId = input.taskId || input.task || input.goal || agent.taskId || agent.scope?.goalId;
  const payload = { operation: creating ? 'create' : 'report', taskId: creating ? null : taskId, title: input.title, status: input.status, notes: input.notes, evidence: input.evidence, projectId: input.projectId, parentTaskId: input.parentTaskId };
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const key = `${agent.id}:${agent.assignmentRevision || 0}:${input.clientKey || eventId}`;
  const existing = state.taskEvents.find(e => e.key === key) || (creating ? state.tasks.find(t => t.creationKey === key)?.creationReceipt : null);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error('Event ID was already used for different content.');
    const task = state.tasks.find(t => t.id === existing.taskId);
    if (!task) throw new Error('Previously created task is unavailable.');
    agentScope(state, agent, task);
    return { task, event: existing, duplicate: true };
  }
  const cursorKey = `${agent.id}:${agent.assignmentRevision || 0}:${creating ? 'create' : taskId}`;
  if (sequence !== null && sequence <= (state.taskEventCursors[cursorKey] || 0)) throw new Error('Stale event sequence; refresh task state.');
  let task;
  if (creating) {
    if (!input.clientKey && !input.eventId) throw new Error('Task creation requires a stable clientKey or eventId for retries.');
    let scope = agent.scope ? { ...agent.scope } : null;
    const parentId = agent.taskId || scope?.goalId || null;
    const project = input.projectId || agent.projectId || projectForScope(state, scope);
    if (scope?.workSessionId && !scope.projectId && project) {
      const membership = state.workSessions?.find(s => s.id === scope.workSessionId)?.projects.find(p => p.canonicalProjectId === project || p.id === project);
      if (!membership) throw new Error('Project is outside your assigned working session.');
      scope = { ...scope, projectId: membership.id };
    }
    const candidate = { id: '', projectId: project, scope, parentTaskId: parentId, agentId: agent.id };
    candidate.contentProjectIds = contentSources(reportSources, inheritedSources(state, candidate));
    agentScope(state, agent, candidate);
    task = createTask(state, { title: input.title, notes: input.notes || '', status: input.status || 'todo', evidence: input.evidence, projectId: project, scope, agentId: agent.id, parentTaskId: parentId }, { actor, contentProjectIds: reportSources });
  } else {
    task = state.tasks.find(t => t.id === taskId);
    if (!task) throw new Error('Task not found.');
    agentScope(state, agent, task);
    const patch = {};
    for (const field of ['status', 'notes', 'evidence']) if (input[field] != null) patch[field] = input[field];
    if (!Object.keys(patch).length) throw new Error('Report a status, note, or evidence.');
    task = updateTask(state, task.id, patch, { actor, expectedRevision: input.expectedRevision, eventType: 'agent-report', contentProjectIds: reportSources });
  }
  const event = { id: eventId, key, fingerprint, taskId: task.id, agentId: agent.id, revision: task.revision, status: task.status, summary: (input.notes || input.title || '').slice(0, 600), createdAt: now(), sequence, contentProjectIds: [...task.contentProjectIds] };
  state.taskEvents = [...state.taskEvents, event].slice(-500);
  if (creating) { task.creationKey = key; task.creationReceipt = event; }
  if (sequence !== null) state.taskEventCursors[cursorKey] = sequence;
  return { task, event, duplicate: false };
}

export function taskSummary(state, filter = {}) {
  const limit = Number.isSafeInteger(filter.limit) ? Math.max(1, Math.min(100, filter.limit)) : 100;
  const tasks = (state.tasks || []).filter(t => (!filter.projectId || t.projectId === filter.projectId) && (!filter.workSessionId || t.scope?.workSessionId === filter.workSessionId));
  const counts = Object.fromEntries(TASK_STATUSES.map(s => [s, tasks.filter(t => t.status === s).length]));
  return { total: tasks.length, ...counts, tasks: tasks.slice(0, limit).map(({ id, projectId, title, status, agentId, scope, revision, updatedAt, notes }) => ({ id, projectId, title, status, agentId, scope, revision, updatedAt, notes: notes.slice(0, 600) })), omitted: Math.max(0, tasks.length - limit) };
}
