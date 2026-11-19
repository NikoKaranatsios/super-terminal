import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import './style.css';
import './sessions.css';
import { Workspace } from './workspace.mjs';
import { terminalTheme, applyTerminalPalette } from './terminal-theme.mjs';
import { conductorTurnMarkup, traceMarkup, conversationRecords } from './console-format.mjs';
import { markdownText } from './markdown.mjs';
import { helpSections } from './help-guide.mjs';
import { backgroundStatusMarkup } from './help-view.mjs';
import { OutputFollow, TerminalFollow, outputControls, paintFollow, reconcileOutput } from './output-follow.mjs';
import { conductorSettingsMarkup, conductorSkillMarkup } from './conductor-settings.mjs';
import { notificationTarget } from './notification-target.mjs';
import { liveSessionRows, sessionIdentity, sessionsMarkup } from './sessions-view.mjs';
import { sidebarInventory } from './sidebar-model.mjs';
import {SessionGraphView} from './session-graph.mjs';
import './session-graph.css';
import { SystemGraphView } from './system-graph.mjs';
import {runtimeMarkup,runtimeBadge} from './runtime-view.mjs';
import './runtime.css';
import { activeConductor } from '../shared/system-graph.mjs';
import { agentCapabilities, projectForAgent, projectOptions, messageDeliveryLabel } from './agent-view.mjs';
import { agentTitle, agentContext, processLabel, canControl, projectWork, overviewMarkup, projectMarkup, taskMarkup, teamsMarkup, mergeOutput, environmentWorkspace } from './work-views.mjs';

