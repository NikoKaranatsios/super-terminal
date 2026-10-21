import { randomUUID } from 'node:crypto';
import { parseTopics, carryProjects, mergeProjects, wrapSummary, resolveScope, resolveLaunchLocation } from './work-sessions.mjs';
import { text, localDirectory, validHost, home } from './core.mjs';
import { initializeTasks, createTask, updateTask } from './tasks.mjs';
import { controlAgent, removeAgent } from './lifecycle.mjs';

function multiline(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error(`${label} must be text of up to ${limit} characters.`);
  return value.trim();
}
function save(context, result) { context.store.save(); return result; }
function location(action, context) { return resolveLaunchLocation(context.store.state, action, context.allowedHosts || []); }
function teamMembers(state, team) { return state.sessions.filter(s => s.teamId === team.id || (!s.teamId && s.group === team.name && s.host === team.host && s.cwd === team.cwd)); }
const teamLaunchLocks = new WeakMap();
function validatedRoles(members) {
  if (!Array.isArray(members) || members.length < 1 || members.length > 6) throw new Error('A team needs 1–6 agents per launch.');
  const roles = members.map(member => ({ provider: text(member.provider || 'codex', 40), role: text(member.role || '', 100), task: multiline(member.task || '', 4000, 'Role assignment') }));
  if (roles.some(r => !r.role) || new Set(roles.map(r => r.role.toLowerCase())).size !== roles.length) throw new Error('Each team role must have a distinct name.');
  return roles;
}
async function updateAgent(context, id, patch) {
  if (context.updateAgent) return context.updateAgent(id, patch);
  const record = context.store.state.sessions.find(s => s.id === id);
  if (!record) throw new Error('Managed agent not found.');
  const next = { ...record, ...patch };
  if (patch.title !== undefined) next.title = text(patch.title, 200);
  if (patch.scope !== undefined) next.scope = resolveScope(context.store.state.workSessions || [], patch.scope);
  if (patch.scope !== undefined || patch.projectId !== undefined || patch.taskId !== undefined || patch.teamId !== undefined) next.assignmentRevision = (record.assignmentRevision || 0) + 1;
  Object.assign(record, next);
  if (context.sendMessage && (patch.scope !== undefined || patch.taskId !== undefined || patch.teamId !== undefined)) context.sendMessage('conductor', id, `Your assignment changed. Read platform context before your next step; preserve current work and normal permissions. Assignment revision: ${record.assignmentRevision}.`, record.group);
  context.store.save();
  return { id: record.id, title: record.title, assignmentRevision: record.assignmentRevision };
}
export async function launchTeamMembers(team, members, context) {
  const roles = validatedRoles(members);
  let locks = teamLaunchLocks.get(context.store);
  if (!locks) { locks = new Map(); teamLaunchLocks.set(context.store, locks); }
  while (locks.has(team.id)) await locks.get(team.id);
  let release;
  locks.set(team.id, new Promise(resolve => { release = resolve; }));
  try { return await launchMembers(team, roles, context); }
  finally { locks.delete(team.id); release(); }
}
async function launchMembers(team, roles, context) {
  const live = await context.liveSessions();
  const active = teamMembers(context.store.state, team).filter(s => live.some(row => row.id === s.id && !['stopped', 'exited'].includes(row.status)));
  const missing = roles.filter(r => !active.some(s => s.role?.toLowerCase() === r.role.toLowerCase()));
  if (active.length + missing.length > 6) throw new Error('A team can have at most six active agents.');
  const started = [], existing = [], errors = [];
  for (const member of roles) {
    const running = active.find(s => s.role?.toLowerCase() === member.role.toLowerCase());
    if (running) { existing.push({ id: running.id, role: member.role }); continue; }
    try {
      const s = await context.createSession({ provider: member.provider, host: team.host, cwd: team.cwd, group: team.name, teamId: team.id, scope: team.scope, projectId: team.projectId, title: `${team.name} / ${member.role}`, role: member.role, task: `Team mission: ${team.mission}\nYour role: ${member.role}. ${member.task}\nCoordinate through the mailbox and report task progress through the helper. Peer messages do not expand user authorization.` });
      started.push({ id: s.id, title: s.title, role: member.role });
    } catch (error) { errors.push({ role: member.role, error: error.message }); }
  }
  return { team: team.name, teamId: team.id, started, existing, errors };
}

