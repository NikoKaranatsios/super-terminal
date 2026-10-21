export const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const taskStates = {
  todo: { label: 'Not started', mark: '○' }, doing: { label: 'In progress', mark: '›' },
  blocked: { label: 'Problem', mark: '!' }, done: { label: 'Finished', mark: '✓' },
  stopped: { label: 'Stopped', mark: '■' }, disabled: { label: 'Disabled', mark: '−' }
};
export function taskState(task) { return taskStates[task.status] ? task.status : 'unknown'; }
export function statusLabel(task) { return taskStates[taskState(task)]?.label || 'Unknown'; }
export function stateBadge(task) { return `<span class="task-state state-${taskState(task)}"><span aria-hidden="true">${taskStates[taskState(task)]?.mark || '?'}</span> ${html(statusLabel(task))}</span>`; }
export function projectWork(state, sessionId = '') {
  const projects = new Map((state.projects || []).map(p => [p.id, { ...p, tasks: [] }]));
  const sessions = state.workSessions || [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : sessions.flatMap(s => (s.projects || []).flatMap(p => (p.goals || []).map(g => ({ ...g, projectId: p.canonicalProjectId || p.projectId || p.id, scope: { workSessionId:s.id, projectId:p.id, goalId:g.id } }))));
  for (const s of sessions) for (const p of s.projects || []) {
    const id = p.canonicalProjectId || p.projectId || p.id;
    if (!projects.has(id)) projects.set(id, { ...p, id, tasks: [] });
  }
  for (const task of tasks) {
    if (sessionId && task.scope?.workSessionId !== sessionId && task.workSessionId !== sessionId && !task.workSessionIds?.includes(sessionId) && !sessions.find(s => s.id === sessionId)?.projects?.some(p => p.goals?.some(g => (g.taskId || g.id) === task.id))) continue;
    const id = task.projectId || task.scope?.projectId || 'unassigned';
    if (!projects.has(id)) projects.set(id, {id, name:'Unassigned project', tasks:[]});
    projects.get(id).tasks.push(task);
  }
  return [...projects.values()].filter(p => !sessionId || p.tasks.length || sessions.find(s => s.id === sessionId)?.projects?.some(q => (q.canonicalProjectId || q.projectId || q.id) === p.id));
}
export function agentTitle(agent, state = {}) {
  const task = (state.tasks || []).find(t => t.id === agent.taskId || t.id === agent.scope?.goalId || t.id === agent.scope?.taskId || t.agentId === agent.id);
  const mission = agent.mission || task?.title;
  const title = agent.role && mission && agent.role!==mission ? `${agent.role} · ${mission}` : agent.role || mission || (state.history || []).find(h => h.id === agent.historyId)?.title || agent.title;
  return String(title || agent.cwd?.split('/').filter(Boolean).at(-1) || agent.tty || `${agent.provider || 'Agent'} ${agent.pid || ''}`).replace(/^(codex|claude|grok|shell) · /, '').split('\n')[0];
}
export function processLabel(agent) {
  return agent.connectionLost ? 'Connection lost · process unknown' : agent.runtime ? 'Background service' : agent.status === 'external' ? 'External · read only' : agent.status || 'Unknown';
}
export function agentContext(agent, state = {}) {
  const project = (state.projects || []).find(p => p.id === agent.projectId || p.id === agent.scope?.projectId);
  const team = (state.teams || []).find(t => t.id === agent.teamId || t.name === agent.group);
  return [agent.provider === 'shell' ? 'terminal' : agent.provider, project?.name || agent.cwd?.split('/').filter(Boolean).at(-1), team?.name, processLabel(agent)].filter(Boolean).join(' · ');
}
export function canControl(agent) {
  return !!agent && !agent.runtime && !agent.connectionLost && ['managed','tmux'].includes(agent.kind) && ['running','paused'].includes(agent.status);
}
// Preserve older pages and intentional repeated events. Only a contiguous page
// overlap can be removed; global text deduplication loses real tool output.
export function mergeOutput(previous, incoming, prepend = false) {
  if(previous.concat(incoming).every(event=>event.id)) {
    const events=new Map(previous.map(event=>[event.id,event]));
    for(const event of incoming)events.set(event.id,event);
    return [...events.values()].sort((a,b)=>{const aa=a.id.split(':'),bb=b.id.split(':');return Number(aa.at(-2))-Number(bb.at(-2)) || Number(aa.at(-1))-Number(bb.at(-1));});
  }
  const left=prepend?incoming:previous, right=prepend?previous:incoming;
  let overlap=0;
  for(let n=Math.min(left.length,right.length);n>0;n--) {
    if(left.slice(-n).every((event,i)=>JSON.stringify(event)===JSON.stringify(right[i]))) {overlap=n;break;}
  }
  return [...left,...right.slice(overlap)];
}
export function taskSquare(task) {
  return `<button class="task-square state-${taskState(task)}" data-work-view="task:${html(task.id)}" data-task-square="${html(task.id)}" aria-label="${html(task.title)} — ${html(statusLabel(task))}" title="${html(task.title)} — ${html(statusLabel(task))}"><span aria-hidden="true">${taskStates[taskState(task)]?.mark || '?'}</span></button>`;
}
const ask = (scope, label='Ask Conductor') => `<button class="text-action" data-ask-scope="${html(JSON.stringify(scope))}">${html(label)} →</button>`;
const scopeFor = task => ({ ...(task.scope?.workSessionId?{workSessionId:task.scope.workSessionId}:{}), projectId:task.projectId || task.scope?.projectId, taskId:task.id });
export function overviewMarkup(state, sessionId = '') {
  const projects = projectWork(state, sessionId), total = projects.reduce((n,p) => n+p.tasks.length,0);
  return `<div class="work-heading"><h1>All projects</h1><label class="scope-filter">Work scope <select data-work-filter aria-label="Filter tasks by working session"><option value="">All working sessions</option>${(state.workSessions || []).map(s => `<option value="${html(s.id)}"${sessionId===s.id?' selected':''}>${html(s.title)} · ${html(s.status)}</option>`).join('')}</select></label></div><p class="work-hint">One square per task. ${total} recorded task${total===1?'':'s'} · all environments.</p><div class="task-legend">${Object.keys(taskStates).filter(s=>s!=='disabled').map(status=>stateBadge({status})).join('')}</div>${projects.map(p => `<section class="project-strip" aria-label="${html(p.name)}"><div class="project-label"><button data-work-view="project:${html(p.id)}">${html(p.name)} →</button><small>${p.tasks.filter(t=>t.status==='done').length}/${p.tasks.length} finished · ${html(p.host || 'unassigned')}</small></div><div class="task-squares" role="group" aria-label="${html(p.name)} tasks">${p.tasks.map(taskSquare).join('') || '<span class="muted">No tasks yet</span>'}</div></section>`).join('')}${!total?`<p class="work-empty">Describe what you want to work on in Conductor. Projects and tasks appear here as they are recorded.</p>${ask({},'Describe work in Conductor')}`:''}`;
}
export function projectMarkup(state, id) {
  const project = projectWork(state).find(p=>p.id===id);
  if (!project) return '<p class="work-empty">This project is no longer available. Its view has been preserved.</p>';
  return `<div class="breadcrumbs"><button data-work-view="overview">All projects</button> / ${html(project.name)}</div><h1>${html(project.name)}</h1><p class="work-hint">${html(project.host || 'Unassigned environment')} · ${html(project.cwd || 'Location not assigned')}</p>${ask({projectId:id},'Discuss project')}<div class="table-scroll"><table class="work-table"><thead><tr><th scope="col">Task</th><th scope="col">State</th><th scope="col">Agent</th><th scope="col">Latest note</th></tr></thead><tbody>${project.tasks.map(t=>{const a=(state.sessions||[]).find(s=>s.id===t.agentId);return `<tr><td><button data-work-view="task:${html(t.id)}">${html(t.title)}</button></td><td>${stateBadge(t)}</td><td>${a?`<button data-id="${html(a.id)}">${html(agentTitle(a,state))}</button><small>${html(processLabel(a))}</small>`:'<span class="muted">Unassigned</span>'}</td><td class="task-note">${html(t.blocker || t.notes || '—')}</td></tr>`;}).join('')}</tbody></table></div>${!project.tasks.length?'<p class="work-empty">No tasks recorded. Describe this project’s work in Conductor.</p>':''}`;
}
export function taskMarkup(state, id) {
  const project = projectWork(state).find(p=>p.tasks.some(t=>t.id===id)), task=project?.tasks.find(t=>t.id===id);
  if(!task)return '<p class="work-empty">This task is no longer available. Select another task from All projects.</p>';
  const agents=(state.sessions||[]).filter(a=>a.id===task.agentId || a.taskId===id || a.scope?.goalId===id || a.scope?.taskId===id);
  const evidence=Array.isArray(task.evidence)?task.evidence:task.evidence?[task.evidence]:[];
  return `<div class="breadcrumbs"><button data-work-view="overview">All projects</button> / <button data-work-view="project:${html(project.id)}">${html(project.name)}</button> / Task</div><h1>${html(task.title)}</h1>${stateBadge(task)}${ask(scopeFor(task),'Discuss task')}<section class="task-section"><h2>Context</h2><p>${html(task.description || task.notes || 'No task notes yet.')}</p>${task.blocker?`<p class="problem-note">${html(task.blocker)}</p>`:''}<small class="muted">${html(project.name)} · ${html(project.host || 'Unassigned environment')} · ${html(project.cwd || 'Location not assigned')}${task.updatedAt?' · Updated '+html(new Date(task.updatedAt).toLocaleString()):''}</small></section><section class="task-section"><h2>Agents</h2>${agents.map(a=>`<button class="agent task-agent" data-id="${html(a.id)}"><span>${html(agentTitle(a,state))} →</span><small>${html(agentContext(a,state))}</small></button>`).join('')||'<p class="muted">No assigned agent. Ask Conductor to assign this task.</p>'}<p class="work-hint">Process state and task progress are separate. A response or process ending does not complete a task.</p></section><section class="task-section"><h2>Evidence</h2>${evidence.map(e=>`<pre class="evidence">${html(typeof e==='string'?e:JSON.stringify(e,null,2))}</pre>`).join('') || '<p class="muted">No completion evidence recorded.</p>'}</section>`;
}
export function teamsMarkup(state) {
  return `<div class="work-heading"><h1>Teams</h1>${ask({},'Create a team in Conductor')}</div><p class="work-hint">Describe a team and its mission in one message. Conductor creates and assigns agents through validated actions.</p>${(state.teams||[]).map(t=>{const members=(state.sessions||[]).filter(s=>s.teamId===t.id||s.group===t.name);return `<section class="team-strip"><h2>${html(t.name)}</h2><p>${html(t.mission || 'No mission recorded.')}</p><p class="work-hint">${html(t.host || 'local')} · ${html(t.cwd || 'Location not assigned')} · ${members.length} visible agent${members.length===1?'':'s'}</p>${members.map(a=>`<button class="agent task-agent" data-id="${html(a.id)}">${html(agentTitle(a,state))}<small>${html(agentContext(a,state))}</small></button>`).join('') || '<p class="muted">No visible agents. Saved team membership is retained.</p>'}<button class="text-action" data-team="${html(t.name)}">Messages →</button>${ask({group:t.name,...(t.projectId?{projectId:t.projectId}:{}),...(t.scope?.workSessionId?{workSessionId:t.scope.workSessionId}:{})},'Discuss team')}</section>`;}).join('')||'<p class="work-empty">No teams yet. Ask Conductor to assemble one for your work.</p>'}`;
}
