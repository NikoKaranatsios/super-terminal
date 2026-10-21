import { createHash } from 'node:crypto';

const clip = (value, max = 600) => String(value ?? '').slice(0, max);
const ids = values => [...new Set((Array.isArray(values) ? values : []).filter(v => typeof v === 'string' && v).map(v => v.slice(0, 200)))].sort().slice(0, 16);
export function normalizeFocus(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const focus = { agentIds:ids(input.agentIds), historyIds:ids(input.historyIds) };
  for (const field of ['taskId','projectId','workSessionId']) if (typeof input[field] === 'string' && input[field]) focus[field] = input[field].slice(0, 200);
  if (typeof input.summary === 'string' && input.summary.trim()) focus.summary = input.summary.trim().slice(0, 1000);
  focus.revision = createHash('sha256').update(JSON.stringify(focus)).digest('hex').slice(0, 24);
  return focus;
}
export const hasFocus = focus => !!(focus?.agentIds?.length || focus?.historyIds?.length || focus?.taskId || focus?.projectId || focus?.workSessionId || focus?.summary);

/** Read-only projections. A provider's successful response is not task verification. */
export function collectProgress(state, live, scope, focus, activity = state.activity || []) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : Object.values(state.tasks || {});
  const taskIds = new Set(scope.taskIds || []), agentIds = new Set(scope.agentIds || []);
  const strictProjects = ['project','task'].includes(scope.layer) ? new Set(scope.projectIds || []) : null;
  const focusAgents = new Set(focus.agentIds), focusHistory = new Set(focus.historyIds);
  const agents = new Map();
  for (const agent of [...(state.sessions || []), ...live]) if (agent?.id) agents.set(agent.id, agent);
  for (const task of tasks) if (taskIds.has(task.id) && task.agentId) agentIds.add(task.agentId);
  const focusedTask = task => (!strictProjects || strictProjects.has(task.projectId)) && ((focus.taskId && (task.id === focus.taskId || task.parentTaskId === focus.taskId)) ||
    (focus.projectId && task.projectId === focus.projectId) || (focus.workSessionId && task.scope?.workSessionId === focus.workSessionId));
  for (const task of tasks) if (focusedTask(task) && task.agentId) focusAgents.add(task.agentId);
  const watched = [...agents.values()].filter(a => agentIds.has(a.id) || focusAgents.has(a.id) || focusHistory.has(a.historyId));
  const observationTask = agent => tasks.find(t => taskIds.has(t.id) && (t.id === agent?.taskId || t.agentId === agent?.id));
  const access = (agent, task) => agentIds.has(agent?.id) || taskIds.has(task?.id) ? 'managed_scope' : 'read_only';
  const observations = [];
  // State already caps activity, but retain a local bound for older/malformed stores.
  for (const event of (Array.isArray(activity) ? activity : []).slice(-200)) {
    if (!event?.id || !['finished','exited'].includes(event.kind)) continue;
    const matches = watched.filter(a => a.id === event.target || a.historyId === event.target);
    if (!matches.length && !focusHistory.has(event.target)) continue;
    // An ambiguous history match carries no invented task attribution.
    const agent = matches.length === 1 ? matches[0] : null;
    const task = agent ? observationTask(agent) : null;
    observations.push({ id:`activity:${clip(event.id,200)}`, kind:event.kind === 'finished' ? 'provider_turn_complete' : 'process_exit',
      at:clip(event.at,80), agentId:agent?.id || null, historyId:agent?.historyId || (focusHistory.has(event.target) ? event.target : null),
      taskId:task?.id || null, projectId:task?.projectId || null, host:clip(event.host,200), provider:clip(event.provider,40),
      access:access(agent,task), verification:'unverified', taskDone:false,
      summary:event.kind === 'finished' ? 'The provider emitted an end-of-turn marker. Task completion needs supporting evidence.' : 'The process exited. This does not establish task success.' });
  }
  for (const event of (state.taskEvents || []).slice(-200)) {
    const task = tasks.find(t => t.id === event.taskId);
    if (!task || (strictProjects && !strictProjects.has(task.projectId)) || (!taskIds.has(task.id) && !focusedTask(task) && !focusAgents.has(event.agentId))) continue;
    observations.push({ id:`report:${clip(event.id,200)}`, kind:'task_report', at:clip(event.createdAt,80), taskId:task.id,
      projectId:task.projectId, agentId:event.agentId || null, status:event.status, revision:event.revision,
      access:taskIds.has(task.id) ? 'managed_scope' : 'read_only', verification:'actor_reported', summary:clip(event.summary) });
  }
  const context = watched.filter(a => focusAgents.has(a.id) || focusHistory.has(a.historyId)).slice(0,8);
  const subjects = context.map(a => ({ agentId:a.id,historyId:a.historyId || null,status:a.status,host:a.host,provider:a.provider }));
  for (const historyId of focus.historyIds) if (!subjects.some(s => s.historyId === historyId) && subjects.length < 8) subjects.push({ historyId });
  if (hasFocus(focus) && !subjects.length) subjects.push({});
  for (const subject of subjects) observations.push({ id:`focus:${focus.revision}:${subject.agentId || subject.historyId || 'work'}`,
    kind:'current_context', at:focus.updatedAt || '', ...subject, access:'read_only', verification:'unverified',
    summary:clip(focus.summary || 'Current user-selected work. Read this context without expanding execution authority.') });
  const seen = new Set();
  const sorted = observations.sort((a,b) => (Date.parse(b.at)||0)-(Date.parse(a.at)||0) || a.id.localeCompare(b.id)).filter(o => !seen.has(o.id) && seen.add(o.id));
  return { observations:sorted.slice(0,48), omitted:Math.max(0,sorted.length-48), observedAgents:context.map(a => ({id:a.id,historyId:a.historyId,provider:a.provider,host:a.host,cwd:a.cwd,status:a.status,title:clip(a.title,160),connectionLost:!!a.connectionLost,access:'read_only'})) };
}
