import { allowedProjectIds, projectOf } from './project-access.mjs';

const CONTENT = new Set(['start_agent','resume_conversation','start_team','update_team','brief_team','add_team_members','message_agent','prompt_agent','rename_agent','create_task','create_goal','update_task','update_goal','goal_progress','create_project','update_project','start_work_session','work_session_state']);

/** Reject mixed-context prose before it can enter agent-visible records or mailboxes. */
export function validateConductorContent(state, action, metadata = {}) {
  if (!CONTENT.has(action.type)) return;
  // State-only session controls carry no generated content into project records.
  if (action.type === 'work_session_state' && !action.text) return;
  const provenance = metadata.context;
  if (!provenance || provenance.key === 'global' || provenance.unknownSources || !(provenance.isolated || provenance.projectScoped) || !provenance.projectIds?.length) throw new Error('Project privacy: open the target project or task in Conductor before generating project content. Global overview context cannot be forwarded to agents.');
  const agentAction = ['message_agent','prompt_agent','rename_agent'].includes(action.type);
  const taskAction = ['update_task','update_goal','goal_progress'].includes(action.type);
  const teamAction = ['update_team','brief_team','add_team_members'].includes(action.type);
  if (taskAction && action.target && action.taskId && action.target !== action.taskId) throw new Error('Project privacy: conflicting task targets.');
  if (teamAction && action.target && action.teamId && action.target !== action.teamId) throw new Error('Project privacy: conflicting team targets.');
  const agent = agentAction ? state.sessions.find(s => s.id === action.target) : null;
  const task = state.tasks.find(t => t.id === (taskAction ? action.target || action.taskId : action.taskId || action.goalId));
  const team = state.teams.find(t => t.id === (teamAction ? action.target || action.teamId : action.teamId));
  const scopedProject = state.workSessions?.find(s => s.id === (action.scope?.workSessionId || action.workSessionId))?.projects.find(p => p.id === (action.scope?.projectId || action.projectId) || p.canonicalProjectId === (action.scope?.projectId || action.projectId));
  const suppliedProject = state.projects.find(p => p.id === action.projectId)?.id || scopedProject?.canonicalProjectId || action.projectId;
  const fixedProject = agentAction ? projectOf(state,agent) : taskAction ? task?.projectId : teamAction ? team?.projectId : action.type === 'update_project' ? state.projects.find(p=>p.id===action.target)?.id : action.type === 'resume_conversation' ? metadata.historyProjectId : null;
  if (fixedProject && suppliedProject && suppliedProject !== fixedProject) throw new Error('Project privacy: target conflicts with the supplied project.');
  const projectId = fixedProject || task?.projectId || scopedProject?.canonicalProjectId || suppliedProject || team?.projectId || null;
  let allowed = new Set(projectId ? [projectId] : []);
  if (agent) allowed = allowedProjectIds(state,agent);
  else if (team) {
    for (const member of state.sessions.filter(s => s.teamId === team.id && !s.contextIsolation && !s.enrollmentRevokedAt)) for (const id of allowedProjectIds(state,member)) allowed.add(id);
  }
  // A new project or session must also originate a clean single-project context;
  // global chat remains an owner-facing overview, never a content source.
  if (['create_project','start_work_session'].includes(action.type)) throw new Error('Project privacy: create project records from detected folders, then configure their tasks in that project’s Conductor view.');
  if (action.type === 'work_session_state') {
    const working = state.workSessions.find(s => s.id === action.target);
    allowed = new Set((working?.projects || []).map(p => p.canonicalProjectId || p.id));
  }
  if (!allowed.size || provenance.projectIds.some(id => !allowed.has(id))) throw new Error('Project privacy: the source context is outside the target project or explicit shared team.');
  if (agent?.contextIsolation) throw new Error('Start a fresh agent after moving projects; its old conversation cannot be erased.');
}