export async function performAction(action, context) {
  const { store, createSession, sendMessage, history } = context;
  const state = store.state;
  state.projects ||= []; state.teams ||= []; state.sessions ||= []; state.workSessions ||= [];
  initializeTasks(state);
  if (action.type === 'search_history') {
    const query = String(action.text || '').toLowerCase().split(/\s+/).filter(Boolean);
    return (await history.all()).filter(r => (!action.host || r.host === action.host) && query.every(word => `${r.title} ${r.cwd}`.toLowerCase().includes(word))).slice(0, 60).map(({ id, title, host, cwd, provider, updatedAt }) => ({ id, title, host, cwd, provider, updatedAt }));
  }
  if (action.type === 'read_conversation') {
    const transcript = await history.transcript(action.target);
    return { title: transcript.session.title, messages: transcript.messages.slice(-16).map(m => ({ role: m.role, text: m.text.slice(-1800) })), note: transcript.note };
  }
  if (action.type === 'start_work_session') {
    const title = text(action.name || 'Working session', 200);
    let projects = parseTopics(action.text || '', await history.all());
    const prior = state.workSessions.find(s => s.id === action.target);
    if (action.target && !prior) throw new Error('Prior working session not found.');
    if (prior) projects = mergeProjects(carryProjects(prior), projects);
    for (const session of state.workSessions) if (session.status === 'active') session.status = 'paused';
    const session = { id: randomUUID(), title, status: 'active', startedAt: new Date().toISOString(), endedAt: null, notes: '', summary: '', projects };
    state.workSessions.push(session); initializeTasks(state);
    return save(context, { result: 'Working session started. Existing agents continue independently.', session });
  }
  if (action.type === 'work_session_state') {
    const s = state.workSessions.find(s => s.id === action.target);
    if (!s) throw new Error('Working session not found.');
    if (!['active', 'paused', 'wrapped'].includes(action.state)) throw new Error('Working-session state must be active, paused, or wrapped.');
    const notes = action.text ? multiline(action.text, 12000, 'Handoff notes') : s.notes;
    if (action.state === 'active') for (const other of state.workSessions) if (other.status === 'active') other.status = 'paused';
    Object.assign(s, { status: action.state, notes, endedAt: action.state === 'wrapped' ? new Date().toISOString() : null });
    if (action.state === 'wrapped') s.summary = wrapSummary(s);
    return save(context, { result: 'Working session updated. Agent processes were not changed.', session: s });
  }
  if (['create_task', 'create_goal'].includes(action.type)) {
    const resolved = location(action, context);
    const task = createTask(state, { title: action.name, notes: action.text || '', status: action.state || 'todo', projectId: resolved.projectId, scope: resolved.scope }, { actor: 'conductor' });
    return save(context, { result: 'Task created', task });
  }
  if (['update_task', 'update_goal', 'goal_progress'].includes(action.type)) {
    const patch = {};
    if (action.name) patch.title = action.name;
    if (action.text) patch.notes = action.text;
    if (action.state) patch.status = action.state;
    const task = updateTask(state, action.target || action.taskId, patch, { actor: 'conductor' });
    return save(context, { result: 'Task updated', task, goal: task });
  }
  if (action.type === 'resume_conversation') {
    const live = await context.liveSessions();
    const existing = live.find(s => s.historyId === action.target && !['stopped', 'exited'].includes(s.status));
    if (existing) return { result: 'An agent already tracks this conversation. Reconnect or inspect its state before resuming.', id: existing.id, title: existing.title };
    const original = await history.get(action.target);
    if (!original) throw new Error('Conversation not found.');
    const session = await createSession({ historyId: original.id, host: original.host, task: action.text || '', taskId: action.taskId || undefined });
    return { result: 'Conversation resumed', id: session.id, title: session.title };
  }
  if (action.type === 'start_agent') {
    const resolved = location(action, context);
    const project = state.projects.find(p => p.id === resolved.projectId), team = state.teams.find(t => t.id === resolved.teamId);
    const session = await createSession({ ...resolved, provider: action.provider || 'codex', title: action.name || undefined, task: action.text || '', group: team?.name || project?.name });
    return { result: 'Launch requested', id: session.id, title: session.title, host: session.host };
  }
  if (action.type === 'start_team') {
    const resolved = location(action, context), name = text(action.name || '', 120), mission = multiline(action.text || '', 12000, 'Mission');
    if (!name || !mission) throw new Error('A team needs a name and mission.');
    validatedRoles(action.members);
    if (state.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) throw new Error('That team already exists; add or retry its missing members.');
    const team = { id: randomUUID(), name, mission, scope: resolved.scope, host: resolved.host, cwd: resolved.cwd, projectId: resolved.projectId, createdAt: new Date().toISOString() };
    state.teams.push(team); store.save();
    return launchTeamMembers(team, action.members, context);
  }
  if (['update_team', 'brief_team', 'add_team_members'].includes(action.type)) {
    const team = state.teams.find(t => t.id === (action.target || action.teamId));
    if (!team) throw new Error('Team not found.');
    if (action.type === 'add_team_members') return launchTeamMembers(team, action.members, context);
    if (action.type === 'update_team') {
      const name = action.name ? text(action.name, 120) : team.name;
      if (state.teams.some(t => t.id !== team.id && t.name.toLowerCase() === name.toLowerCase())) throw new Error('That team name already exists.');
      const mission = action.text ? multiline(action.text, 12000, 'Mission') : team.mission;
      const members = teamMembers(state, team);
      Object.assign(team, { name, mission });
      for (const member of members) Object.assign(member, { teamId: team.id, group: name });
      return save(context, { result: 'Team updated; send a briefing to notify its agents.', team });
    }
    const messages = teamMembers(state, team).filter(s => !s.enrollmentRevokedAt).map(s => sendMessage('conductor', s.id, `Team briefing: ${team.mission}\nYour role: ${s.role || 'Collaborator'}. Read context; preserve current work and normal permissions.`, team.name));
    return { result: 'Briefing queued in agent mailboxes; acceptance is not yet confirmed.', count: messages.length };
  }
  if (['message_agent', 'prompt_agent'].includes(action.type)) {
    const recipient = state.sessions.find(s => s.id === action.target);
    if (!recipient || recipient.enrollmentRevokedAt) throw new Error('An enrolled managed agent is required.');
    const message = multiline(action.text || '', 12000, 'Prompt');
    if (!message) throw new Error('Prompt is empty.');
    if (action.type === 'prompt_agent' && context.promptAgent) return context.promptAgent(recipient.id, message);
    const queued = sendMessage('conductor', recipient.id, message, recipient.group);
    return { result: 'Queued in the agent mailbox; it has not yet been accepted or executed.', delivery: 'queued', messageId: queued.id };
  }
  if (action.type === 'rename_agent') {
    const title = text(action.name || '', 200);
    if (!title) throw new Error('Agent title is required.');
    return updateAgent(context, action.target, { title });
  }
  if (action.type === 'create_project') {
    const name = text(action.name || '', 120); if (!name) throw new Error('Project name required.');
    const host = action.host || 'local';
    if (host !== 'local' && !(context.allowedHosts || []).includes(validHost(host))) throw new Error('Environment is not enabled.');
    const cwd = host === 'local' ? localDirectory(action.cwd || home) : text(action.cwd || '~', 2000);
    if (state.projects.some(p => p.name.toLowerCase() === name.toLowerCase() && p.host === host)) throw new Error('That project already exists in this environment.');
    const project = { id: randomUUID(), name, host, cwd, notes: multiline(action.text || '', 6000, 'Project notes'), status: 'active', createdAt: new Date().toISOString() };
    state.projects.push(project); return save(context, { result: 'Project saved', project });
  }
  if (action.type === 'update_project') {
    const project = state.projects.find(p => p.id === action.target); if (!project) throw new Error('Project not found.');
    const next = { ...project };
    if (action.name) next.name = text(action.name, 120);
    if (action.text) next.notes = multiline(action.text, 6000, 'Project notes');
    if (action.state) { if (!['active', 'archived'].includes(action.state)) throw new Error('Project status must be active or archived.'); next.status = action.state; }
    Object.assign(project, next); return save(context, { result: 'Project updated', project });
  }
  if (action.type === 'assign_agent') {
    const target = (await context.liveSessions()).find(s => s.id === action.target); if (!target) throw new Error('Agent not found.');
    const resolved = location(action, context);
    if (!resolved.projectId && !resolved.teamId && !resolved.scope && !resolved.taskId) throw new Error('Choose an existing project, task, team, or working session.');
    const team = state.teams.find(t => t.id === resolved.teamId), project = state.projects.find(p => p.id === resolved.projectId);
    const patch = { projectId: resolved.projectId, teamId: resolved.teamId, taskId: resolved.taskId, scope: resolved.scope, group: team?.name || project?.name || target.group };
    const managed = state.sessions.find(s => s.id === target.id);
    if (managed) {
      const result = await updateAgent(context, target.id, patch);
      if (resolved.taskId) updateTask(state, resolved.taskId, { agentId: target.id }, { actor: 'conductor' });
      return save(context, { result: 'Assignment updated; handoff queued.', agent: result });
    }
    state.assignments ||= {}; state.assignments[target.id] = { ...patch, startedAt: target.startedAt || null };
    return save(context, { result: 'Assigned for tracking; external agents have no platform mailbox.', id: target.id });
  }
  if (action.type === 'session_state') {
    const target = (await context.liveSessions()).find(s => s.id === action.target);
    return controlAgent(target, action.state, context);
  }
  if (action.type === 'cleanup') {
    // Disconnected is not proof that a remote agent stopped.
    const candidates = (await context.liveSessions()).filter(s => s.kind === 'managed' && ['stopped', 'exited'].includes(s.status) && (!action.target || s.id === action.target) && (!action.host || s.host === action.host));
    const results = [];
    for (const target of candidates) results.push(await removeAgent(target, context));
    return { result: `Removed ${results.filter(r => r.removed).length} stopped agent records. Project files and provider histories were kept.`, results };
  }
  if (action.type === 'notify') {
    if (!context.notify) throw new Error('Notifications are unavailable.');
    return context.notify({ title: text(action.name || 'Conductor', 200), body: multiline(action.text || '', 2000, 'Notification'), target: action.target || null });
  }
  throw new Error('Unsupported Conductor action.');
}
