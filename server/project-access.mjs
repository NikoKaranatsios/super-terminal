/** Access grants are identities, never display names, folders, or working sessions. */
export function projectOf(state, agent) {
  const id = agent?.projectId || state.workSessions?.find(s => s.id === agent?.scope?.workSessionId)?.projects?.find(p => p.id === agent?.scope?.projectId)?.canonicalProjectId;
  return state.projects?.some(p => p.id === id) ? id : null;
}
export function teamOf(state, agent) {
  return agent?.teamId ? state.teams?.find(t => t.id === agent.teamId) || null : null;
}
export function peersAllowed(state, a, b) {
  return !!(a && b && !a.enrollmentRevokedAt && !b.enrollmentRevokedAt && !a.contextIsolation && !b.contextIsolation && teamOf(state, a) && a.teamId === b.teamId);
}
export function contextKey(state, agent) {
  const team = teamOf(state, agent);
  return team ? `team:${team.id}` : projectOf(state, agent) ? `project:${projectOf(state, agent)}` : `agent:${agent.id}`;
}
export function allowedProjectIds(state, agent) {
  const ids = new Set([projectOf(state, agent)].filter(Boolean));
  const team = teamOf(state, agent);
  if (team) {
    if (team.projectId) ids.add(team.projectId);
    for (const id of team.sharedProjectIds || []) if (typeof id === 'string' && id) ids.add(id);
    for (const member of state.sessions || []) if (peersAllowed(state, agent, member)) {
      const id = projectOf(state, member); if (id) ids.add(id);
    }
  }
  return ids;
}
/** Retained content provenance is restrictive metadata, never an access grant. */
export function canReadProjectContent(state, agent, record) {
  if (!agent || !record || agent.contextIsolation || agent.enrollmentRevokedAt) return false;
  const sources = record.contentProjectIds ?? [];
  if (!Array.isArray(sources) || sources.some(id => typeof id !== 'string' || !id)) return false;
  const allowed = allowedProjectIds(state, agent);
  return [...sources, ...(record.projectId ? [record.projectId] : [])].every(id => allowed.has(id));
}
export function agentScopeContext(state, agent) {
  const projectId = projectOf(state, agent);
  const session = state.workSessions?.find(s => s.id === agent.scope?.workSessionId);
  if (!session || !projectId) return null;
  const projects = session.projects.filter(p => p.canonicalProjectId === projectId || p.id === projectId);
  // The working session's title/notes may describe unrelated projects.
  return { workSessionId: session.id, layer: agent.scope?.goalId ? 'goal/task' : 'project', projects: projects.map(p => ({ id:p.id, projectId, name:p.name, host:p.host, cwd:p.cwd, goals:(p.goals || []).filter(g => (!agent.scope?.goalId || g.id === agent.scope.goalId) && canReadProjectContent(state, agent, state.tasks?.find(t => t.id === (g.taskId || g.id)) || { ...g, projectId })).map(g => ({id:g.id,title:g.title,status:g.status,notes:g.notes})) })) };
}
export function messageVisible(state, message, agent) {
  if (message.to !== agent.id || agent.contextIsolation) return false;
  if (message.assignmentRevision !== (agent.assignmentRevision || 0)) return false;
  if (message.projectId !== projectOf(state, agent) || (message.teamId || null) !== (teamOf(state, agent)?.id || null)) return false;
  if (!canReadProjectContent(state, agent, { projectId: message.projectId, contentProjectIds: message.sourceProjectIds || message.contentProjectIds })) return false;
  if (['you','conductor','coordinator'].includes(message.from)) return true;
  return peersAllowed(state, agent, state.sessions.find(s => s.id === message.from));
}
export function contextTarget(state, input) {
  if (input.agentId) {
    const agent = state.sessions.find(s => s.id === input.agentId);
    if (!agent) throw new Error('Agent not found.');
    return contextKey(state, agent);
  }
  if (input.teamId) {
    if (!state.teams.some(t => t.id === input.teamId)) throw new Error('Team not found.');
    return `team:${input.teamId}`;
  }
  if (input.projectId) {
    if (!state.projects.some(p => p.id === input.projectId)) throw new Error('Project not found.');
    return `project:${input.projectId}`;
  }
  // Compatibility for the owner UI only. Ambiguous labels never grant agent access.
  const teams = state.teams.filter(t => t.name === input.group);
  if (teams.length === 1) return `team:${teams[0].id}`;
  const projects = state.projects.filter(p => p.name === input.group);
  if (projects.length === 1) return `project:${projects[0].id}`;
  return `owner:${String(input.group || '').slice(0,120)}`;
}
