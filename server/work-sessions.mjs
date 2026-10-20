import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { text, home } from './core.mjs';

export function parseTopics(value, histories = []) {
  if (typeof value !== 'string' || value.length > 20000) throw new Error('Topics must be text, up to 20,000 characters.');
  const projects = [];
  for (const line of value.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 100)) {
    const separator = line.indexOf(': ');
    const name = text(separator > 0 ? line.slice(0, separator) : 'General', 120);
    const title = text(separator > 0 ? line.slice(separator + 2) : line, 800);
    let project = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!project) {
      const known = histories.find(h => h.group.toLowerCase() === name.toLowerCase());
      project = { id: randomUUID(), name, cwd: known?.repository || known?.cwd || path.join(home, 'Projects'), host: 'local', goals: [] };
      projects.push(project);
    }
    if (title) project.goals.push({ id: randomUUID(), title, status: 'todo', notes: '' });
  }
  return projects;
}
export function workProgress(session) {
  const goals = session.projects.flatMap(p => p.goals);
  return { total: goals.length, done: goals.filter(g => g.status === 'done').length, doing: goals.filter(g => g.status === 'doing').length, open: goals.filter(g => g.status !== 'done').length };
}
export function resolveScope(workSessions, input) {
  if (!input) return null;
  const session = workSessions.find(s => s.id === input.workSessionId);
  if (!session) throw new Error('Working session not found.');
  const project = input.projectId ? session.projects.find(p => p.id === input.projectId) : null;
  if (input.projectId && !project) throw new Error('Project not found in this working session.');
  const goal = input.goalId ? project?.goals.find(g => g.id === input.goalId) : null;
  if (input.goalId && !goal) throw new Error('Goal not found in this project.');
  return { workSessionId: session.id, projectId: project?.id || null, goalId: goal?.id || null };
}
export function scopeContext(workSessions, scope) {
  if (!scope) return null;
  const session = workSessions.find(s => s.id === scope.workSessionId);
  if (!session) return null;
  const projects = scope.projectId ? session.projects.filter(p => p.id === scope.projectId) : session.projects;
  return {
    workingSession: session.title, layer: scope.goalId ? 'goal/task' : scope.projectId ? 'project' : 'working session',
    projects: projects.map(p => ({ id: p.id, name: p.name, cwd: p.cwd, goals: p.goals.filter(g => !scope.goalId || g.id === scope.goalId).map(g => ({ id: g.id, title: g.title, status: g.status, notes: g.notes })) }))
  };
}
export function canCommunicate(a, b) {
  return a.group === b.group || !!(a.scope?.workSessionId && a.scope.workSessionId === b.scope?.workSessionId);
}
export function carryProjects(previous) {
  return previous.projects.map(p => ({ ...p, id: randomUUID(), goals: p.goals.filter(g => g.status !== 'done').map(g => ({ ...g, id: randomUUID(), status: 'todo' })) })).filter(p => p.goals.length);
}
export function mergeProjects(carried, added) {
  for (const project of added) {
    const existing = carried.find(p => p.name.toLowerCase() === project.name.toLowerCase());
    if (existing) existing.goals.push(...project.goals);
    else carried.push(project);
  }
  return carried;
}
export function wrapSummary(session) {
  const progress = workProgress(session);
  return `${session.title}\n${progress.done}/${progress.total} goals completed. ${progress.open} left open.\n\n${session.projects.map(p => `${p.name}\n${p.goals.map(g => `${g.status === 'done' ? '[x]' : g.status === 'doing' ? '[~]' : '[ ]'} ${g.title}${g.notes ? ` — ${g.notes}` : ''}`).join('\n')}`).join('\n\n')}${session.notes ? `\n\nHandoff for next time\n${session.notes}` : ''}`;
}