const $ = s => document.querySelector(s);
const shown = () => state ? environmentWorkspace(state, environment) : state;
let token = $('meta[name="super-terminal-token"]').content;
const expectedBuild=$('meta[name="super-terminal-build"]')?.content,expectedData=$('meta[name="super-terminal-data"]')?.content;
let tokenRefresh,serviceFailed=false;
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, environment = localStorage.getItem('environment') || 'local', selected = 'sessions', refreshing = false, bootBriefing = false;
const views = new Map();
let workSessionId=localStorage.getItem('workingSessionSelection') || '', workingSelectionRevision=0, workFilter='', chatScope=null;
const pendingActions=new Set();
const actionProblems=new Map();
const runtimeChecks=new Map();
let sidebarQuery='',historyLimit=40,sessionControlsOpen=false;
let sessionEnvironment=localStorage.getItem('sessionEnvironment') || 'all';
const compactNavigation=matchMedia('(max-width:720px)');
function setNavigation(open,restoreFocus=false){
  const visible=compactNavigation.matches&&open;document.body.classList.toggle('navigation-open',visible);
  $('#main').inert=visible;$('#sidebar').inert=compactNavigation.matches&&!visible;$('#sidebar-scrim').hidden=!visible;
  $('#toggle-sidebar').setAttribute('aria-expanded',String(visible));
  if(visible){$('#sidebar').setAttribute('role','dialog');$('#sidebar').setAttribute('aria-modal','true');$('#close-sidebar').focus();}
  else{$('#sidebar').removeAttribute('role');$('#sidebar').removeAttribute('aria-modal');if(restoreFocus)$('#toggle-sidebar').focus();}
}
compactNavigation.addEventListener('change',()=>setNavigation(false));
$('#toggle-sidebar').onclick=()=>setNavigation(true);$('#close-sidebar').onclick=()=>setNavigation(false,true);$('#sidebar-scrim').onclick=()=>setNavigation(false,true);
setNavigation(false);
const tabId=id=>'tab-'+encodeURIComponent(id),panelId=id=>'panel-'+encodeURIComponent(id);
function focusSelectedTab(){document.getElementById(tabId(selected))?.focus({preventScroll:true});}
function focusComposer(id){const v=views.get(id);if(v?.term&&!v.element.hidden){v.term.focus();return true;}const input=v?.element.querySelector('#chat-input,.agent-message:not([hidden]) textarea,.team-compose textarea');if(input&&!v.element.hidden){input.focus({preventScroll:true});return true;}return false;}
function selectTab(id,typing=false){layout.open(id);renderWorkspace();focusPane(layout.activePane);if(!typing||!focusComposer(id))focusSelectedTab();}
const sidebarExpanded=new Set();
const initial = new URLSearchParams(location.hash.slice(1));
const workspaceKey = 'workspace:'+(initial.get('window') || 'main');
const layout = new Workspace(localStorage.getItem(workspaceKey));
if(initial.get('environment')) environment=initial.get('environment');
let restoring=false, workspaceReady=false;
let lastStateAt=null,focusContext=null,focusSignature='',focusTimer,docsSection='overview';
try{focusContext=JSON.parse(localStorage.getItem('focus:'+workspaceKey) || 'null');}catch{}
applyTerminalPalette(document.documentElement);
function saveWorkspace(){localStorage.setItem(workspaceKey,layout.serialize());}
function tabLabel(id){const s=[...(state?.sessions||[]),...(state?.history||[])].find(s=>s.id===id);return id==='session-graph'?'Agent graph':id==='sessions'?'Sessions':id==='system-graph'?'System graph':id==='conductor'?'Conductor':id==='settings'?'Settings':id==='docs'?'Docs':id==='activity'?'Activity':id==='overview'?'All projects':id==='teams'?'Teams':id.startsWith('messages:')?messageTeam(id.slice(9))?.name || id.slice(9)||'Team conversations':s?(s.kind==='history'?agentTitle(s,state):[s.provider,sessionIdentity(s,state).identity,'·',sessionIdentity(s,state).project].join(' ')):views.get(id)?.title || 'Terminal';}
function focusPane(paneId){const pane=layout.focus(paneId);selected=pane.active || '';for(const el of document.querySelectorAll('.pane'))el.classList.toggle('focused',el.dataset.pane===paneId);document.title=(tabLabel(selected)||'Super Terminal')+' — Super Terminal';if(state){rememberFocus(selected);sidebar();}saveWorkspace();}
function renderWorkspace(){
  const cache=$('#view-cache');for(const v of views.values()){v.element.hidden=true;cache.append(v.element);}
  const draw=node=>node.axis?`<div class="split ${node.axis}" data-split="${node.id}" style="--ratio:${node.ratio}">${draw(node.first)}<div class="divider" role="separator" tabindex="0" aria-label="Resize panels" aria-orientation="${node.axis==='row'?'vertical':'horizontal'}" aria-valuemin="15" aria-valuemax="85" aria-valuenow="${Math.round(node.ratio*100)}" data-divider="${node.id}"></div>${draw(node.second)}</div>`:`<section class="pane${node.id===layout.activePane?' focused':''}" data-pane="${node.id}"><div class="tab-bar"><div class="tabs" role="tablist" aria-label="Panel tabs">${node.tabs.map(id=>`<div class="tab${node.active===id?' active':''}" role="presentation"><button role="tab" id="${tabId(id)}" aria-controls="${panelId(id)}" aria-describedby="tab-help" tabindex="${node.active===id?'0':'-1'}" aria-selected="${node.active===id}" data-tab="${escape(id)}" title="${escape(tabLabel(id))}"><span class="tab-label">${escape(tabLabel(id))}</span><span class="close-tab" data-close="${escape(id)}" aria-hidden="true" title="Close view; agent processes keep running">×</span></button></div>`).join('')}</div><button class="add-tab" data-add-tab="${node.id}" aria-label="New terminal tab" title="New shell terminal in the selected environment">＋</button></div><div class="pane-content"><div class="panel-empty">Select a session in the sidebar.<br><button data-close-panel="${node.id}">Close panel</button></div></div></section>`;
  $('#workspace').innerHTML=draw(layout.root);
  for(const pane of layout.panes()){
    const content=document.querySelector(`[data-pane="${pane.id}"] .pane-content`);const active=views.get(pane.active);
    if(active){content.replaceChildren(active.element);active.element.hidden=false;}
  }
  for(const v of views.values())if(!v.element.hidden){v.resize?.();v.follow?.activate();}
  document.getElementById(tabId(selected))?.scrollIntoView({block:'nearest',inline:'nearest'});saveWorkspace();
}
async function splitPanel(axis){try{layout.split(axis);renderWorkspace();const opened=new Set(layout.panes().flatMap(p=>p.tabs));const next=state.sessions.find(s=>s.host===environment&&!s.runtime&&!opened.has(s.id)&&['running','external','paused'].includes(s.status));if(next)await open(next.id);else focusPane(layout.activePane);}catch(e){notice(e.message);}}
function closeTab(id){const v=views.get(id);v?.ws?.close();v?.observer?.disconnect();v?.sessionGraph?.dispose();v?.follow?.dispose();v?.term?.dispose();v?.element.remove();views.delete(id);layout.close(id);renderWorkspace();focusPane(layout.activePane);if(selected)focusSelectedTab();else $('#toggle-sidebar').offsetParent?$('#toggle-sidebar').focus():$('#conductor-nav').focus();}
function openWindow(){if(window.superTerminalDesktop?.openWindow)window.superTerminalDesktop.openWindow({viewId:selected || 'conductor',environment});else notice('Separate windows are available in the desktop app.');}
function installDividers(){
  let drag;
  const sidebarWidth=value=>{const width=Math.max(150,Math.min(Math.min(460,innerWidth*.45),value));$('#sidebar').style.width=width+'px';localStorage.setItem('sidebarWidth',width);$('#sidebar-divider').setAttribute('aria-valuenow',Math.round(width));};
  sidebarWidth(Number(localStorage.getItem('sidebarWidth'))||220);
  document.addEventListener('pointerdown',e=>{
    const divider=e.target.closest('.divider');if(!divider)return;
    e.preventDefault();divider.focus();divider.setPointerCapture(e.pointerId);document.body.classList.add('resizing');
    drag={divider,pointer:e.pointerId,sidebar:divider.id==='sidebar-divider',node:layout.nodes().find(n=>n.id===divider.dataset.divider),rect:divider.parentElement.getBoundingClientRect()};
  });
  document.addEventListener('pointermove',e=>{if(!drag)return;if(drag.sidebar){sidebarWidth(e.clientX);return;}const {node,rect,divider}=drag;const value=node.axis==='row'?(e.clientX-rect.left)/rect.width:(e.clientY-rect.top)/rect.height;layout.resize(node.id,value);divider.parentElement.style.setProperty('--ratio',node.ratio);divider.setAttribute('aria-valuenow',Math.round(node.ratio*100));});
  const end=()=>{if(drag){drag=null;document.body.classList.remove('resizing');saveWorkspace();}};
  document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  document.addEventListener('keydown',e=>{const divider=e.target.closest('.divider');if(!divider||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const delta=['ArrowRight','ArrowDown'].includes(e.key)?1:-1;if(divider.id==='sidebar-divider')sidebarWidth($('#sidebar').getBoundingClientRect().width+delta*20);else{const node=layout.nodes().find(n=>n.id===divider.dataset.divider);layout.resize(node.id,node.ratio+delta*.05);divider.parentElement.style.setProperty('--ratio',node.ratio);divider.setAttribute('aria-valuenow',Math.round(node.ratio*100));saveWorkspace();}});
  document.addEventListener('dblclick',e=>{const divider=e.target.closest('[data-divider]');if(divider){layout.resize(divider.dataset.divider,.5);divider.parentElement.style.setProperty('--ratio',.5);saveWorkspace();}});
}

async function renewToken(){
  if(tokenRefresh)return tokenRefresh;
  tokenRefresh=(async()=>{
    const health=await fetch('/desktop-health',{signal:AbortSignal.timeout(6000)}).then(r=>r.json());
    if(health.product!=='super-terminal'||health.buildId!==expectedBuild||health.dataKey!==expectedData)throw new Error('The service build changed. Reopen Super Terminal to load the matching app.');
    const html=await fetch('/',{signal:AbortSignal.timeout(6000)}).then(r=>r.text());
    const next=new DOMParser().parseFromString(html,'text/html').querySelector('meta[name="super-terminal-token"]')?.content;
    if(!next)throw new Error('Could not reconnect to the local service.');token=next;
  })().finally(()=>{tokenRefresh=null;});return tokenRefresh;
}
async function api(url, body, method = 'POST', retry=true) {
  const response = await fetch('/api' + url, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type':'application/json', 'X-Super-Terminal':token }, ...(body === undefined ? {signal:AbortSignal.timeout(10000)} : { body:JSON.stringify(body) }) });
  const data = await response.json();
  if(response.status===403&&data.error==='Reload Super Terminal to reconnect.'&&retry){await renewToken();return api(url,body,method,false);}
  if (!response.ok) throw new Error(data.error || 'Connection failed'); return data;
}

let noticeTimer;
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 7000); }
function hostName(host) { return host === 'local' ? 'Local' : state?.hostNames[host] || host; }
function setFocusContext(context) {
  const next={viewId:context.viewId || selected,agentId:null,projectId:null,taskId:null,workSessionId:null,...context,environment:context.environment || environment,windowId:initial.get('window') || 'main'};
  const signature=JSON.stringify(next);if(signature===focusSignature)return;
  focusContext=next;focusSignature=signature;chatScope=null;
  localStorage.setItem('focus:'+workspaceKey,signature);
  clearTimeout(focusTimer);focusTimer=setTimeout(()=>api('/focus',next).catch(e=>notice('Current context could not be saved: '+e.message)),120);
  renderChat();
}
function rememberFocus(id) {
  if(restoring||!state)return;
  const agent=[...state.sessions,...state.history].find(s=>s.id===(id.startsWith('runtime:')?id.slice(8):id)),tasks=projectWork(state).flatMap(p=>p.tasks);
  if(agent){const project=projectForAgent(agent,state),task=project?tasks.find(t=>t.projectId===project.id&&(t.id===agent.taskId||t.id===agent.scope?.goalId||t.agentId===agent.id)):null;setFocusContext({viewId:id,agentId:agent.kind==='history'?null:agent.id,...(agent.kind==='history'?{historyId:agent.id}:{}),projectId:project?.id || null,taskId:task?.id || null,workSessionId:task?.scope?.workSessionId || (!agent.contextIsolation&&agent.projectAssignment?.source!=='manual'?agent.scope?.workSessionId:null) || null,environment:agent.host});}
  else if(id.startsWith('task:')){const task=tasks.find(t=>t.id===id.slice(5)),project=projectWork(state).find(p=>p.id===task?.projectId);if(task)setFocusContext({viewId:id,projectId:task.projectId || null,taskId:task.id,workSessionId:task.scope?.workSessionId || null,environment:project?.host});}
  else if(id.startsWith('project:')){const project=projectWork(state).find(p=>p.id===id.slice(8));if(project)setFocusContext({viewId:id,projectId:project.id,environment:project.host});}
}
function effectiveChatScope() {
  if(chatScope!==null)return chatScope;
  if(!focusContext)return {};
  return Object.fromEntries(['projectId','taskId','workSessionId'].filter(key=>focusContext[key]).map(key=>[key,focusContext[key]]));
}
function assessment(s) { const a = state.coordinator.assessments?.[s.id]; return a?.version === s.updatedAt ? a : null; }
function row(s, history = false) {
  const a = history ? assessment(s) : null;
  const identity=sessionIdentity(s,state);
  const title = history ? s.title : identity.title;
  const sub = history ? `${s.sourceStale?'stale index':a?.status || 'unreviewed'} · ${s.provider}` : [s.provider,identity.model==='—'?'':identity.model,identity.location].filter(Boolean).join(' · ');
  return `<button class="agent${selected === s.id ? ' selected' : ''}${s.runtime ? ' runtime' : ''}${s.status==='paused' ? ' paused' : ''}${s.connectionLost||s.sourceStale||s.kind==='enrolled'||['unknown','disconnected'].includes(s.status)?' uncertain':''}${['stopped','exited'].includes(s.status)?' stopped':''}" data-id="${escape(s.id)}" aria-current="${selected===s.id?'true':'false'}" title="${escape([title,sub,s.cwd,a?.summary].filter(Boolean).join('\n'))}"><span class="label">${history ? '' : '<span class="dot" aria-hidden="true">●</span>'}${escape(title)}</span><small>${escape(sub)}</small>${history?'':`<small>${escape(identity.state+' · '+identity.access+' · '+identity.identity)}</small>${identity.checkout?`<small>${escape(identity.checkout)}</small>`:''}`}</button>`;
}
function updateMarkup(el, markup) {
  if(!el || el._markup===markup)return;
  const focused=el.contains(document.activeElement)?document.activeElement:null;
  const key=focused?.id?['id',focused.id]:focused?[...focused.attributes].find(a=>a.name.startsWith('data-'))?.name:null;
  const attr=typeof key==='string'?[key,focused.getAttribute(key)]:key;
  const selection=focused && typeof focused.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd,focused.selectionDirection]:null;
  el.innerHTML=markup;el._markup=markup;
  if(attr){const next=[...el.querySelectorAll('button,select,input,textarea,a,summary,[tabindex]')].find(n=>n.getAttribute(attr[0])===attr[1]);next?.focus({preventScroll:true});if(selection&&next?.setSelectionRange&&['text','search','url','tel','password',undefined].includes(next.type))next.setSelectionRange(...selection);}
}
function replaceMarkup(selector, markup) { updateMarkup($(selector),markup); }
function workingSession() {
  const sessions=shown().workSessions || [], active=sessions.find(s=>s.status==='active');
  if(!sessions.some(s=>s.id===workSessionId))workSessionId=active?.id || sessions.at(-1)?.id || '';
  const session=sessions.find(s=>s.id===workSessionId), busy=pendingActions.has('working-session');
  const assigned=session?state.sessions.filter(a=>!a.runtime&&a.scope?.workSessionId===session.id&&['running','external'].includes(a.status)):[];
  replaceMarkup('#working-session',`<label for="working-session-select">Working session</label>${session?`<select id="working-session-select" aria-label="Browse working sessions">${sessions.map(s=>`<option value="${escape(s.id)}"${s.id===workSessionId?' selected':''}>${escape(s.title)}${sessions.filter(other=>other.title===s.title).length>1?' · #'+escape(s.id.slice(0,5)):''} · ${escape(s.status==='wrapped'?'ended':s.status)}</option>`).join('')}</select><details id="session-controls"${sessionControlsOpen?' open':''}><summary><span class="session-state">${escape(session.status==='wrapped'?'Ended':session.status==='active'?'Active':'Paused')}${active&&active.id!==session.id?' · browsing saved session':''}</span><span>Controls</span></summary>`:'<details id="session-controls" open><summary>No working session</summary>'}<div class="session-menu"><div class="session-actions">${session&&session.status!=='wrapped'?`<button data-work-control="${session.status==='active'?'paused':'active'}"${busy?' disabled':''}>${session.status==='active'?'Pause':'Resume'}</button><button data-work-control="wrapped"${busy?' disabled':''}>End work session</button>`:''}<button data-work-control="new"${busy?' disabled':''}>${session?'New':'Start'}</button></div>${assigned.length?`<small>${assigned.length} agent${assigned.length===1?' continues':'s continue'} independently</small>`:'<small>Session controls record your work.</small>'}${active&&active.id!==session?.id?`<small>Active: ${escape(active.title)}</small>`:''}</div></details>`);
}
function sidebar() {
  if(!state)return;
  workingSession();
  const selector = $('#environment'), signature = JSON.stringify(state.hosts);
  if (selector.dataset.hosts !== signature) {
    selector.innerHTML = ['all','local',...state.hosts].map(h => `<option value="${escape(h)}">${escape(h==='all'?'All environments':hostName(h))}</option>`).join('');
    selector.dataset.hosts = signature;
    if (!['local',...state.hosts].includes(environment)) environment = 'local';
  }
  if(!['all','local',...state.hosts].includes(sessionEnvironment))sessionEnvironment='all';
  selector.value = sessionEnvironment;
  const inventory=sidebarInventory(state,sessionEnvironment,sidebarQuery),rows=liveSessionRows(sessionState(),sessionEnvironment,sidebarQuery);
  const groups=new Map();for(const entry of rows){const key=entry.project;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry.session);}
  const healthy=rows.filter(r=>!r.stale).length;
  $('#environment-status').textContent=healthy+' live sessions'+(rows.length-healthy?' · '+(rows.length-healthy)+' unverified':'');
  $('#environment-status').title='Detected sessions across the configured environments. Background services and saved output are under More.';
  replaceMarkup('#terminals',[...groups].map(([name,sessions])=>`<section class="sidebar-project"><div class="sidebar-project-heading"><span>${escape(name)}</span><small>${sessions.length}</small></div>${sessions.map(s=>row(s)).join('')}</section>`).join('') || '<div class="empty">No matching live sessions.</div>');
  const section=(key,label,items)=>items.length?`<details data-sidebar-section="${key}"${sidebarExpanded.has(key)?' open':''}><summary>${label} <span>${items.length}</span></summary>${items.map(s=>row(s)).join('')}</details>`:'';
  replaceMarkup('#other-sessions',section('services','Background services',inventory.services)+section('stopped','Stopped sessions',inventory.stopped));
  $('#session-graph-nav').classList.toggle('selected',selected==='session-graph');
  $('#sessions-nav').classList.toggle('selected',selected==='sessions');
  renderSessions();renderSessionGraph();
  const rank = { open:0, uncertain:1, unreviewed:2, completed:3, stale:4 };
  const history = inventory.history.sort((a,b) => (rank[assessment(a)?.status || 'unreviewed'] - rank[assessment(b)?.status || 'unreviewed']));
  $('#history-count').textContent = history.length;
  replaceMarkup('#history-list', history.slice(0,historyLimit).map(s => row(s,true)).join('')+(history.length>historyLimit?`<button id="more-history">Show more (${history.length-historyLimit} remaining)</button>`:'') || '<div class="empty">No saved conversations found.</div>');
  $('#conductor-nav').classList.toggle('selected', selected === 'conductor');
  $('#system-graph-nav').classList.toggle('selected', selected === 'system-graph');
  const presence=activeConductor(state);
  $('#conductor-presence').textContent=serviceFailed?'· offline':presence.working?'● working':state.coordinator.loop?.state==='running'?'· listening':'· '+(state.coordinator.loop?.state || 'unknown');
  $('#system-graph-nav').title=presence.label+(presence.detail?' · '+presence.detail:'');
  $('#conductor-presence').classList.toggle('working',!serviceFailed&&presence.working);
  $('#overview-nav').classList.toggle('selected', selected==='overview'||selected.startsWith('project:')||selected.startsWith('task:'));
  $('#teams-nav').classList.toggle('selected', selected==='teams');
  $('#team-messages-nav').hidden = !shown().teams.length && !shown().messages.length;
  $('#team-messages-nav').classList.toggle('selected', selected.startsWith('messages:'));
  $('#settings-nav').classList.toggle('selected', selected === 'settings');
  $('#docs-nav').classList.toggle('selected', selected === 'docs');
}
function sessionState(){return serviceFailed?{...state,sessions:state.sessions.map(s=>({...s,sourceStale:true}))}:state;}
function renderSessions(){const v=views.get('sessions');if(v)updateMarkup(v.element.querySelector('.sessions-content'),sessionsMarkup(sessionState(),sessionEnvironment,sidebarQuery));}
function sessionsView(){view('sessions','<div class="sessions-content"></div>');renderSessions();activate('sessions','Sessions');}
function newSessionDialog(){
  let dialog=$('#new-session-dialog');if(dialog)dialog.remove();dialog=document.createElement('dialog');dialog.id='new-session-dialog';
  dialog.innerHTML=`<form method="dialog"><h1>New terminal</h1><label>Provider<select name="provider"><option value="codex">Codex</option><option value="claude">Claude</option><option value="grok">Grok</option><option value="shell">Shell</option></select></label><label>Environment<select name="host">${['local',...state.hosts].map(h=>`<option value="${escape(h)}"${h===environment?' selected':''}>${escape(hostName(h))}</option>`).join('')}</select></label><label>Directory<input name="cwd" value="${escape(state.sessions.find(s=>s.id===selected)?.cwd || state.directories?.[environment] || (environment==='local'?state.defaultCwd:'~'))}" required></label><p>The session stays running when you close its tab or quit Super Terminal.</p><div role="status"></div><footer><button value="cancel">Cancel</button><button type="button" data-create-session>Open terminal</button></footer></form>`;
  document.body.append(dialog);const form=dialog.querySelector('form');form.elements.host.onchange=()=>{form.elements.cwd.value=state.directories?.[form.elements.host.value] || (form.elements.host.value==='local'?state.defaultCwd:'~');};
  dialog.querySelector('[data-create-session]').onclick=async e=>{e.target.disabled=true;try{const session=await api('/sessions',{provider:form.elements.provider.value,host:form.elements.host.value,cwd:form.elements.cwd.value});await refresh();dialog.close();dialog.remove();await open(session.id);}catch(error){dialog.querySelector('[role=status]').textContent=error.message;e.target.disabled=false;}};
  dialog.showModal();
}
function applyTextSize(){
  const size=state.preferences.fontSize+'px';if(document.documentElement.style.getPropertyValue('--text-size')===size)return;
  document.documentElement.style.setProperty('--text-size',size);
  for(const v of views.values())v.follow?.activate();
}
function view(id, markup) {
  if (!views.has(id)) {
    const element = document.createElement('section'); element.className = 'view'; element.dataset.view=id;element.id=panelId(id);element.setAttribute('role','tabpanel');element.setAttribute('aria-labelledby',tabId(id));element.tabIndex=0; element.innerHTML = markup; element.hidden = true; $('#view-cache').append(element); views.set(id,{ element });
  }
  return views.get(id);
}
function attachOutputFollow(v) {
  if(v.follow)return;
  v.follow=new OutputFollow(v.element.querySelector('.output'),{key:'output-pin:'+workspaceKey+':'+v.element.dataset.view,onChange:f=>paintFollow(v.element,f)});
  paintFollow(v.element,v.follow);
}
function activate(id, title) {
  const v=views.get(id);if(v)v.title=title;
  if(restoring)return;
  const fromDrawer=document.body.classList.contains('navigation-open');setNavigation(false);layout.open(id);selected=id;renderWorkspace();focusPane(layout.activePane);if(fromDrawer)v?.element.focus();
}
function workView(id) {
  const v=view(id,'<div class="work-content"></div>');v.work=true;
  const projects=projectWork(state), project=projects.find(p=>p.id===id.slice(8)), task=projects.flatMap(p=>p.tasks).find(t=>t.id===id.slice(5));
  activate(id,id.startsWith('runtime:')?'Runtime · '+(state.sessions.find(s=>s.id===id.slice(8))?.role||state.sessions.find(s=>s.id===id.slice(8))?.title||'Agent'):id==='overview'?'All projects':id==='teams'?'Teams':project?.name || task?.title || 'Work');renderWorkView(id,v);
}
function renderWorkView(id,v) {
  const viewState={...shown(),environment,runtimeCheck:runtimeChecks.get(environment),pendingActions,actionProblems};const projects=projectWork(viewState);if(id.startsWith('project:'))v.title=projects.find(p=>p.id===id.slice(8))?.name || v.title;if(id.startsWith('task:'))v.title=projects.flatMap(p=>p.tasks).find(t=>t.id===id.slice(5))?.title || v.title;
  const markup=id.startsWith('runtime:')?runtimeMarkup(viewState,id.slice(8),{...v.runtime,controlling:pendingActions.has('agent:'+id.slice(8)),controlError:actionProblems.get('agent:'+id.slice(8))}):id==='overview'?overviewMarkup(viewState,workFilter,v.filters):id==='teams'?teamsMarkup(viewState,v.filters):id.startsWith('project:')?projectMarkup(viewState,id.slice(8),v.filters):taskMarkup(viewState,id.slice(5));
  const content=v.element.querySelector('.work-content'),expanded=new Set([...content.querySelectorAll('details[data-work-section][open]')].map(el=>el.dataset.workSection));
  updateMarkup(content,markup);
  for(const details of content.querySelectorAll('details[data-work-section]'))details.open=expanded.has(details.dataset.workSection);
}
function renderRuntimeViews(){for(const [id,v] of views)if(v.work&&(id==='teams'||id.startsWith('runtime:')))renderWorkView(id,v);}
async function inspectRuntimeBrowser(id,url){
  const v=views.get('runtime:'+id);if(!v)return;v.runtime||={};if(v.runtime.busy)return;
  Object.assign(v.runtime,{busy:true,error:null});renderWorkView('runtime:'+id,v);
  try{
    if(url){const page=await api('/browser/'+encodeURIComponent(id),{action:'open',url});v.runtime.browserTitle=page.title;v.runtime.url=page.url;}
    const result=await api('/browser/'+encodeURIComponent(id),{action:'screenshot'});v.runtime.image=result.image;v.runtime.browserTitle ||= result.url;
  }catch(error){v.runtime.error=error.message;}
  finally{v.runtime.busy=false;renderWorkView('runtime:'+id,v);}
}
async function exportRuntime(id){
  const v=views.get('runtime:'+id);if(!v)return;v.runtime||={};if(v.runtime.exporting)return;v.runtime.exporting=true;v.runtime.error=null;v.runtime.notice=null;renderWorkView('runtime:'+id,v);
  try{const response=await fetch('/api/sessions/'+encodeURIComponent(id)+'/changes',{headers:{'X-Super-Terminal':token},signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error((await response.json()).error);const patch=await response.text();
    if(!patch){v.runtime.notice='No saved changes from the captured source.';return;}
    if(window.superTerminalDesktop?.saveRuntimePatch){const result=await window.superTerminalDesktop.saveRuntimePatch(id,patch);v.runtime.notice=result.saved?'Patch saved. Review it before applying it to your project.':'Export canceled. Saved work remains in the runtime.';return;}
    const url=URL.createObjectURL(new Blob([patch],{type:'text/plain'})),link=document.createElement('a');link.href=url;link.download='agent-'+id+'.patch';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);v.runtime.notice='Patch prepared for download. The runtime and original checkout were preserved.';
  }catch(error){v.runtime.error=error.message;}
  finally{v.runtime.exporting=false;renderWorkView('runtime:'+id,v);}
}
document.addEventListener('input',e=>{if(e.target.matches('[data-runtime-url]')){const v=views.get(e.target.closest('[data-view]')?.dataset.view);if(v){v.runtime||={};v.runtime.url=e.target.value;}}});
document.addEventListener('submit',e=>{const form=e.target.closest('[data-runtime-browser]');if(form){e.preventDefault();inspectRuntimeBrowser(form.dataset.runtimeBrowser,form.elements.url.value);}});
function docs() {
  const v=view('docs','<div class="caption"><span class="path">Docs · guide and live system status</span><button data-open-conductor>Open Conductor</button></div><div class="docs-content"><section class="docs-status" aria-label="Live background status"></section><nav class="docs-topics" aria-label="Guide topics"></nav><article class="docs-guide"></article></div>');
  activate('docs','Docs');renderDocs();return v;
}
function sessionGraphView(){const v=view('session-graph','');v.sessionGraph ||= new SessionGraphView(v.element,{open:async id=>{layout.openBeside('session-graph',id,$('#workspace').clientWidth>=1000?'row':'column');await open(id);}});activate('session-graph','Agent graph');renderSessionGraph();}
function renderSessionGraph(){if(state)views.get('session-graph')?.sessionGraph?.update(sessionState(),sessionEnvironment,sidebarQuery,selected);}
function graphView() {
  const v=view('system-graph','');
  v.graph ||= new SystemGraphView(v.element,{open,api,refresh});
  activate('system-graph','System graph');renderGraph();
}
function renderGraph() {if(state)views.get('system-graph')?.graph?.update(state,environment,lastStateAt,{offline:serviceFailed});}
function renderDocs() {
  const v=views.get('docs');if(!v||!state)return;
  const status=v.element.querySelector('.docs-status'),expanded=new Set([...status.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent));
  updateMarkup(status,backgroundStatusMarkup(state,lastStateAt));
  for(const details of status.querySelectorAll('details'))details.open=expanded.has(details.querySelector('summary')?.textContent);
  updateMarkup(v.element.querySelector('.docs-topics'),helpSections.map(section=>`<button data-doc-section="${section.id}" aria-current="${section.id===docsSection?'page':'false'}">${escape(section.title)}</button>`).join(''));
  const section=helpSections.find(section=>section.id===docsSection) || helpSections[0];
  updateMarkup(v.element.querySelector('.docs-guide'),markdownText(section.markdown,escape));
}
function scopeCaption() {
  const scope=effectiveChatScope();
  const session=shown().workSessions?.find(s=>s.id===scope.workSessionId), projects=projectWork(shown()), project=projects.find(p=>p.id===scope.projectId), task=projects.flatMap(p=>p.tasks).find(t=>t.id===scope.taskId);
  const text=[session?.title,project?.name,task?.title,scope.group].filter(Boolean).join(' / ');
  return text?text:focusContext?.agentId&&chatScope===null?'Current agent · project unresolved':'Every project in this environment';
}
function askConductor(scope={},draft='') {
  if(scope.workSessionId){workSessionId=scope.workSessionId;localStorage.setItem('workingSessionSelection',workSessionId);}
  chatScope=Object.keys(scope).length?scope:null;chat();
  if(draft&&!$('#chat-input').value){$('#chat-input').value=draft;$('#chat-input').dispatchEvent(new Event('input'));}
  $('#chat-input').focus();
}
function actionSummary(result,success) {
  const rows=Array.isArray(result?.results)?result.results:[];
  const failed=rows.filter(r=>r.ok===false||['failed','unsupported','unknown'].includes(r.status));
  if(result?.ok===false||result?.partial||failed.length)return `Partially completed. ${result.error || result.message || rows.map(r=>`${r.target || r.id || 'Agent'}: ${r.status || (r.ok===false?'failed':'completed')}${r.error?' — '+r.error:''}`).join('; ') || 'Check the current process state before retrying.'}`;
  return result?.note || result?.message || result?.result || success;
}
async function performAction(key,fn,success) {
  if(pendingActions.has(key))return;
  pendingActions.add(key);sidebar();renderChat();refreshTerminalHeaders();renderRuntimeViews();
  try{const result=await fn();const summary=actionSummary(result,success);if(result?.partial||result?.ok===false)actionProblems.set(key,summary);else actionProblems.delete(key);notice(summary);await refresh();return result;}
  catch(e){actionProblems.set(key,e.message);notice(e.message);}
  finally{pendingActions.delete(key);sidebar();renderChat();refreshTerminalHeaders();renderRuntimeViews();}
}
function conductorLoop() {
  const loop=state.coordinator.loop || {state:'stopped'};
  const busy=pendingActions.has('coordinator-loop');
  const next=loop.state==='running'?(state.coordinator.running?'Working':loop.nextRoundAt?'Next check '+new Date(loop.nextRoundAt).toLocaleTimeString():'Waiting for active work'):loop.state;
  return `<div class="loop-heading"><span>Background coordination · <strong>${escape(next)}</strong></span><div>${loop.state!=='running'?`<button data-loop-control="running"${busy?' disabled':''}>${loop.state==='paused'?'Resume background':'Start background'}</button>`:`<button data-loop-control="paused"${busy?' disabled':''}>Pause background</button>`}${loop.state!=='stopped'?`<button data-loop-control="stopped"${busy?' disabled':''}>Stop background</button>`:''}</div></div>${loop.lastError?`<div class="work-hint" role="status">${escape(loop.lastError)}</div>`:''}`;
}
function conductorSettingsSession() { return workSessionId || effectiveChatScope().workSessionId || ''; }
function renderConductorSettings() {
  const v=views.get('conductor');if(!v)return;
  const sessionId=conductorSettingsSession(),session=state.workSessions?.find(s=>s.id===sessionId);
  const saved={model:'',reasoningEffort:'',access:'full',skills:true,...(session?session.conductorSettings:state.coordinator.settings)};
  if(v.settingsSessionId!==sessionId){v.settingsDraft=null;v.settingsSessionId=sessionId;}
  const projectId=''; // Owner chat uses the global runtime regardless of focus.
  if(v.catalogProjectId!==projectId){
    v.catalogProjectId=projectId;v.catalog=null;
    api('/coordinator/catalog'+(projectId?'?projectId='+encodeURIComponent(projectId):'')).then(catalog=>{if(v.catalogProjectId===projectId){v.catalog=catalog;renderConductorSettings();}}).catch(e=>{if(v.catalogProjectId===projectId){v.catalog={error:e.message,skills:[]};renderConductorSettings();}});
  }
  const container=$('#conductor-runtime'),expanded=$('#conductor-settings')?.open;
  const markup=conductorSettingsMarkup(v.settingsDraft || saved,v.catalog,session?.title || 'chat without a working session',pendingActions.has('conductor-settings'),saved);
  if(!v.settingsDraft || !container.firstElementChild){updateMarkup(container,markup);if(expanded)$('#conductor-settings').open=true;}
  else{container._markup=null;const template=document.createElement('template');template.innerHTML=markup;updateMarkup(container.querySelector('summary'),template.content.querySelector('summary').innerHTML);}
  updateConductorDirtyState(saved);
  updateMarkup($('#conductor-skills'),conductorSkillMarkup(saved,v.catalog));
}
function updateConductorDirtyState(saved) {
  const v=views.get('conductor');if(!v)return;
  if(!saved){const session=state.workSessions?.find(s=>s.id===conductorSettingsSession());saved={model:'',reasoningEffort:'',access:'full',skills:true,...(session?session.conductorSettings:state.coordinator.settings)};}
  const dirty=!!v.settingsDraft&&JSON.stringify(v.settingsDraft)!==JSON.stringify(saved);
  if($('#conductor-settings-dirty'))$('#conductor-settings-dirty').textContent=dirty?'· unsaved changes':'';
  if($('#save-conductor-settings'))$('#save-conductor-settings').disabled=!dirty||pendingActions.has('conductor-settings');
}
async function saveConductorSettings() {
  const v=views.get('conductor'),sessionId=conductorSettingsSession();
  const settings=Object.fromEntries([...document.querySelectorAll('[data-conductor-setting]')].map(el=>[el.dataset.conductorSetting,el.type==='checkbox'?el.checked:el.value.trim()]));
  const result=await performAction('conductor-settings',()=>api('/coordinator/settings',{workSessionId:sessionId,settings,environment},'PATCH'),'Conductor settings saved for the next message.');
  if(result && v.settingsSessionId===sessionId && JSON.stringify(v.settingsDraft)===JSON.stringify(settings))v.settingsDraft=null;
  renderConductorSettings();
}
function chat() {
  const v = view('conductor', '<div class="caption"><span id="chat-scope" class="chat-context">Conductor · all projects</span><button id="clear-chat-scope" hidden>Clear focus</button><button data-open-system-graph>System graph</button><button id="review-next">Review more history</button></div><div id="conductor-runtime"></div><div id="conductor-loop"></div><div id="chat-output" class="output conversation-output" role="log" aria-label="Conductor conversation"></div>'+outputControls()+'<div id="chat-progress" role="status"></div><div id="chat-error" role="alert" hidden></div><form id="chat-form"><span>›</span><textarea id="chat-input" rows="1" maxlength="6000" aria-label="Message Conductor" placeholder="Describe work or invoke a skill with $name…"></textarea><button type="submit" id="send-chat">Send</button><button type="button" id="stop-chat" hidden>Stop reply</button></form><div id="conductor-skills" class="conductor-skill-picker"></div>');
  if (!v.initialized) {
    v.initialized = true;attachOutputFollow(v);
    $('#chat-form').onsubmit = e => { e.preventDefault(); const input = $('#chat-input'); const prompt = input.value.trim(); if (prompt && !state.coordinator.running && !v.submitting) sendChat(prompt); };
    $('#chat-input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); } };
    $('#chat-input').oninput = e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(180,e.target.scrollHeight)+'px';localStorage.setItem('chat-draft:'+workspaceKey,e.target.value); };
    $('#chat-input').value=localStorage.getItem('chat-draft:'+workspaceKey) || '';$('#chat-input').dispatchEvent(new Event('input'));
    $('#review-next').onclick = () => sendChat('Review the next unreviewed conversations. Update what is still open, finished, or uncertain, and ask me about the most important uncertainty.');
    $('#stop-chat').onclick = () => api('/coordinator/cancel',{}).catch(e => notice(e.message));
    $('#clear-chat-scope').onclick=()=>{setFocusContext({viewId:'conductor'});chatScope={};renderChat();};
  }
  activate('conductor','Conductor'); renderChat(); $('#chat-input').focus();
}
function renderChat() {
  if (!state || !$('#chat-output')) return;
  const status = state.coordinator, output = $('#chat-output');
  const hasFocus=Object.keys(effectiveChatScope()).length || focusContext?.agentId;
  $('#chat-scope').textContent='Conductor · '+hostName(environment)+(hasFocus?' · focus: '+scopeCaption():'');$('#chat-scope').title='This conversation belongs to '+hostName(environment)+'. It can coordinate every project here. Focus identifies what you are looking at; it does not lock Conductor to that project.';$('#clear-chat-scope').hidden=!hasFocus;
  replaceMarkup('#conductor-loop',conductorLoop());
  renderConductorSettings();
  const signature = JSON.stringify([status.history,status.trace,status.events]);
  if (output.dataset.signature !== signature) {
    const v=views.get('conductor'),anchor=v.follow.beforeUpdate();
    const records=status.history.map((turn,index)=>({id:turn.id || 'turn:'+index,source:turn.answer,html:conductorTurnMarkup(turn)}));
    if(!records.length)records.push({id:'empty',html:'<div class="chat-empty"><strong>What would you like to work on?</strong><p>Ask a question, edit files, or coordinate your agents. You can start here without setting up a work session.</p></div>'});
    reconcileOutput(output,records);
    output.dataset.signature=signature;v.follow.afterUpdate(anchor,{newOutput:true});
  }
  const v=views.get('conductor'),busy=status.running||v.submitting;
  const progress=activeConductor(state);
  $('#chat-progress').textContent = busy ? [status.phase || 'Conductor is working…',progress.detail].filter(Boolean).join(' · ') : '';
  $('#send-chat').disabled = !!busy; $('#review-next').disabled = !!busy; $('#stop-chat').hidden = !status.running;
  const error=$('#chat-error');error.hidden=!v.sendError;
  updateMarkup(error,v.sendError?`<span>${escape(v.sendError)} Your message is kept below. Check the conversation before sending it again.</span>${v.failedPrompt?`<details><summary>Unconfirmed message</summary><pre>${escape(v.failedPrompt)}</pre><button type="button" data-restore-draft>Restore message</button></details>`:''}<button type="button" data-dismiss-chat-error aria-label="Dismiss message error">Dismiss</button>`:'');
}
async function sendChat(prompt, automatic = false) {
  const v=views.get('conductor');
  if (state.coordinator.running || v?.submitting) return;
  if(v){v.submitting=true;v.sendError=null;v.failedPrompt=null;}
  const input=$('#chat-input');
  if(!automatic && input?.value.trim()===prompt){input.value='';input.dispatchEvent(new Event('input'));}
  state.coordinator.running = true; renderChat();
  try {
    const scopeAtSend=JSON.stringify([effectiveChatScope(),focusSignature,environment,workingSelectionRevision]);
    const scope=effectiveChatScope();
    if(scope.workSessionId && !shown().workSessions.some(session=>session.id===scope.workSessionId)) delete scope.workSessionId;
    const settingsSessionId=shown().workSessions.some(session=>session.id===conductorSettingsSession())?conductorSettingsSession():'';
    const request = api('/coordinator',{ prompt, automatic, environment, ...scope, settingsSessionId, focus:focusContext });
    setTimeout(() => refresh(), 500);
    const reply=await request; state.coordinator.running=false;await refresh();
    if(reply.nextScope&&!automatic&&scopeAtSend===JSON.stringify([effectiveChatScope(),focusSignature,environment,workingSelectionRevision])){chatScope=reply.nextScope;if(reply.nextScope.workSessionId){workSessionId=reply.nextScope.workSessionId;localStorage.setItem('workingSessionSelection',workSessionId);}sidebar();renderChat();}
  } catch (e) {
    if(v){v.sendError='Message could not be confirmed: '+e.message;if(!automatic){if(!input.value){input.value=prompt;input.dispatchEvent(new Event('input'));}else v.failedPrompt=prompt;}}
    else notice(e.message);
    state.coordinator.running=false;
  } finally {if(v)v.submitting=false;renderChat();}
}

function agentHeader(s,terminal){
  return `<header class="agent-header"><div class="caption terminal-caption"><span class="path terminal-identity"></span>${terminal?'<span class="connection">Connecting…</span><button class="reconnect" hidden>Reconnect</button>':`<span>${s.runtime?'Background service':s.kind==='enrolled'?'Local MCP agent':s.kind==='history'?'Saved conversation':'External · read only'}</span>`}</div><div class="agent-context"></div><details class="agent-controls"><summary>Controls</summary><div class="process-controls"></div><div class="agent-assignment"></div></details></header>`;
}
function connectTerminal(s) {
  const v = view(s.id, `${agentHeader(s,true)}<div class="terminal"></div>${outputControls()}`);
  activate(s.id, agentTitle(s,state));
  v.agentId=s.id;renderTerminalHeader(v,s);
  if (!v.term) {
    v.term = new Terminal({ cursorBlink: true, fontFamily:'Menlo, Monaco, monospace', fontSize:state.preferences.fontSize, lineHeight:1.15, scrollback:100000, theme:terminalTheme, allowProposedApi:false });
    v.fit = new FitAddon(); v.term.loadAddon(v.fit); v.term.open(v.element.querySelector('.terminal'));
    v.follow=new TerminalFollow(v.term,{key:'output-pin:'+workspaceKey+':'+s.id,onChange:f=>paintFollow(v.element,f)});paintFollow(v.element,v.follow);
    v.resize = () => { if (v.element.hidden) return; try { v.follow.resizing=true;v.fit.fit(); if (v.ws?.readyState === 1) v.ws.send(JSON.stringify({type:'resize',cols:v.term.cols,rows:v.term.rows})); } catch {} finally{v.follow.resizing=false;v.follow.activate();} };
    v.observer=new ResizeObserver(v.resize);v.observer.observe(v.element.querySelector('.terminal'));
    v.term.onData(data => { if (v.ws?.readyState === 1) v.ws.send(JSON.stringify({type:'input',data})); });
    v.connect = () => {
      if (v.ws && v.ws.readyState < 2) return;
      const status = v.element.querySelector('.connection'), retry = v.element.querySelector('.reconnect');
      status.textContent = 'Connecting…'; retry.hidden = true;v.terminalReady=false;
      v.term.reset();
      v.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/terminal?token=${encodeURIComponent(token)}&id=${encodeURIComponent(s.id)}`);
      v.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'output') v.follow.write(m.data); if (m.type === 'ready') { status.textContent = '';v.terminalReady=true;v.resize(); } if (m.type === 'error') { status.textContent = m.message;v.terminalReady=false; } if (m.type === 'exit') {status.textContent = 'Detached';v.terminalReady=false;} };
      v.ws.onclose = () => { if (!status.textContent) status.textContent = 'Disconnected'; retry.hidden = false;v.terminalReady=false; };
    };
    v.element.querySelector('.reconnect').onclick = v.connect; v.connect();
  }
  renderTerminalHeader(v,s);installAgentTools(v,s);
  requestAnimationFrame(() => { if(selected===s.id&&!restoring){v.resize();focusComposer(s.id);} });
}
function renderTerminalHeader(v,s) {
  const label=v.element.querySelector('.terminal-identity');if(!label)return;
  const identity=sessionIdentity(s,state);label.textContent=identity.title+' · '+identity.location;label.title=[agentTitle(s,state),agentContext(s,state),s.cwd].filter(Boolean).join('\n');
  const project=projectForAgent(s,state),task=(state.tasks || []).find(t=>t.projectId===project?.id&&(t.id===s.taskId||t.id===s.scope?.goalId||t.agentId===s.id)),session=(state.workSessions || []).find(w=>w.id===s.scope?.workSessionId);
  updateMarkup(v.element.querySelector('.agent-context'),`<span class="terminal-model" title="${escape(identity.modelHint)}">${escape(s.provider+(s.provider==='shell'?'':' · '+identity.model))}</span><span>${escape(identity.identity)}</span>${identity.checkout?`<span title="${escape(s.worktreeRoot || s.cwd)}">${escape(identity.project+' · '+identity.checkout)}</span>`:''}${project?`<button data-work-view="project:${escape(project.id)}" title="${escape(project.cwd)}">${escape(project.name)} →</button>`:'<span>Unassigned project</span>'}${task?`<button data-work-view="task:${escape(task.id)}" title="${escape(task.title)}">Task: ${escape(task.title)} →</button>`:''}<span>${escape(s.execution?.kind==='container'?'Isolated Linux · '+processLabel(s):s.kind==='history'?'Saved output':processLabel(s))}</span>${s.execution?.kind==='container'?`<button data-work-view="runtime:${escape(s.id)}">Runtime & browser →</button>`:''}${session?`<span title="Human working session; agent process state is separate">Work session: ${escape(session.title)} · ${escape(session.status==='wrapped'?'ended':session.status)}</span>`:s.kind==='managed'?'<span>Work session: unassigned</span>':''}`);
  const busy=pendingActions.has('agent:'+s.id), control=canControl(s);
  updateMarkup(v.element.querySelector('.process-controls'),`<span class="process-context" title="${escape(agentContext(s,state)+'\n'+s.cwd)}">${escape(agentContext(s,state,false))}</span><span class="process-state">${escape(processLabel(s))}</span>${control?`<button data-agent-control="${s.status==='paused'?'running':'paused'}" data-agent-target="${escape(s.id)}"${busy?' disabled':''}>${s.status==='paused'?'Resume process':'Pause process'}</button><button data-agent-control="stopped" data-agent-target="${escape(s.id)}"${busy?' disabled':''}>Stop process</button>`:`<span class="muted">${s.runtime?'Service controls protected':s.connectionLost?'Reconnect before controlling this agent':'Process controls unavailable'}</span>`}${s.kind==='managed'&&!s.execution&&s.host!=='local'&&!s.enrollmentRevokedAt&&(s.connectionLost||['stopped','disconnected','unknown'].includes(s.status))?`<button data-reconnect-agent="${escape(s.id)}"${busy?' disabled':''}>Reconnect remote</button>`:''}${actionProblems.has('agent:'+s.id)?`<span class="process-problem" role="status">${escape(actionProblems.get('agent:'+s.id))}</span>`:''}`);
  if(v.term)v.term.options.disableStdin=!agentCapabilities(s).terminalInput||['unknown','disconnected'].includes(s.status)||!!s.sourceStale;
}
function refreshTerminalHeaders(){if(!state)return;for(const v of views.values())if(v.agentId){const s=[...state.sessions,...state.history].find(s=>s.id===v.agentId);if(s){renderTerminalHeader(v,s);renderAgentTools(v,s);}}}
function installAgentTools(v,s) {
  v.agentId=s.id;
  renderAgentTools(v,s);
}
function renderAgentTools(v,s) {
  const capabilities=agentCapabilities(s),project=projectForAgent(s,state),current=project?.id || '',selectedProject=v.projectDraft ?? current;
  const busy=pendingActions.has('agent:'+s.id),assignment=s.projectAssignment || {},source=assignment.source==='manual'?'Manual':assignment.source==='assigned'?'Assigned':project?'Detected':'Unclassified';
  const assignmentMarkup=capabilities.assignProject?`<label>Project <select class="agent-project-select" aria-label="Agent project">${projectOptions(state,selectedProject,s.host)}</select></label><button class="move-agent-project"${busy||v.projectDraft===undefined||selectedProject===current&&assignment.source==='manual'?' disabled':''}>Move</button><small title="${escape(assignment.reason || '')}">${source}${assignment.stale?' · stale evidence':''}${s.contextIsolation==='restart-required'?' · fresh agent required':''}</small>`:`<span class="muted">${project?'Project: '+escape(project.name):'Project unclassified'}${s.kind==='history'?' · saved history':' · background service'}</span>`;
  const assignmentEl=v.element.querySelector('.agent-assignment');updateMarkup(assignmentEl,assignmentMarkup);
  if(capabilities.assignProject){
    const select=assignmentEl.querySelector('select');select.value=selectedProject;select.disabled=busy;
    select.onchange=()=>{v.projectDraft=select.value;renderAgentTools(v,s);};
    assignmentEl.querySelector('button').onclick=()=>moveAgentProject(v);
  }
  let actions=v.element.querySelector('.session-continuation');if(!actions){actions=document.createElement('div');actions.className='session-continuation';v.element.querySelector('.agent-controls').append(actions);}
  const ended=s.kind==='history'||['stopped','exited'].includes(s.status);
  updateMarkup(actions,(ended&&capabilities.continuationHistoryId?'<button class="continue-agent">Continue in a terminal</button>':'')+(s.contextIsolation==='restart-required'&&project?'<span class="muted">This terminal retains its previous model context.</span><button class="fresh-agent">Start fresh in project</button>':''));
  const fresh=actions.querySelector('.fresh-agent');if(fresh)fresh.onclick=()=>continueAgent(v,true);
  const continuation=actions.querySelector('.continue-agent');if(continuation)continuation.onclick=()=>continueAgent(v,false);

}
async function moveAgentProject(v) {
  const agent=[...state.sessions,...state.history].find(s=>s.id===v.agentId);if(!agent||v.projectDraft===undefined)return;
  const chosen=v.projectDraft;
  const result=await performAction('agent:'+agent.id,()=>api('/sessions/'+encodeURIComponent(agent.id)+'/project',{projectId:chosen || null},'PATCH'),'Project assignment updated. The running directory is unchanged.');
  if(result&&result.ok!==false&&!result.partial){v.projectDraft=undefined;const updated=state.sessions.find(s=>s.id===agent.id);if(updated){renderAgentTools(v,updated);if(selected===agent.id)rememberFocus(agent.id);}}
}
async function continueAgent(v,fresh) {
  const s=[...state.sessions,...state.history].find(s=>s.id===v.agentId);if(!s)return;
  const capabilities=agentCapabilities(s),project=projectForAgent(s,state),text='';
  if(fresh&&!project || !fresh&&!capabilities.continuationHistoryId)return;
  const body=fresh?{provider:s.provider,projectId:project.id,cwd:project.cwd,host:project.host,task:text}:{historyId:capabilities.continuationHistoryId,host:s.host,task:text};
  const result=await performAction('agent:'+s.id,()=>api('/sessions',body),fresh?'Fresh managed agent created in this project.':'Managed continuation requested. The original external terminal stays separate.');
  if(result?.id&&result.ok!==false&&!result.partial)connectTerminal(result);
}
async function showConversation(s, external = false) {
  const v = view(s.id, `${agentHeader(s,false)}<div class="history-pagination"><button class="load-earlier" hidden>Load earlier output</button><span class="history-coverage"></span></div><div class="output conversation-output"></div>${outputControls()}`);
  attachOutputFollow(v);activate(s.id, `${s.provider} — ${hostName(s.host)}`);
  v.source = s;renderTerminalHeader(v,s);
  v.element.querySelector('.load-earlier').onclick=()=>updateConversation(v,external,true);
  installAgentTools(v,s);
  focusComposer(s.id);await updateConversation(v,external);
}
async function updateConversation(v,external = v.source.kind === 'external', earlier=false) {
  const s = v.source, output = v.element.querySelector('.output');
  if (s.kind==='enrolled') {
    output.textContent=`${processLabel(s)}\nLast contact: ${s.lastContactAt || 'No contact yet'}\n\nThis agent reports through local MCP. Its original terminal and process remain independent. Messages wait for its next checkpoint. Reports and verification claims appear in the project tasks.`;
    return;
  }
  const historyId = external ? s.historyId : s.id;
  if (!historyId) {
    const linked = state.history.filter(h => s.linkedHistory?.includes(h.id));
    const candidates = linked.length ? linked : state.history.filter(h => h.host === s.host && h.provider === s.provider && h.cwd === s.cwd).slice(0,5);
    output.innerHTML = `<div class="line muted">${escape(s.provider)} · ${escape(processLabel(s))}${s.pid ? ' · PID '+s.pid : ''}${s.tty ? ' · '+escape(s.tty) : ''}.\n\nThis terminal was started outside Super Terminal and is not in tmux. Its input and live screen remain in the original terminal. No saved conversation could be matched to this process with certainty.</div>${candidates.length ? `<div class="line muted">${linked.length ? 'Conversations opened by this runtime:' : 'Saved conversations in the same folder (not confirmed as this process):'}</div>`+candidates.map(c => `<button class="agent" data-id="${escape(c.id)}">${escape(c.title)}</button>`).join('') : ''}`; return;
  }
  if (v.loading) return; v.loading = true;
  v.element.querySelector('.load-earlier').disabled=true;
  try {
    const gap=earlier?v.historyGaps?.[0]:null;
    const transcript = await api('/history/'+encodeURIComponent(historyId)+(earlier?'?cursor='+encodeURIComponent(gap?.cursor ?? v.nextCursor):''));
    const incoming=transcript.events || transcript.messages;
    const anchor=v.follow.beforeUpdate({earlier});
    v.historyEvents=mergeOutput(v.historyEvents || [],incoming,earlier);
    if(!v.historyLoaded||(earlier&&!gap))v.nextCursor=transcript.nextCursor;
    if(gap){if(transcript.coverage?.from<=gap.reached||transcript.nextCursor==null)v.historyGaps.shift();else gap.cursor=transcript.nextCursor;}
    if(!earlier&&v.coverageTo&&transcript.coverage?.from>v.coverageTo){v.historyGaps ||= [];v.historyGaps.push({cursor:transcript.coverage.from,reached:v.coverageTo});}
    if(!earlier)v.coverageTo=transcript.coverage?.to;
    v.historyLoaded=true;
    const earlierButton=v.element.querySelector('.load-earlier');earlierButton.hidden=v.nextCursor==null&&!v.historyGaps?.length;earlierButton.disabled=false;earlierButton.textContent=v.historyGaps?.length?'Load missing output':'Load earlier output';
    v.element.querySelector('.history-coverage').textContent=v.historyGaps?.length?'More output arrived than one page. Load the gap to continue.':v.nextCursor==null?(transcript.coverage?'All available pages loaded':'Available provider output'):'Earlier output available';
    const signature = JSON.stringify(v.historyEvents);
    if (v.signature !== signature) {
      const note=external&&s.historyMatch==='start-time'?'Matched by process start time and folder. '+transcript.note:transcript.note;
      reconcileOutput(output,[...(note?[{id:'coverage-note',html:`<div class="line muted">${escape(note)}</div>`}]:[]),...conversationRecords(v.historyEvents,s.provider,v.historyGroups ||= new Map())]);
      v.signature=signature;v.follow.afterUpdate(anchor,{newOutput:!earlier});
    }else if(earlier)v.follow.afterUpdate(anchor);
  } catch(e) { if(v.historyEvents?.length)v.element.querySelector('.history-coverage').textContent='Output unavailable: '+e.message;else output.textContent=e.message; } finally { v.loading = false;v.element.querySelector('.load-earlier').disabled=false; }
}
function messageTeam(group){const teams=shown()?.teams || [];return teams.find(t=>t.id===group) || (teams.filter(t=>t.name===group).length===1?teams.find(t=>t.name===group):null);}
async function messages(group = '') {
  const id='messages:'+group,team=messageTeam(group);
  const v=view(id,`<header class="messages-header"><div class="caption"><span class="path">Team conversations</span></div><div class="message-filters"><select class="message-team" aria-label="Conversation team"></select><input type="search" class="message-search" aria-label="Search messages" placeholder="Search messages…"></div><div class="message-context"></div></header><div class="output conversation-output team-output" role="log" aria-label="Team conversation"></div>${outputControls()}<form class="team-compose"><div class="team-recipient"><label>To <select name="recipient" aria-label="Message recipient"></select></label><span class="team-compose-hint"></span></div><textarea name="message" rows="2" maxlength="12000" aria-label="Message a team agent" placeholder="Write to an agent…"></textarea><div class="agent-message-actions"><button type="submit">Queue message</button><span class="compose-shortcut">⌘/Ctrl+Enter to send · Enter for a new line</span><span class="team-compose-status" role="status"></span></div></form>`);
  v.messageGroup=group;attachOutputFollow(v);activate(id,team?.name || group || 'Team conversations');
  if(!v.messageInitialized){
    v.messageInitialized=true;const form=v.element.querySelector('form'),input=form.elements.message,key='team-draft:'+workspaceKey+':'+group;v.messageDraftKey=key;
    try{const draft=JSON.parse(localStorage.getItem(key)||'{}');input.value=draft.text || '';v.recipient=draft.to || '';}catch{}
    const save=()=>localStorage.setItem(key,JSON.stringify({text:input.value,to:v.recipient || ''}));
    input.oninput=save;input.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();form.requestSubmit();}};
    form.elements.recipient.onchange=e=>{v.recipient=e.target.value;save();renderMessageComposer(v);};
    form.onsubmit=e=>{e.preventDefault();sendTeamMessage(v);};
    v.element.querySelector('.message-team').onchange=e=>messages(e.target.value);
    v.element.querySelector('.message-search').oninput=e=>{v.messageQuery=e.target.value;paintMessages(v);};
  }
  renderMessageComposer(v);focusComposer(id);await renderMessages(group);
}
function renderMessageComposer(v){
  const team=messageTeam(v.messageGroup),form=v.element.querySelector('form'),eligible=state.sessions.filter(a=>(!v.messageGroup||team&&a.teamId===team.id)&&agentCapabilities(a).mailbox);
  if(!v.recipient&&eligible.length===1)v.recipient=eligible[0].id;
  const recipient=eligible.find(a=>a.id===v.recipient);
  updateMarkup(v.element.querySelector('.message-team'),`<option value="">All team conversations</option>${shown().teams.map(t=>`<option value="${escape(t.id)}">${escape(t.name)}${t.projectId?' · '+escape(shown().projects.find(p=>p.id===t.projectId)?.name || ''):''}</option>`).join('')}${v.messageGroup&&!team?`<option value="${escape(v.messageGroup)}">${escape(v.messageGroup)} · saved group</option>`:''}`);
  v.element.querySelector('.message-team').value=team?.id || v.messageGroup;
  updateMarkup(form.elements.recipient,`<option value="">Choose an agent</option>${eligible.map(a=>`<option value="${escape(a.id)}">${escape(agentTitle(a,state))}${!team?' · '+escape(projectForAgent(a,state)?.name || hostName(a.host)):''}</option>`).join('')}`);
  form.elements.recipient.value=recipient?.id || '';form.elements.recipient.disabled=!!v.messageSending;
  form.querySelector('button[type=submit]').disabled=!!v.messageSending||!recipient;form.querySelector('button[type=submit]').textContent=v.messageSending?'Queueing…':'Queue message';
  form.querySelector('.team-compose-hint').textContent=recipient?'Queued for this agent’s next checkpoint.':eligible.length?'Choose the agent who should receive this message.':'No agent mailbox is available here. Open an agent for its other messaging options.';
  form.querySelector('.team-compose-status').textContent=v.messageStatus || '';
  updateMarkup(v.element.querySelector('.message-context'),team?`<span>${escape(team.mission || 'No team mission recorded.')}</span><button data-work-view="teams">Team members →</button>`:'<span>Messages show queued, read and acknowledged handoffs. Select a team to focus the conversation.</span>');
}
async function sendTeamMessage(v){
  const form=v.element.querySelector('form'),input=form.elements.message,text=input.value.trim(),recipient=state.sessions.find(a=>a.id===v.recipient),team=messageTeam(v.messageGroup);
  if(v.messageSending||!text||!recipient||!agentCapabilities(recipient).mailbox||v.messageGroup&&recipient.teamId!==team?.id)return;
  v.messageSending=true;v.messageStatus='';renderMessageComposer(v);
  try{const result=await api('/sessions/'+encodeURIComponent(recipient.id)+'/prompt',{text});if(result?.ok===false||result?.partial)throw new Error(actionSummary(result,'Message was not confirmed queued.'));v.messageStatus='Queued for '+agentTitle(recipient,state)+'. Read and acknowledgment appear in the conversation.';if(input.value.trim()===text){input.value='';localStorage.removeItem(v.messageDraftKey);}await renderMessages(v.messageGroup);}
  catch(error){v.messageStatus='Message was not confirmed queued: '+error.message+' Your draft is kept. Check the conversation before retrying.';}
  finally{v.messageSending=false;renderMessageComposer(v);if(selected===v.element.dataset.view)focusComposer(selected);}
}
function paintMessages(v){
  const team=messageTeam(v.messageGroup),terms=String(v.messageQuery || '').toLowerCase().split(/\s+/).filter(Boolean),name=id=>{const a=state.sessions.find(a=>a.id===id);return id==='you'?'You':['conductor','coordinator'].includes(id)?'Conductor':a?agentTitle(a,state):id?.slice(0,12) || 'Unknown';};
  const rows=(v.messageRows || []).filter(m=>(!v.messageGroup||(team?m.teamId===team.id||!m.teamId&&m.group===team.name&&state.teams.filter(t=>t.name===team.name).length===1:m.group===v.messageGroup))&&terms.every(term=>[name(m.from),name(m.to),m.text,m.group].join(' ').toLowerCase().includes(term)));
  const identity=id=>state.sessions.some(a=>a.id===id)?`<button data-id="${escape(id)}">${escape(name(id))}</button>`:`<span>${escape(name(id))}</span>`;
  const records=rows.map(m=>({id:m.id,html:`<article class="team-message${m.from==='you'?' from-you':''}"><div class="message-meta">${identity(m.from)}<span aria-hidden="true">→</span>${identity(m.to)}<time title="${escape(new Date(m.createdAt).toLocaleString())}">${escape(new Date(m.createdAt).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time></div><div class="console-markdown message-body">${markdownText(m.text || '',escape)}</div><div class="message-delivery">${escape(messageDeliveryLabel(m))}${!team&&m.group?' · '+escape(m.group):''}</div></article>`}));
  if(!records.length)records.push({id:'empty',html:`<div class="chat-empty"><strong>${terms.length?'No messages match your search.':'No messages in this conversation yet.'}</strong><p>${terms.length?'Try a sender, recipient or part of the message.':'Choose an agent below to begin. Team handoffs and replies appear here when agents use their mailboxes.'}</p></div>`});
  const output=v.element.querySelector('.output'),signature=JSON.stringify(records);
  if(v.signature!==signature){const anchor=v.follow.beforeUpdate();reconcileOutput(output,records);v.signature=signature;v.follow.afterUpdate(anchor,{newOutput:true});}
}
async function renderMessages(group) {
  const v=views.get('messages:'+group);if(!v||v.loading)return;v.loading=true;
  try{const team=messageTeam(group);v.messageRows=await api('/messages'+(group?'?group='+encodeURIComponent(team?.name || group):''));paintMessages(v);renderMessageComposer(v);}
  catch(error){v.messageStatus='Conversation unavailable: '+error.message;renderMessageComposer(v);}finally{v.loading=false;}
}
function activity() {
  view('activity','<div class="caption"><span class="path">Activity · this environment</span><button id="mark-activity-read">Mark read</button></div><div id="activity-output" class="output" role="log"></div>');
  activate('activity','Activity');
  $('#mark-activity-read').onclick=()=>{localStorage.setItem('activityReadAt',new Date().toISOString());renderActivity();};
  renderActivity();
}
function renderActivity() {
  const events=shown()?.activity || [], readAt=localStorage.getItem('activityReadAt') || '';
  const unread=events.filter(e=>e.at>readAt).length;$('#activity-count').textContent=unread?`(${unread})`:'';
  if(!$('#activity-output'))return;
  const markup=[...events].reverse().map(e=>`<button class="activity-item" data-activity-event="${escape(e.id)}"><span>${e.kind==='conductor'?'Conductor · '+escape(e.title):escape(e.provider)+' '+(e.kind==='finished'?'finished a response':'exited')+' · '+escape(hostName(e.host))}</span><small>${escape(e.kind==='conductor'?e.text:e.title)} · ${new Date(e.at).toLocaleString()}</small></button>`).join('') || '<div class="muted">Agent events and Conductor notices appear here. Conductor chooses which updates need a desktop notification.</div>';
  const explanation=views.get('activity')?.explanation;
  replaceMarkup('#activity-output',(explanation?`<p role="status" class="turn-problem">${escape(explanation)}</p>`:'')+markup);
}
async function openNotification(event){
  const target=notificationTarget(state,event);await open(target.id);
  if(target.unavailable){views.get('activity').explanation=target.message;renderActivity();$('#activity-output').querySelector(`[data-activity-event="${CSS.escape(target.eventId || '')}"]`)?.scrollIntoView({block:'center'});}
}
function settings() {
  const providers=['codex','claude','grok'],draftKey='startup-prompt-drafts:'+workspaceKey;
  const v = view('settings','<div class="settings"><h1>Settings</h1><h2>Appearance</h2><label for="font-size">Conversation and terminal text size</label><select id="font-size">'+Array.from({length:13},(_,i)=>`<option>${i+10}</option>`).join('')+'</select><h2>Conductor</h2><label><input id="automatic-briefing" type="checkbox"> Automatic first briefing</label><p>One briefing when Conductor has no conversation yet. Automatic rounds use the separate Conductor loop controls.</p><label><input id="notify-finish" type="checkbox"> Conductor notifications</label><p>Conductor chooses which updates need a desktop alert. Activity also retains response completions and process exits. macOS notification preferences control banners and sound.</p><p id="preference-status" role="status"></p><button id="test-notification">Test notification</button><p id="notification-result" role="status"></p><h2>Agent startup prompts</h2><p>Applied to new agents. Existing terminals keep their current instructions.</p>'+providers.map(p=>`<label for="prompt-${p}">${p}</label><textarea id="prompt-${p}" maxlength="12000"></textarea>`).join('')+'<button id="save-prompts">Save prompts</button><p id="saved" role="status"></p></div>');
  const q=selector=>v.element.querySelector(selector);
  activate('settings','Settings');
  if(!v.promptDrafts){try{v.promptDrafts=JSON.parse(localStorage.getItem(draftKey)||'null');}catch{}v.promptDrafts={...state.prompts,...v.promptDrafts};}
  const changed=()=>providers.some(p=>v.promptDrafts[p]!==state.prompts[p]);
  const paintDraft=()=>{q('#save-prompts').disabled=!!v.promptSaving||!changed();q('#save-prompts').textContent=v.promptSaving?'Saving…':'Save prompts';q('#saved').textContent=v.promptError || (changed()?'Unsaved changes · draft kept on this device':v.promptSaved?'Saved.':'');if(changed())localStorage.setItem(draftKey,JSON.stringify(v.promptDrafts));else localStorage.removeItem(draftKey);};
  for(const p of providers){const input=q('#prompt-'+p);input.value=v.promptDrafts[p] || '';input.oninput=()=>{v.promptDrafts[p]=input.value;v.promptError='';paintDraft();};}
  paintDraft();
  const preferences=[['#font-size','fontSize'],['#automatic-briefing','automaticBriefing'],['#notify-finish','notifyOnFinish']];
  const paintPreferences=()=>{for(const [selector,key] of preferences){const input=q(selector);if(input.type==='checkbox')input.checked=!!state.preferences[key];else input.value=state.preferences[key];input.disabled=!!v.preferenceSaving;}};
  paintPreferences();
  for(const [selector,key] of preferences)q(selector).onchange=async e=>{
    const value=e.target.type==='checkbox'?e.target.checked:Number(e.target.value);v.preferenceSaving=true;for(const [control] of preferences)q(control).disabled=true;q('#preference-status').textContent='Saving…';
    try{state.preferences=await api('/preferences',{[key]:value},'PUT');applyTextSize();for(const terminal of views.values())if(terminal.term){terminal.term.options.fontSize=state.preferences.fontSize;terminal.resize();}q('#preference-status').textContent='Saved.';}
    catch(error){q('#preference-status').textContent='Not saved: '+error.message+' The previous setting is restored.';}
    finally{v.preferenceSaving=false;paintPreferences();}
  };
  q('#test-notification').onclick=async()=>{const button=q('#test-notification');button.disabled=true;try{q('#notification-result').textContent=window.superTerminalDesktop?.testNotification?(await window.superTerminalDesktop.testNotification()).message:'Open the desktop app to receive notifications.';}catch(error){q('#notification-result').textContent=error.message;}finally{button.disabled=false;}};
  q('#save-prompts').onclick=async()=>{
    if(v.promptSaving||!changed())return;const prompts={...v.promptDrafts};v.promptSaving=true;v.promptError='';paintDraft();
    try{await api('/prompts',prompts,'PUT');state.prompts=prompts;v.promptSaved=true;}
    catch(error){v.promptError='Not saved: '+error.message+' Your draft is kept.';}
    finally{v.promptSaving=false;paintDraft();}
  };
}
async function open(id) {
  if(id==='session-graph'){sessionGraphView();return;}
  if(id==='sessions'){sessionsView();return;}
  if(id==='system-graph'){graphView();return;}
  if(id==='conductor'){chat();return;}
  if(id==='activity'){activity();return;}
  if(id==='settings'){settings();return;}
  if(id.startsWith('messages:')){await messages(id.slice(9));return;}
  if(id==='docs'){docs();return;}
  if(id==='overview'||id==='teams'||id.startsWith('project:')||id.startsWith('task:')||id.startsWith('runtime:')){workView(id);return;}
  const s = [...state.sessions,...state.history].find(s=>s.id === id); if(!s) {const v=view(id,'<div class="output muted">This view is unavailable in the current inventory. It will recover if its source reconnects. Select saved output from the sidebar or <button data-id="activity">open Activity</button>.</div>');v.pending=true;activate(id,'Unavailable');return;}
  if(s.host !== environment) {environment=s.host; localStorage.setItem('environment',environment);}
  if(['history','external','enrolled'].includes(s.kind)) await showConversation(s,s.kind !== 'history'); else connectTerminal(s);
}
async function newTerminal(provider = 'shell') {
  try {
    const current = state.sessions.find(s=>s.id === selected && s.host === environment);
    const s = await api('/sessions',{provider,host:environment,cwd:current?.cwd || (environment === 'local' ? (state.directories?.local || state.defaultCwd) : '~')});
    await refresh(); connectTerminal(s);
  } catch(e) { notice(e.message); }
}
async function refresh() {
  if(refreshing) return; refreshing=true;
  try {
    const requested=environment,nextState = await api('/state?environment='+encodeURIComponent(requested));if(requested!==environment)return;state=nextState;lastStateAt=new Date().toISOString();
    const recovered=serviceFailed;serviceFailed=false;$('#service-status').hidden=true;
    if(recovered)for(const v of views.values())if(v.connect&&v.ws?.readyState>1)v.connect();
    document.querySelectorAll('[data-requires-state]').forEach(el=>el.disabled=false);
    sidebar();
    if(!workspaceReady)await restoreWorkspace();
    rememberFocus(selected);
    renderChat();applyTextSize();
    renderDocs();renderGraph();
    refreshTerminalHeaders();
    for(const [id,v] of views)if(v.work)renderWorkView(id,v);
    for(const tab of document.querySelectorAll('[data-tab]')){const label=tabLabel(tab.dataset.tab);tab.querySelector('.tab-label').textContent=label;tab.title=label;}
    for(const close of document.querySelectorAll('[data-close]'))close.title='Close '+tabLabel(close.dataset.close)+' view; agent processes keep running';
    document.title=tabLabel(selected)+' — Super Terminal';
    for(const [id,v] of views)if(v.pending&&[...state.sessions,...state.history].some(s=>s.id===id)){v.element.remove();views.delete(id);const before=restoring,hostBefore=environment;restoring=true;await open(id);restoring=before;environment=hostBefore;localStorage.setItem('environment',environment);renderWorkspace();sidebar();}
    for(const v of views.values())if(v.term&&v.term.options.fontSize!==state.preferences.fontSize){v.term.options.fontSize=state.preferences.fontSize;v.resize();}
    for(const pane of layout.panes()){const active=views.get(pane.active);if(pane.active?.startsWith('messages:'))renderMessages(pane.active.slice(9));if(active?.source){active.source=state.sessions.find(s=>s.id===pane.active)||active.source;updateConversation(active);}}
    renderActivity();
    if(selected==='conductor' && !bootBriefing && state.preferences.automaticBriefing && !state.coordinator.history.length && state.remote.every(r=>r.scannedAt || r.error) && !state.coordinator.running) {
      bootBriefing=true; sendChat('Read recent saved agent conversations in this environment. Tell me what still looks open, what appears finished, and ask what I want to focus on. Do not assume old work is still a priority.',true);
    }
  } catch(e) { serviceFailed=true;$('#service-status').hidden=false;$('#service-status span').textContent='Connection unavailable: '+e.message;if(!state)$('#environment-status').textContent='Reconnecting…';else{sidebar();renderGraph();} } finally { refreshing=false; }
}
$('#retry-service').onclick=()=>refresh();
$('#environment').onchange = e => {
  sessionEnvironment=e.target.value;localStorage.setItem('sessionEnvironment',sessionEnvironment);
  if(sessionEnvironment!=='all'){environment=sessionEnvironment;localStorage.setItem('environment',environment);}
  for(const v of views.values())if(v.work)renderWorkView(v.element.dataset.view,v);
  sidebar();renderChat();renderActivity();refresh();
};
$('#sidebar-search').addEventListener('input',e=>{sidebarQuery=e.target.value;historyLimit=40;sidebar();});
for(const container of [$('#terminals'),$('#other-sessions')])container.addEventListener('toggle',e=>{const key=e.target.dataset.sidebarSection;if(key){if(e.target.open)sidebarExpanded.add(key);else sidebarExpanded.delete(key);}},true);
$('#working-session').addEventListener('toggle',e=>{if(e.target.id==='session-controls')sessionControlsOpen=e.target.open;},true);
$('#history-list').addEventListener('click',e=>{if(e.target.closest('#more-history')){historyLimit+=40;sidebar();}});
$('#graph-home').onclick=sessionGraphView;$('#session-graph-nav').onclick=sessionGraphView;$('#sessions-nav').onclick=sessionsView;$('#sessions-home').onclick=sessionsView;
$('#system-graph-nav').onclick=graphView;$('#conductor-nav').onclick=chat; $('#team-messages-nav').onclick=()=>messages(''); $('#settings-nav').onclick=settings;$('#docs-nav').onclick=docs;
document.addEventListener('click',e=>{if(!e.target.closest('#working-session')&&$('#session-controls')?.open){$('#session-controls').open=false;sessionControlsOpen=false;}if(e.target.closest('[data-session-new]'))newSessionDialog();const button=e.target.closest('[data-id]'); if(button) open(button.dataset.id); const team=e.target.closest('[data-team]'); if(team) messages(team.dataset.team);});
document.addEventListener('click',e=>{
  const link=e.target.closest('.console-markdown a[href]');
  if(!link || !window.superTerminalDesktop?.openLink)return;
  e.preventDefault();
  if(e.isTrusted)window.superTerminalDesktop.openLink(link.href).then(ok=>{if(!ok)notice('This link cannot be opened.');}).catch(error=>notice(error.message));
});
document.addEventListener('click',async e=>{
  if(e.target.closest('[data-runtime-create]'))askConductor({},'Create an isolated Linux team for this project. Give each agent a private checkout and browser, and enable one level of managed helpers within a four-agent and twelve-launch allowance. The task is: ');
  const teamControl=e.target.closest('[data-team-runtime]');if(teamControl)await performAction('runtime-team:'+teamControl.dataset.teamRuntime,()=>api('/teams/'+encodeURIComponent(teamControl.dataset.teamRuntime)+'/runtime/control',{state:teamControl.dataset.runtimeState}),'Team runtime updated.');
  const configure=e.target.closest('[data-runtime-configure]');if(configure){const team=state.teams.find(t=>t.id===configure.dataset.runtimeConfigure);if(team)askConductor({projectId:team.projectId,group:team.name},`Review the runtime and helper allowance for team "${team.name}". I want to `);}
  if(e.target.closest('[data-runtime-check]')){try{runtimeChecks.set(environment,await api('/runtime/capability?host='+encodeURIComponent(environment)));}catch(error){runtimeChecks.set(environment,{available:false,error:error.message});}renderRuntimeViews();}
  if(e.target.closest('[data-runtime-prepare]'))await performAction('runtime-image:'+environment,()=>api('/runtime/prepare',{host:environment}),'Runtime preparation started.');
  const screenshot=e.target.closest('[data-runtime-screenshot]');if(screenshot)await inspectRuntimeBrowser(screenshot.dataset.runtimeScreenshot);
  const exported=e.target.closest('[data-runtime-export]');if(exported)await exportRuntime(exported.dataset.runtimeExport);
  const eventLink=e.target.closest('[data-activity-event]');if(eventLink){await openNotification(state.activity.find(event=>event.id===eventLink.dataset.activityEvent) || {target:'missing'});return;}
  const section=e.target.closest('[data-view]'),v=section&&views.get(section.dataset.view);
  if(e.target.closest('.output')&&!e.target.closest('button,a,input,textarea,select,summary')&&window.getSelection()?.isCollapsed)focusComposer(section.dataset.view);
  if(e.target.closest('.output summary')&&!v?.follow?.pinned)v?.follow?.pauseReading();
  if(e.target.closest('[data-scroll-latest]'))v?.follow?.latest();
  if(e.target.closest('[data-scroll-pin]'))v?.follow?.pin(!v.follow.pinned);
  if(e.target.closest('[data-dismiss-chat-error]')){v.sendError=null;renderChat();}
  if(e.target.closest('[data-restore-draft]')){const input=$('#chat-input');input.value+=(input.value?'\n\n':'')+v.failedPrompt;v.failedPrompt=null;input.dispatchEvent(new Event('input'));renderChat();input.focus();}
  const button=e.target.closest('[data-copy-message],[data-copy-code]');
  if(button){
    const source=button.hasAttribute('data-copy-code')?button.closest('.console-code').querySelector('code').textContent:button.closest('[data-output-id]')?._outputSource;
    try{await navigator.clipboard.writeText(source || '');button.textContent='Copied';setTimeout(()=>{if(button.isConnected)button.textContent='Copy';},1600);}catch{notice('Clipboard unavailable. Select the text and copy it.');}
  }
});
document.addEventListener('toggle',e=>{if(e.target.matches('details')){const section=e.target.closest('[data-view]');if(section)views.get(section.dataset.view)?.follow?.activate();}},true);
document.addEventListener('change',e=>{
  if(e.target.id==='working-session-select'){workingSelectionRevision++;workSessionId=e.target.value;localStorage.setItem('workingSessionSelection',workSessionId);workingSession();renderChat();}
  if(e.target.id==='conductor-skill' && e.target.value!==''){
    const skill=views.get('conductor')?.catalog?.skills?.[Number(e.target.value)];
    if(skill){const input=$('#chat-input');input.value+=(input.value?'\n':'')+`Use $${skill.name} (${skill.path}). `;input.dispatchEvent(new Event('input'));input.focus();}e.target.value='';
  }
  if(e.target.matches('[data-work-filter]')){workFilter=e.target.value;const v=views.get('overview');if(v)renderWorkView('overview',v);}
});
function updateWorkFilter(target,key){const section=target.closest('[data-view]'),v=views.get(section?.dataset.view);if(!v)return;v.filters={...v.filters,[key]:target.value};renderWorkView(section.dataset.view,v);}
document.addEventListener('change',e=>{if(e.target.matches('[data-work-host]'))updateWorkFilter(e.target,'host');if(e.target.matches('[data-task-status]'))updateWorkFilter(e.target,'status');});
document.addEventListener('input',e=>{
  if(e.target.matches('[data-work-search]'))updateWorkFilter(e.target,'query');
  if(!e.target.matches('[data-conductor-setting]'))return;
  views.get('conductor').settingsDraft=Object.fromEntries([...document.querySelectorAll('[data-conductor-setting]')].map(el=>[el.dataset.conductorSetting,el.type==='checkbox'?el.checked:el.value]));
  updateConductorDirtyState();
});
document.addEventListener('click',async e=>{
  if(e.target.id==='save-conductor-settings')await saveConductorSettings();
  const work=e.target.closest('[data-work-view]');if(work)workView(work.dataset.workView);
  const topic=e.target.closest('[data-doc-section]');if(topic){docsSection=topic.dataset.docSection;renderDocs();views.get('docs')?.element.querySelector('.docs-guide').scrollIntoView({block:'start'});}
  if(e.target.closest('[data-open-conductor]'))chat();
  if(e.target.closest('[data-open-system-graph]'))graphView();
  const ask=e.target.closest('[data-ask-scope]');if(ask){const scope=JSON.parse(ask.dataset.askScope);askConductor(scope,ask.textContent.includes('Create a team')?'Create a team to ':ask.textContent.includes('Configure in Conductor')?'Configure the runtime and helper allowance for this team. I want to ':'');}
  const session=e.target.closest('[data-work-control]');if(session){const action=session.dataset.workControl;const result=await performAction('working-session',()=>action==='new'?api('/work-sessions',{title:'Working session '+((shown().workSessions || []).length+1),topics:'',host:environment}):api('/work-sessions/'+encodeURIComponent(workSessionId),{status:action},'PATCH'),action==='wrapped'?'Work session ended. Agent processes continue independently.':action==='paused'?'Working session paused. Agent processes continue independently.':action==='new'?'Working session started. Describe your work in Conductor.':'Working session resumed.');if(action==='new'&&result?.id){workSessionId=result.id;localStorage.setItem('workingSessionSelection',workSessionId);sidebar();askConductor({workSessionId});}}
  const loop=e.target.closest('[data-loop-control]');if(loop)await performAction('coordinator-loop',()=>api('/coordinator/control',{state:loop.dataset.loopControl,environment}),'Background coordination '+loop.dataset.loopControl+'.');
  const reconnect=e.target.closest('[data-reconnect-agent]');if(reconnect){await performAction('agent:'+reconnect.dataset.reconnectAgent,()=>api('/sessions/'+encodeURIComponent(reconnect.dataset.reconnectAgent)+'/reconnect',{}),'Remote reconnection requested.');}
  const control=e.target.closest('[data-agent-control]');if(control)await performAction('agent:'+control.dataset.agentTarget,()=>api('/sessions/'+encodeURIComponent(control.dataset.agentTarget)+'/control',{state:control.dataset.agentControl}),'Agent process '+control.dataset.agentControl+'.');
});
document.addEventListener('keydown',e=>{
  const square=e.target.closest('[data-task-square]');if(!square)return;
  const squares=[...square.closest('.task-squares').querySelectorAll('[data-task-square]')], index=squares.indexOf(square);
  const target=e.key==='Home'?squares[0]:e.key==='End'?squares.at(-1):['ArrowRight','ArrowDown'].includes(e.key)?squares[index+1]:['ArrowLeft','ArrowUp'].includes(e.key)?squares[index-1]:null;
  if(target){e.preventDefault();target.focus();}
});
window.superTerminalDesktop?.onAction(action=>{
  if(action?.type==='backend-reconnected'){serviceFailed=true;renewToken().then(refresh).catch(e=>notice(e.message));return;}
  if(!state){notice('Connecting to the local service…');return;}
  if(action==='session-graph')sessionGraphView();
  if(action==='sessions')sessionsView();
  if(action==='conductor' || action==='coordinator') chat();
  if(action==='settings') settings();
  if(action==='docs')docs();
  if(action==='new-terminal') newTerminal();
  if(action==='split-right')splitPanel('row');
  if(action==='split-below')splitPanel('column');
  if(action==='close-tab')closeTab(selected);
  if(action==='new-window')openWindow();
  if(action==='activity')activity();
  if(action==='next-panel'){const panes=layout.panes();focusPane(panes[(panes.findIndex(p=>p.id===layout.activePane)+1)%panes.length].id);views.get(selected)?.term?.focus();}
  if(typeof action==='object'&&action.type==='show-agent'){if(action.host){environment=action.host;sidebar();}refresh().then(()=>open(action.id));return;}
  if(typeof action==='object'&&action.type==='show-notification'){refresh().then(()=>openNotification(action.event));return;}
  if(typeof action==='string'&&action.startsWith('new-agent:')) newTerminal(action.split(':')[1]);
  if(action==='environment') $('#environment').focus();
});
for(const event of ['pointerdown','focusin'])document.addEventListener(event,e=>{const pane=e.target.closest('[data-pane]');if(pane&&pane.dataset.pane!==layout.activePane){focusPane(pane.dataset.pane);if(event==='pointerdown'&&!e.target.closest('button,input,textarea,select,a,summary,.terminal,.output'))requestAnimationFrame(()=>focusComposer(selected));}});
document.addEventListener('keydown',e=>{
  if(document.body.classList.contains('navigation-open')){
    if(e.key==='Escape'){e.preventDefault();setNavigation(false,true);return;}
    if(e.key==='Tab'){const nodes=[...$('#sidebar').querySelectorAll('button,select,input,summary,a,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  }
  const tab=e.target.closest('[data-tab]');if(!tab)return;
  const tabs=layout.panes().find(p=>p.tabs.includes(tab.dataset.tab)).tabs,index=tabs.indexOf(tab.dataset.tab);
  const target=e.key==='Home'?tabs[0]:e.key==='End'?tabs.at(-1):e.key==='ArrowRight'?tabs[(index+1)%tabs.length]:e.key==='ArrowLeft'?tabs[(index+tabs.length-1)%tabs.length]:null;
  if(target){e.preventDefault();selectTab(target);}else if(e.key==='Delete'){e.preventDefault();closeTab(tab.dataset.tab);}
});
document.addEventListener('click',e=>{const split=e.target.closest('[data-layout]');if(split)splitPanel(split.dataset.layout);const close=e.target.closest('[data-close]'),tab=e.target.closest('[data-tab]');if(close)closeTab(close.dataset.close);else if(tab)selectTab(tab.dataset.tab,true);const empty=e.target.closest('[data-close-panel]');if(empty){layout.removeEmpty(empty.dataset.closePanel);renderWorkspace();focusPane(layout.activePane);}const add=e.target.closest('[data-add-tab]');if(add){focusPane(add.dataset.addTab);newSessionDialog();}});
$('#new-window').onclick=openWindow;$('#notifications-nav').onclick=activity;
async function restoreWorkspace(){
  workspaceReady=true;
  const savedTabs=layout.panes().flatMap(p=>p.tabs),savedEnvironment=environment;restoring=true;
  for(const id of savedTabs){if(id==='conductor')chat();else if(id==='settings')settings();else if(id==='activity')activity();else if(id.startsWith('messages:'))await messages(id.slice(9));else await open(id);}
  restoring=false;environment=savedEnvironment;localStorage.setItem('environment',environment);renderWorkspace();focusPane(layout.activePane);
  if(initial.get('view')){const id=initial.get('view');if(id==='conductor')chat();else if(id==='settings')settings();else if(id==='activity')activity();else if(id.startsWith('messages:'))messages(id.slice(9));else await open(id);}
  if(!initial.get('view')&&(!savedTabs.length||!localStorage.getItem('graphHomeEnabled'))){sessionGraphView();localStorage.setItem('graphHomeEnabled','1');}
  if(initial.get('notification'))await openNotification(state.activity.find(e=>e.id===initial.get('notification')) || {target:'missing'});
}
installDividers();renderWorkspace();
document.querySelectorAll('[data-requires-state]').forEach(el=>el.disabled=true);
await refresh();
setInterval(refresh,5000);
