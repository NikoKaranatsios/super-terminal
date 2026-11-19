import {occupiesRuntimeSlot} from '../shared/runtime-state.mjs';
import {teamRuntimeMarkup,runtimeSetupMarkup,runtimeBadge} from './runtime-view.mjs';
export { workspaceRecords as environmentWorkspace } from '../shared/workspace-records.mjs';
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
  const projects = new Map((state.projects || []).filter(p=>!p.mergedIntoProjectId).map(p => [p.id, { ...p, tasks: [] }]));
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
  const title = agent.role || mission || agent.conversationTitle || (state.history || []).find(h => h.id === agent.historyId)?.title || agent.title;
  const candidate=String(title || '').split('\n')[0];
  const generic=/^(?:(?:codex|claude|grok|shell|zsh|bash|fish|ssh)\s*·\s*)?(?:ttys?\d+|pts\/\d+|\?\??|PID\s+\d+|terminal)$/i.test(candidate);
  if(agent.runtime)return `${agent.provider || 'Provider'} service`;
  if(candidate && !generic)return candidate.replace(/^(codex|claude|grok|shell) · /, '');
  const project=(state.projects || []).find(p=>p.id===agent.projectId);
  const provider=agent.provider==='shell'?'Terminal':agent.provider || 'Agent';
  return `${provider} · ${project?.name || agent.cwd?.split('/').filter(Boolean).at(-1) || 'Unassigned'}`;
}
export function processLabel(agent) {
  if (agent.kind==='enrolled') return agent.enrollmentRevokedAt ? 'MCP revoked · process unknown' : `MCP ${agent.freshness || 'never'} contact · process unknown`;
  return agent.launchState==='recovery-shell'?'Provider exited · recovery shell':agent.launchState==='starting'||agent.launchState==='transport-ready'?'Transport ready · provider acceptance unverified':agent.connectionLost ? 'Connection lost · process unknown' : agent.runtime ? 'Background service' : agent.status === 'external' ? 'External · read only' : agent.status || 'Unknown';
}
export function agentContext(agent, state = {}, includeStatus = true) {
  const project = (state.projects || []).find(p => p.id === agent.projectId || p.id === agent.scope?.projectId);
  const team = (state.teams || []).find(t => t.id === agent.teamId);
  return [...new Set([agent.provider === 'shell' ? 'terminal' : agent.provider, project?.name || agent.cwd?.split('/').filter(Boolean).at(-1), team?.name, includeStatus?processLabel(agent):null,agent.kind==='external'&&!agent.historyId&&agent.pid?'PID '+agent.pid:null].filter(Boolean))].join(' · ');
}
export function canControl(agent) {
  if (agent.kind==='enrolled') return false;
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
const environmentName = (state, host) => host==='local'?'Local':state.hostNames?.[host] || host || 'Unassigned environment';
const matches = (query, values) => String(query || '').toLowerCase().split(/\s+/).filter(Boolean).every(term=>values.join(' ').toLowerCase().includes(term));
const filterInput = (value, label) => `<input type="search" data-work-search aria-label="${label}" placeholder="${label}…" value="${html(value || '')}">`;
export function overviewMarkup(state, sessionId = '', filters = {}) {
  const projects = projectWork(state, sessionId).filter(p=>(!filters.host||p.host===filters.host)&&matches(filters.query,[p.name,p.cwd,environmentName(state,p.host)])), total = projects.reduce((n,p) => n+p.tasks.length,0);
  const agents=(state.sessions || []).filter(a=>!a.runtime && a.provider!=='shell' && !a.enrollmentRevokedAt && !['stopped','exited'].includes(a.status));
  const count=id=>agents.filter(a=>a.projectId===id).length;
  const filtered=!!(filters.query||filters.host),primary=projects.filter(p=>filtered || p.tasks.length || count(p.id)),other=projects.filter(p=>!filtered && !p.tasks.length && !count(p.id));
  const strip=p=>`<section class="project-strip" aria-label="${html(p.name)}"><div class="project-label"><button data-work-view="project:${html(p.id)}">${html(p.name)} →</button><small>${p.tasks.filter(t=>t.status==='done').length}/${p.tasks.length} finished · ${html(environmentName(state,p.host))}</small><small title="${html(p.cwd || '')}">${html(p.cwd || 'Location not assigned')}</small>${count(p.id)?`<small>${count(p.id)} detected agent${count(p.id)===1?'':'s'}</small>`:''}</div><div class="task-squares" role="group" aria-label="${html(p.name)} tasks">${p.tasks.map(taskSquare).join('') || '<span class="muted">No tasks yet</span>'}</div></section>`;
  return `<div class="work-heading"><h1>All projects</h1><label class="scope-filter">Work scope <select data-work-filter aria-label="Filter tasks by working session"><option value="">All working sessions</option>${(state.workSessions || []).map(s => `<option value="${html(s.id)}"${sessionId===s.id?' selected':''}>${html(s.title)} · ${html(s.status)}</option>`).join('')}</select></label></div><div class="work-filters">${filterInput(filters.query,'Search projects')}</div><p class="work-hint">One square per task in this environment. ${total} recorded task${total===1?'':'s'} · ${projects.length} project${projects.length===1?'':'s'}.</p><div class="task-legend">${Object.keys(taskStates).filter(s=>s!=='disabled').map(status=>stateBadge({status})).join('')}</div>${primary.map(strip).join('')}${other.length?`<details class="other-projects" data-work-section="other-projects"><summary>Other projects · ${other.length}</summary><p class="work-hint">No recorded tasks or currently detected agents.</p>${other.map(strip).join('')}</details>`:''}${!projects.length?'<p class="work-empty" role="status">No projects match these filters.</p>':!total?`<p class="work-empty">Describe what you want to work on in Conductor. Projects and tasks appear here as they are recorded.</p>${ask({},'Describe work in Conductor')}`:''}`;
}
export function projectMarkup(state, id, filters = {}) {
  const project = projectWork(state).find(p=>p.id===id);
  if (!project) return '<p class="work-empty">This project is no longer available. Its view has been preserved.</p>';
  const tasks=project.tasks.filter(t=>(!filters.status||t.status===filters.status)&&matches(filters.query,[t.title,t.notes,t.blocker,agentTitle((state.sessions || []).find(s=>s.id===t.agentId) || {},state)]));
  return `<div class="breadcrumbs"><button data-work-view="overview">All projects</button> / ${html(project.name)}</div><h1>${html(project.name)}</h1><p class="work-hint">${html(environmentName(state,project.host))} · ${html(project.cwd || 'Location not assigned')}</p>${ask({projectId:id},'Discuss project')}<div class="work-filters">${filterInput(filters.query,'Search tasks')}<select data-task-status aria-label="Task state"><option value="">All states</option>${Object.entries(taskStates).map(([key,value])=>`<option value="${key}"${filters.status===key?' selected':''}>${html(value.label)}</option>`).join('')}</select></div><div class="table-scroll" tabindex="0" role="region" aria-label="${html(project.name)} task table"><table class="work-table"><caption class="sr-only">Tasks, progress, assigned agents and latest notes</caption><thead><tr><th scope="col">Task</th><th scope="col">State</th><th scope="col">Agent</th><th scope="col">Latest note</th></tr></thead><tbody>${tasks.map(t=>{const a=(state.sessions||[]).find(s=>s.id===t.agentId),note=String(t.blocker || t.notes || '—').replace(/\s+/g,' ');return `<tr><td><button data-work-view="task:${html(t.id)}">${html(t.title)}</button></td><td>${stateBadge(t)}</td><td>${a?`<button data-id="${html(a.id)}">${html(agentTitle(a,state))}</button><small>${html(processLabel(a))}</small>`:'<span class="muted">Unassigned</span>'}</td><td class="task-note"><span>${html(note.length>180?note.slice(0,177)+'…':note)}</span></td></tr>`;}).join('')}</tbody></table></div>${!tasks.length?`<p class="work-empty" role="status">${project.tasks.length?'No tasks match these filters.':'No tasks recorded. Describe this project’s work in Conductor.'}</p>`:''}`;
}
export function taskMarkup(state, id) {
  const project = projectWork(state).find(p=>p.tasks.some(t=>t.id===id)), task=project?.tasks.find(t=>t.id===id);
  if(!task)return '<p class="work-empty">This task is no longer available. Select another task from All projects.</p>';
  const agents=(state.sessions||[]).filter(a=>a.id===task.agentId || a.taskId===id || a.scope?.goalId===id || a.scope?.taskId===id);
  const evidence=Array.isArray(task.evidence)?task.evidence:task.evidence?[task.evidence]:[];
  return `<div class="breadcrumbs"><button data-work-view="overview">All projects</button> / <button data-work-view="project:${html(project.id)}">${html(project.name)}</button> / Task</div><h1>${html(task.title)}</h1>${stateBadge(task)}${ask(scopeFor(task),'Discuss task')}<section class="task-section"><h2>Context</h2><p>${html(task.description || task.notes || 'No task notes yet.')}</p>${task.description&&task.notes&&task.notes!==task.description?`<p>${html(task.notes)}</p>`:''}${task.blocker?`<p class="problem-note">${html(task.blocker)}</p>`:''}<small class="muted">${html(project.name)} · ${html(project.host || 'Unassigned environment')} · ${html(project.cwd || 'Location not assigned')}${task.updatedAt?' · Updated '+html(new Date(task.updatedAt).toLocaleString()):''}</small></section><section class="task-section"><h2>Agents</h2>${agents.map(a=>`<button class="agent task-agent" data-id="${html(a.id)}"><span>${html(agentTitle(a,state))} →</span><small>${html(agentContext(a,state))}</small></button>`).join('')||'<p class="muted">No assigned agent. Ask Conductor to assign this task.</p>'}<p class="work-hint">Process state and task progress are separate. A response or process ending does not complete a task.</p></section><section class="task-section"><h2>Evidence</h2>${evidence.map(e=>`<pre class="evidence">${html(typeof e==='string'?e:JSON.stringify(e,null,2))}</pre>`).join('') || '<p class="muted">No completion evidence recorded.</p>'}</section>`;
}
export function teamsMarkup(state, filters = {}) {
  const teams=(state.teams||[]).filter(t=>matches(filters.query,[t.name,t.mission,(state.projects||[]).find(p=>p.id===t.projectId)?.name]));
  const agents=(state.sessions||[]).filter(s=>s.teamId&&occupiesRuntimeSlot(s));
  const isolated=(state.teams||[]).filter(t=>t.runtime?.mode==='container').length;
  return `<div class="work-heading"><div><h1>Teams</h1><p class="work-hint">${agents.length} active agents · ${isolated} isolated teams · ${(state.sessions||[]).filter(s=>s.parentAgentId).length} managed helpers</p></div><button class="text-action" data-runtime-create>Create an isolated team →</button></div>${runtimeSetupMarkup(state)}<div class="work-filters">${filterInput(filters.query,'Search teams')}</div>${teams.map(t=>{
    const members=(state.sessions||[]).filter(s=>s.teamId===t.id),project=(state.projects||[]).find(p=>p.id===t.projectId);
    return `<section class="team-strip"><div class="team-heading"><div><h2>${html(t.name)}</h2>${project?`<button class="team-project" data-work-view="project:${html(project.id)}">${html(project.name)} →</button>`:''}</div><button class="text-action" data-team="${html(t.id)}">Open conversation →</button></div><p class="team-mission">${html(t.mission||'No mission recorded.')}</p>${teamRuntimeMarkup(t,members)}${state.actionProblems?.get('runtime-team:'+t.id)?`<p class="runtime-error" role="status">${html(state.actionProblems.get('runtime-team:'+t.id))}</p>`:''}${t.runtime?.mode==='container'?`<div class="runtime-actions team-runtime-controls">${members.some(s=>s.status==='paused')?`<button data-team-runtime="${html(t.id)}"${state.pendingActions?.has('runtime-team:'+t.id)?' disabled':''} data-runtime-state="running">Resume team</button>`:members.some(s=>s.status==='running')?`<button data-team-runtime="${html(t.id)}"${state.pendingActions?.has('runtime-team:'+t.id)?' disabled':''} data-runtime-state="paused">Pause team</button>`:''}${members.length?`<button data-team-runtime="${html(t.id)}"${state.pendingActions?.has('runtime-team:'+t.id)?' disabled':''} data-runtime-state="stopped">${members.some(s=>!s.enrollmentRevokedAt)?'Stop team':'Release runtime services'}</button>`:''}</div>`:''}<div class="team-agent-list" role="list" aria-label="${html(t.name)} agents">${members.map(a=>`<div class="team-agent-row${a.parentAgentId?' team-helper':''}" role="listitem"><div class="team-agent-identity"><button data-id="${html(a.id)}">${a.parentAgentId?'↳ ':''}${html(agentTitle(a,state))} →</button><small>${html(a.provider)} · ${a.parentAgentId?'Helper':'Team member'}</small></div><span class="runtime-status" data-state="${html(a.status)}">${html(a.status||'Unknown')}</span><div class="team-agent-actions">${a.execution?.kind==='container'?`<button data-work-view="runtime:${html(a.id)}">Runtime & browser →</button>`:runtimeBadge(a)}</div></div>`).join('')||'<p class="work-empty">No agents started. Configure this team in Conductor, then ask it to start the required roles.</p>'}</div><div class="team-footer"><span>${html(environmentName(state,t.host||'local'))} · ${html(t.cwd||'Location not assigned')}</span>${ask({group:t.name,...(t.projectId?{projectId:t.projectId}:{}),...(t.scope?.workSessionId?{workSessionId:t.scope.workSessionId}:{})},'Configure in Conductor')}</div></section>`;
  }).join('')||`<p class="work-empty">${filters.query?'No teams match your search.':'Create a team in Conductor to give agents a shared mission and a clear execution boundary.'}</p>`}`;
}
