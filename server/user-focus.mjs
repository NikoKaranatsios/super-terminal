import { createHash } from 'node:crypto';

/** Owner-only navigation context; never a grant or an agent-facing record. */
export function resolveFocus(state, input = {}, live = []) {
  const agent = input.agentId ? live.find(s => s.id === input.agentId) : null;
  const task = input.taskId ? state.tasks.find(t => t.id === input.taskId) : null;
  const projectId = input.projectId || task?.projectId || agent?.projectId || null;
  if (input.agentId && !agent) throw new Error('Focused agent is no longer available.');
  if (input.taskId && !task) throw new Error('Focused task not found.');
  if (projectId && !state.projects.some(p => p.id === projectId)) throw new Error('Focused project not found.');
  if (task && task.projectId !== projectId) throw new Error('Focused task is outside this project.');
  if (agent?.projectId && projectId !== agent.projectId) throw new Error('Focused agent is outside this project.');
  const workSessionId = input.workSessionId || task?.scope?.workSessionId || agent?.scope?.workSessionId || null;
  const working = workSessionId ? state.workSessions.find(s => s.id === workSessionId) : null;
  if (workSessionId && !working) throw new Error('Focused working session not found.');
  if (working && projectId && !working.projects.some(p => (p.canonicalProjectId || p.id) === projectId)) throw new Error('Focused project is outside this working session.');
  const value = { viewId:String(input.viewId || '').slice(0,200), agentIds:agent ? [agent.id] : [], historyIds:agent?.historyId ? [agent.historyId] : [], projectId, taskId:task?.id || null, workSessionId, environment:agent?.host || state.projects.find(p=>p.id===projectId)?.host || 'local', windowId:String(input.windowId || '').slice(0,100) };
  value.revision = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
  return value;
}
