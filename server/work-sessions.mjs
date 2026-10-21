import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { text, home, validHost, localDirectory } from './core.mjs';

export function parseTopics(value, histories = []) {
  if (typeof value !== 'string' || value.length > 20000) throw new Error('Topics must be text, up to 20,000 characters.');
  const projects = [];
  for (const line of value.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 100)) {
    const separator = line.indexOf(': ');
    const name = text(separator > 0 ? line.slice(0, separator) : 'General', 120);
    const title = text(separator > 0 ? line.slice(separator + 2) : line, 800);
    let project = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!project) {
      const matches = histories.filter(h => h.group?.toLowerCase() === name.toLowerCase());
      const locations = new Set(matches.map(h => `${h.host || 'local'}\0${h.repository || h.cwd}`));
      const known = locations.size === 1 ? matches[0] : null;
      project = { id: randomUUID(), name, cwd: known?.repository || known?.cwd || path.join(home, 'Projects'), host: known?.host || 'local', ...(known?.owner ? { owner: known.owner } : {}), goals: [] };
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
  const project = input.projectId ? session.projects.find(p => p.id === input.projectId || p.canonicalProjectId === input.projectId) : null;
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
    projects: projects.map(p => ({ id: p.id, projectId: p.canonicalProjectId || null, name: p.name, host: p.host || 'local', cwd: p.cwd, goals: p.goals.filter(g => !scope.goalId || g.id === scope.goalId).map(g => ({ id: g.id, title: g.title, status: g.status, notes: g.notes })) }))
  };
}
export function canCommunicate(a, b) {
  const sameTeam = a.teamId && b.teamId ? a.teamId === b.teamId : !a.teamId && !b.teamId && !!a.group && a.group === b.group && !!a.cwd && a.cwd === b.cwd && a.host === b.host;
  return !!sameTeam || !!(a.scope?.workSessionId && a.scope.workSessionId === b.scope?.workSessionId);
}
export function carryProjects(previous) {
  return previous.projects.map(p => ({ ...p, id: randomUUID(), goals: p.goals.filter(g => g.status !== 'done').map(g => ({ ...g, id: randomUUID(), taskId: undefined, revision: undefined, carriedFromGoalId: g.id, status: ['blocked', 'stopped'].includes(g.status) ? g.status : 'todo' })) })).filter(p => p.goals.length);
}
export function mergeProjects(carried, added) {
  for (const project of added) {
    const existing = carried.find(p => p.name.toLowerCase() === project.name.toLowerCase() && p.host === project.host && p.cwd === project.cwd);
    if (existing) existing.goals.push(...project.goals);
    else carried.push(project);
  }
  return carried;
}

/** Resolve location before launch, using canonical projects and legacy scopes consistently. */
export function resolveLaunchLocation(state, input = {}, allowedHosts = []) {
  const task = input.taskId ? state.tasks?.find(t => t.id === input.taskId) : null;
  if (input.taskId && !task) throw new Error('Task not found.');
  const team = input.teamId ? state.teams?.find(t => t.id === input.teamId) : null;
  if (input.teamId && !team) throw new Error('Team not found.');
  const suppliedScope = input.scope || (input.workSessionId ? { workSessionId: input.workSessionId, projectId: input.projectId || null, goalId: input.goalId || null } : null);
  const scope = resolveScope(state.workSessions || [], suppliedScope || task?.scope || team?.scope);
  if (task?.scope && scope && (scope.workSessionId !== task.scope.workSessionId || (scope.projectId && scope.projectId !== task.scope.projectId) || (scope.goalId && scope.goalId !== task.id && scope.goalId !== task.scope.goalId))) throw new Error('Task conflicts with the selected scope.');
  const scopedProject = state.workSessions?.find(s => s.id === scope?.workSessionId)?.projects.find(p => p.id === scope?.projectId);
  const requestedProject = input.projectId ? state.projects?.find(p => p.id === input.projectId) : null;
  if (input.projectId && !requestedProject && input.projectId !== scopedProject?.id) throw new Error('Project not found.');
  const selectedId = requestedProject?.id || task?.projectId || scopedProject?.canonicalProjectId || team?.projectId || null;
  const project = state.projects?.find(p => p.id === selectedId);
  if (task?.projectId && selectedId !== task.projectId) throw new Error('Task conflicts with the selected project.');
  if (scopedProject?.canonicalProjectId && selectedId && selectedId !== scopedProject.canonicalProjectId) throw new Error('Project conflicts with the working-session scope.');
  if (team?.projectId && selectedId && selectedId !== team.projectId) throw new Error('Team conflicts with the selected project.');
  const configured = scopedProject || project || team;
  const host = input.host || configured?.host || 'local';
  if (host !== 'local' && !allowedHosts.includes(validHost(host))) throw new Error('Environment is not enabled.');
  if (configured?.host && input.host && input.host !== configured.host) throw new Error('Environment conflicts with the selected project or scope.');
  const cwd = input.cwd || configured?.cwd || (host === 'local' ? path.join(home, 'Projects') : '~');
  if (input.cwd && configured?.cwd) {
    const base = host === 'local' ? fs.realpathSync(localDirectory(configured.cwd)) : path.posix.normalize(configured.cwd);
    const candidate = host === 'local' ? fs.realpathSync(localDirectory(cwd)) : path.posix.normalize(cwd);
    const relative = (host === 'local' ? path : path.posix).relative(base, candidate);
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Working directory is outside the selected project or scope.');
  }
  return { host, cwd: host === 'local' ? localDirectory(cwd) : text(cwd, 2000), projectId: selectedId, scope, taskId: task?.id || null, teamId: team?.id || null };
}
export function wrapSummary(session) {
  const progress = workProgress(session);
  return `${session.title}\n${progress.done}/${progress.total} goals completed. ${progress.open} left open.\n\n${session.projects.map(p => `${p.name}\n${p.goals.map(g => `${g.status === 'done' ? '[x]' : g.status === 'doing' ? '[~]' : '[ ]'} ${g.title}${g.notes ? ` — ${g.notes}` : ''}`).join('\n')}`).join('\n\n')}${session.notes ? `\n\nHandoff for next time\n${session.notes}` : ''}`;
}
