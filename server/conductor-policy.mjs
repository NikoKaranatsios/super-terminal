// Continuous rounds inherit the scope of active, user-created work. A model
// action or an agent's message cannot expand that grant to unrelated processes.
export function validateAutonomousAction(state, action, scope) {
  const projects = new Set(scope?.projectIds || []), sessions = new Set(scope?.workSessionIds || []);
  const tasks = new Set(scope?.taskIds || []), agents = new Set(scope?.agentIds || []);
  const taskMutation = ['update_task','update_goal','goal_progress'].includes(action.type);
  const teamMutation = ['update_team','brief_team','add_team_members'].includes(action.type);
  if (taskMutation && action.target && action.taskId && action.target !== action.taskId) throw new Error('Conflicting task targets.');
  if (teamMutation && action.target && action.teamId && action.target !== action.teamId) throw new Error('Conflicting team targets.');
  const task = state.tasks?.find(t => t.id === (taskMutation ? action.target || action.taskId : action.taskId || action.goalId));
  const team = state.teams?.find(t => t.id === (teamMutation ? action.target || action.teamId : action.teamId));
  const inTask = value => !!value && tasks.has(value.id);
  const inTeam = value => !!value && (!value.scope?.workSessionId || sessions.has(value.scope.workSessionId)) && (projects.has(value.projectId) || sessions.has(value.scope?.workSessionId));
  const inProject = id => projects.has(id) || state.workSessions?.some(s => sessions.has(s.id) && s.projects.some(p => p.id === id && projects.has(p.canonicalProjectId)));
  if (action.projectId && !inProject(action.projectId)) throw new Error('Continuous action is outside the active project scope.');
  if (action.workSessionId && !sessions.has(action.workSessionId)) throw new Error('Continuous action is outside the active working session.');
  if (action.taskId && !inTask(state.tasks?.find(t => t.id === action.taskId))) throw new Error('Continuous action is outside the active tasks.');
  if (action.goalId && !tasks.has(action.goalId)) throw new Error('Continuous action is outside the active goals.');
  if (action.teamId && !inTeam(team)) throw new Error('Continuous action is outside the active teams.');
  const anchored = inProject(action.projectId) || sessions.has(action.workSessionId) || inTask(task) || inTeam(team);
  let allowed = false;
  if (['start_agent','start_team','create_team','create_task','create_goal'].includes(action.type)) allowed = anchored;
  if (['update_task','update_goal','goal_progress'].includes(action.type)) allowed = inTask(task);
  if (['message_agent','prompt_agent','session_state','assign_agent','rename_agent','update_agent'].includes(action.type)) {
    allowed = agents.has(action.target) && state.sessions?.some(s => s.id === action.target && s.kind === 'managed');
  }
  if (['update_team','add_team_members','brief_team'].includes(action.type)) allowed = inTeam(team);
  if (action.type === 'work_session_state') allowed = sessions.has(action.target);
  if (action.type === 'update_project') allowed = inProject(action.target);
  if (action.type === 'notify') allowed = !action.target || action.target === 'conductor' || agents.has(action.target) || tasks.has(action.target) || (action.target.startsWith('task:') && tasks.has(action.target.slice(5)));
  if (action.type === 'read_conversation') allowed = state.sessions?.some(s => agents.has(s.id) && s.historyId === action.target);
  if (!allowed) throw new Error('This action needs a direct user request or an assignment inside the active work scope.');
  if (['start_agent','start_team','add_team_members'].includes(action.type)) {
    const nested = state.workSessions?.filter(s => sessions.has(s.id)).flatMap(s => s.projects).find(p => p.id === action.projectId);
    const projectId = nested?.canonicalProjectId || action.projectId || task?.projectId || team?.projectId;
    const active = (state.sessions || []).filter(s => (projectId ? s.projectId === projectId : s.scope?.workSessionId === action.workSessionId) && !s.enrollmentRevokedAt && !['stopped','exited'].includes(s.status));
    const requested = action.type === 'start_agent' ? (task && active.some(s => s.taskId === task.id) ? 0 : 1) : (action.members || []).filter(m => action.type !== 'add_team_members' || !active.some(s => s.teamId === team?.id && s.role?.toLowerCase() === m.role?.toLowerCase())).length;
    if (active.length + requested > 6) throw new Error('This project already has enough enrolled agents. Reuse its agents or stop unused ones before launching more.');
  }
  return true;
}
