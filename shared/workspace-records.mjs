// One environment is one workspace. Records without a host belong to Local.
export function environmentOf(row, fallback = 'local') {
  return row && typeof row.host === 'string' && row.host ? row.host : fallback;
}

export function workspaceRecords(state, environment = 'local') {
  const host = environment || 'local';
  const projects = (state.projects || []).filter(project => environmentOf(project) === host);
  const projectIds = new Set(projects.map(project => project.id));
  const tasks = (state.tasks || []).filter(task => projectIds.has(task.projectId) || environmentOf(task, '') === host);
  const teams = (state.teams || []).filter(team => environmentOf(team) === host || projectIds.has(team.projectId));
  const teamIds = new Set(teams.map(team => team.id));
  const sessions = (state.sessions || []).filter(session => environmentOf(session) === host);
  const sessionIds = new Set(sessions.map(session => session.id));
  const messages = (state.messages || []).filter(message => environmentOf(message, '') === host || teamIds.has(message.teamId) || sessionIds.has(message.from) || sessionIds.has(message.to));
  const workSessions = (state.workSessions || []).filter(session => environmentOf(session) === host);
  const history = (state.history || []).filter(row => environmentOf(row) === host);
  const activity = (state.activity || []).filter(row => environmentOf(row) === host);
  return { ...state, projects, tasks, teams, sessions, messages, workSessions, history, activity };
}
