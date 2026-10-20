import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import './style.css';
import { Workspace } from './workspace.mjs';

const $ = s => document.querySelector(s);
const token = $('meta[name="super-terminal-token"]').content;
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, environment = localStorage.getItem('environment') || 'local', selected = 'conductor', refreshing = false, bootBriefing = false;
const views = new Map();
const initial = new URLSearchParams(location.hash.slice(1));
const workspaceKey = 'workspace:'+(initial.get('window') || 'main');
const layout = new Workspace(localStorage.getItem(workspaceKey));
if(initial.get('environment')) environment=initial.get('environment');
let restoring=false, workspaceReady=false;
const terminalTheme={background:'#101214',foreground:'#d8dfda',cursor:'#96d9a9',cursorAccent:'#101214',selectionBackground:'#345143',black:'#171b1e',red:'#e78989',green:'#96d9a9',yellow:'#dfc68f',blue:'#90b5e3',magenta:'#c6a0d8',cyan:'#87c9c2',white:'#d8dfda',brightBlack:'#818b85',brightRed:'#f2a0a0',brightGreen:'#b0ecc0',brightYellow:'#f0d9a4',brightBlue:'#b0cef4',brightMagenta:'#dfb7ee',brightCyan:'#abe1da',brightWhite:'#f3f7f4'};
function saveWorkspace(){localStorage.setItem(workspaceKey,layout.serialize());}
function tabLabel(id){const s=[...(state?.sessions||[]),...(state?.history||[])].find(s=>s.id===id);return id==='conductor'?'Conductor':id==='settings'?'Settings':id==='activity'?'Activity':id.startsWith('messages:')?id.slice(9)||'Team messages':s?.role || s?.title || views.get(id)?.title || 'Terminal';}
function focusPane(paneId){const pane=layout.focus(paneId);selected=pane.active || '';for(const el of document.querySelectorAll('.pane'))el.classList.toggle('focused',el.dataset.pane===paneId);document.title=(tabLabel(selected)||'Super Terminal')+' — Super Terminal';if(state)sidebar();saveWorkspace();}
function renderWorkspace(){
  const cache=$('#view-cache');for(const v of views.values()){v.element.hidden=true;cache.append(v.element);}
  const draw=node=>node.axis?`<div class="split ${node.axis}" data-split="${node.id}" style="--ratio:${node.ratio}">${draw(node.first)}<div class="divider" role="separator" tabindex="0" aria-label="Resize panels" aria-orientation="${node.axis==='row'?'vertical':'horizontal'}" aria-valuemin="15" aria-valuemax="85" aria-valuenow="${Math.round(node.ratio*100)}" data-divider="${node.id}"></div>${draw(node.second)}</div>`:`<section class="pane${node.id===layout.activePane?' focused':''}" data-pane="${node.id}"><div class="tab-bar" role="tablist" aria-label="Panel tabs">${node.tabs.map(id=>`<div class="tab${node.active===id?' active':''}"><button role="tab" aria-selected="${node.active===id}" data-tab="${escape(id)}" title="${escape(tabLabel(id))}">${escape(tabLabel(id))}</button><button class="close-tab" data-close="${escape(id)}" aria-label="Close ${escape(tabLabel(id))} tab">×</button></div>`).join('')}<button class="add-tab" data-add-tab="${node.id}" aria-label="New terminal tab">＋</button></div><div class="pane-content"><div class="panel-empty">Select an agent in the sidebar.<br><button data-close-panel="${node.id}">Close panel</button></div></div></section>`;
  $('#workspace').innerHTML=draw(layout.root);
  for(const pane of layout.panes()){
    const content=document.querySelector(`[data-pane="${pane.id}"] .pane-content`);const active=views.get(pane.active);
    if(active){content.replaceChildren(active.element);active.element.hidden=false;}
  }
  for(const v of views.values())if(!v.element.hidden)v.resize?.();
  saveWorkspace();
}
async function splitPanel(axis){try{layout.split(axis);renderWorkspace();const opened=new Set(layout.panes().flatMap(p=>p.tabs));const next=state.sessions.find(s=>s.host===environment&&!s.runtime&&!opened.has(s.id)&&['running','external','paused'].includes(s.status));if(next)await open(next.id);else focusPane(layout.activePane);}catch(e){notice(e.message);}}
function closeTab(id){const v=views.get(id);v?.ws?.close();v?.observer?.disconnect();v?.term?.dispose();v?.element.remove();views.delete(id);layout.close(id);renderWorkspace();focusPane(layout.activePane);}
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

async function api(url, body, method = 'POST') {
  const response = await fetch('/api' + url, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type':'application/json', 'X-Super-Terminal':token }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Connection failed'); return data;
}
let noticeTimer;
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 7000); }
function hostName(host) { return host === 'local' ? 'Local' : state?.hostNames[host] || host; }
function assessment(s) { const a = state.coordinator.assessments[s.id]; return a?.version === s.updatedAt ? a : null; }
function row(s, history = false) {
  const a = history ? assessment(s) : null;
  const linkedTitle = state.history.find(h=>h.id===s.historyId)?.title;
  const name = s.role || linkedTitle || (s.kind === 'managed' ? String(s.title || '').replace(new RegExp('^'+s.provider+' · '),'') : '') || s.cwd?.split('/').filter(Boolean).at(-1) || (s.tty && !['?','??'].includes(s.tty) ? s.tty : 'PID '+s.pid);
  const title = history ? s.title : `${s.provider === 'shell' ? 'terminal' : s.provider}${s.runtime ? ' service' : ''} · ${name}`;
  const sub = history ? `${a?.status || 'unreviewed'} · ${s.provider}` : `${s.connectionLost ? 'SSH ended · local shell' : s.status === 'paused' ? 'paused' : s.runtime ? 'background runtime' : s.kind === 'external' ? 'external' : 'terminal'}${s.runtime ? ' · PID '+s.pid : s.tty ? ' · '+s.tty.replace('/dev/','') : ''}${state.teams.some(t=>t.name===s.group) ? ' · '+s.group : ''}`;
  return `<button class="agent${selected === s.id ? ' selected' : ''}${s.runtime ? ' runtime' : ''}${s.status==='paused' ? ' paused' : ''}" data-id="${escape(s.id)}" title="${escape(a?.summary || [s.title,s.cwd].filter(Boolean).join('\n'))}"><span class="label">${history ? '' : '<span class="dot">●</span>'}${escape(title)}</span><small>${escape(sub)}</small></button>`;
}
function replaceMarkup(selector, markup) { const el=$(selector); if(el._markup !== markup) { el.innerHTML=markup; el._markup=markup; } }
function sidebar() {
  if(!state)return;
  const selector = $('#environment'), signature = JSON.stringify(state.hosts);
  if (selector.dataset.hosts !== signature) {
    selector.innerHTML = ['local',...state.hosts].map(h => `<option value="${escape(h)}">${escape(hostName(h))}</option>`).join('');
    selector.dataset.hosts = signature;
    if (!['local',...state.hosts].includes(environment)) environment = 'local';
  }
  selector.value = environment;
  const live = state.sessions.filter(s => s.host === environment && ['running','external','paused'].includes(s.status)).sort((a,b)=>Number(!!a.runtime)-Number(!!b.runtime));
  const remote = state.remote.find(r => r.host === environment);
  $('#environment-status').textContent = remote?.error ? 'SSH unavailable · retrying' : remote?.scanning && !remote.scannedAt ? 'Connecting…' : `${live.filter(s=>!s.runtime&&s.status!=='paused').length} running${live.some(s=>s.status==='paused') ? ' · '+live.filter(s=>s.status==='paused').length+' paused' : ''}${live.some(s=>s.runtime) ? ' · '+live.filter(s=>s.runtime).length+' services' : ''}`;
  $('#environment-status').title = remote?.error || (remote?.scannedAt ? `Last checked ${new Date(remote.scannedAt).toLocaleTimeString()}` : '');
  replaceMarkup('#terminals', live.map(s => row(s)).join('') || '<div class="empty">No running terminals here.</div>');
  const rank = { open:0, uncertain:1, unreviewed:2, completed:3, stale:4 };
  const history = state.history.filter(s => s.host === environment).sort((a,b) => (rank[assessment(a)?.status || 'unreviewed'] - rank[assessment(b)?.status || 'unreviewed']));
  $('#history-count').textContent = history.length;
  replaceMarkup('#history-list', history.map(s => row(s,true)).join('') || '<div class="empty">No saved conversations found.</div>');
  $('#conductor-nav').classList.toggle('selected', selected === 'conductor');
  $('#team-messages-nav').hidden = !state.teams.length && !state.messages.length;
  $('#team-messages-nav').classList.toggle('selected', selected.startsWith('messages:'));
  $('#settings-nav').classList.toggle('selected', selected === 'settings');
}
function view(id, markup) {
  if (!views.has(id)) {
    const element = document.createElement('section'); element.className = 'view'; element.innerHTML = markup; element.hidden = true; $('#view-cache').append(element); views.set(id,{ element });
  }
  return views.get(id);
}
function activate(id, title) {
  const v=views.get(id);if(v)v.title=title;
  if(restoring)return;
  layout.open(id);selected=id;renderWorkspace();focusPane(layout.activePane);
}
function chat() {
  const v = view('conductor', '<div class="caption"><span class="path">Conductor · all environments</span><button id="review-next">Review more history</button></div><div id="chat-output" class="output" role="log" aria-live="polite"></div><div id="chat-progress"></div><form id="chat-form"><span>›</span><textarea id="chat-input" rows="1" maxlength="6000" aria-label="Message Conductor" placeholder="Ask Conductor…"></textarea><button type="submit" id="send-chat">Send</button><button type="button" id="stop-chat" hidden>Stop</button></form>');
  if (!v.initialized) {
    v.initialized = true;
    $('#chat-form').onsubmit = e => { e.preventDefault(); const input = $('#chat-input'); const prompt = input.value.trim(); if (prompt) { input.value = ''; input.style.height = ''; sendChat(prompt); } };
    $('#chat-input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); } };
    $('#chat-input').oninput = e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(180,e.target.scrollHeight)+'px'; };
    $('#review-next').onclick = () => sendChat('Review the next unreviewed conversations. Update what is still open, finished, or uncertain, and ask me about the most important uncertainty.');
    $('#stop-chat').onclick = () => api('/coordinator/cancel',{}).catch(e => notice(e.message));
  }
  activate('conductor','Conductor'); renderChat(); $('#chat-input').focus();
}
function renderChat() {
  if (!state || !$('#chat-output')) return;
  const status = state.coordinator, output = $('#chat-output');
  const signature = JSON.stringify(status.history);
  if (output.dataset.signature !== signature) {
    const nearBottom = output.scrollHeight-output.scrollTop-output.clientHeight < 100;
    output.innerHTML = status.history.map(t => `${t.automatic ? '' : `<div class="line"><span class="speaker user">you</span>${escape(t.prompt)}</div>`}${t.answer ? `<div class="line"><span class="speaker assistant">${t.status === 'error' ? 'error' : 'conductor'}</span>${escape(t.answer)}</div>` : ''}`).join('') || '<div class="muted">I can read your saved agent conversations, keep track of open work, and help you pick up where you left off.</div>';
    output.dataset.signature = signature; if (nearBottom) output.scrollTop = output.scrollHeight;
  }
  const reviewed = state.history.filter(s => assessment(s)).length;
  $('#chat-progress').textContent = status.running ? 'Reading history and preparing a reply…' : `${reviewed} / ${state.history.length} reviewed`;
  $('#chat-progress').title = 'History assessments are cached. Further reviews run only when you ask.';
  $('#send-chat').disabled = status.running; $('#review-next').disabled = status.running; $('#stop-chat').hidden = !status.running;
}
async function sendChat(prompt, automatic = false) {
  if (state.coordinator.running) return;
  state.coordinator.running = true; renderChat();
  try {
    const request = api('/coordinator',{ prompt, automatic, environment });
    setTimeout(() => refresh(), 500);
    await request; await refresh();
  } catch (e) { notice(e.message); state.coordinator.running = false; renderChat(); }
}
function connectTerminal(s) {
  const v = view(s.id, `<div class="caption"><span class="path">${escape(s.connectionLost ? 'SSH ended · local recovery shell' : s.cwd+' · '+hostName(s.host))}</span><span class="connection">Connecting…</span><button class="reconnect" hidden>Reconnect</button></div><div class="terminal"></div>`);
  activate(s.id, `${s.provider} — ${hostName(s.host)}`);
  if (!v.term) {
    v.term = new Terminal({ cursorBlink: true, fontFamily:'Menlo, Monaco, monospace', fontSize:state.preferences.fontSize, lineHeight:1.15, scrollback:10000, theme:terminalTheme, allowProposedApi:false });
    v.fit = new FitAddon(); v.term.loadAddon(v.fit); v.term.open(v.element.querySelector('.terminal'));
    v.resize = () => { if (v.element.hidden) return; try { v.fit.fit(); if (v.ws?.readyState === 1) v.ws.send(JSON.stringify({type:'resize',cols:v.term.cols,rows:v.term.rows})); } catch {} };
    v.observer=new ResizeObserver(v.resize);v.observer.observe(v.element.querySelector('.terminal'));
    v.term.onData(data => { if (v.ws?.readyState === 1) v.ws.send(JSON.stringify({type:'input',data})); });
    v.connect = () => {
      if (v.ws && v.ws.readyState < 2) return;
      const status = v.element.querySelector('.connection'), retry = v.element.querySelector('.reconnect');
      status.textContent = 'Connecting…'; retry.hidden = true;
      v.term.reset();
      v.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/terminal?token=${encodeURIComponent(token)}&id=${encodeURIComponent(s.id)}`);
      v.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'output') v.term.write(m.data); if (m.type === 'ready') { status.textContent = ''; v.resize(); } if (m.type === 'error') { status.textContent = m.message; } if (m.type === 'exit') status.textContent = 'Detached'; };
      v.ws.onclose = () => { if (!status.textContent) status.textContent = 'Disconnected'; retry.hidden = false; };
    };
    v.element.querySelector('.reconnect').onclick = v.connect; v.connect();
  }
  requestAnimationFrame(() => { v.resize(); v.term.focus(); });
}
async function showConversation(s, external = false) {
  const v = view(s.id, `<div class="caption"><span class="path">${escape(s.cwd)} · ${escape(hostName(s.host))}</span>${external ? '<span>External terminal · read only</span>' : '<button class="resume">Resume</button>'}</div><div class="output"></div>`);
  activate(s.id, `${s.provider} — ${hostName(s.host)}`);
  v.source = s;
  if (!external) v.element.querySelector('.resume').onclick = async () => {
    try { const launched = await api('/sessions',{historyId:s.id,host:s.host}); await refresh(); connectTerminal(launched); } catch(e) { notice(e.message); }
  };
  await updateConversation(v,external);
}
async function updateConversation(v,external = v.source.kind === 'external') {
  const s = v.source, output = v.element.querySelector('.output');
  const historyId = external ? s.historyId : s.id;
  if (!historyId) {
    const linked = state.history.filter(h => s.linkedHistory?.includes(h.id));
    const candidates = linked.length ? linked : state.history.filter(h => h.host === s.host && h.provider === s.provider && h.cwd === s.cwd).slice(0,5);
    output.innerHTML = `<div class="line muted">${escape(s.provider)}${s.runtime ? ' background runtime' : ''} is running${s.pid ? ' · PID '+s.pid : ''}${s.tty ? ' · '+escape(s.tty) : ''}.\n\nThis terminal was started outside Super Terminal and is not in tmux. Its input and live screen remain in the original terminal. No saved conversation could be matched to this process with certainty.</div>${candidates.length ? `<div class="line muted">${linked.length ? 'Conversations opened by this runtime:' : 'Saved conversations in the same folder (not confirmed as this process):'}</div>`+candidates.map(c => `<button class="agent" data-id="${escape(c.id)}">${escape(c.title)}</button>`).join('') : ''}`; return;
  }
  if (v.loading) return; v.loading = true;
  try {
    const transcript = await api('/history/'+encodeURIComponent(historyId));
    const signature = JSON.stringify(transcript.messages);
    if (v.signature !== signature) {
      const bottom = output.scrollHeight-output.scrollTop-output.clientHeight < 100;
      output.innerHTML = `<div class="line muted">${escape(external && s.historyMatch === 'start-time' ? 'Matched by process start time and folder. '+transcript.note : transcript.note)}</div>`+transcript.messages.map(m => `<div class="line"><span class="speaker ${m.role === 'user' ? 'user' : 'assistant'}">${escape(m.role === 'user' ? 'you' : s.provider)}</span>${escape(m.text)}</div>`).join('');
      v.signature = signature; if(bottom) output.scrollTop = output.scrollHeight;
    }
  } catch(e) { output.textContent = e.message; } finally { v.loading = false; }
}
async function messages(group = '') {
  const id = 'messages:'+group;
  const v = view(id, `<div class="caption"><span class="path">${escape(group || 'Team messages')}</span></div><div class="output"></div>`);
  activate(id,group || 'Team messages'); await renderMessages(group);
}
async function renderMessages(group) {
  const v=views.get('messages:'+group); if(!v || v.loading) return; v.loading=true;
  try {
    const rows=await api('/messages'+(group?'?group='+encodeURIComponent(group):''));
    const name=id=>id==='you'?'you':id==='conductor'||id==='coordinator'?'conductor':state.sessions.find(s=>s.id===id)?.title || id.slice(0,12);
    const output=v.element.querySelector('.output'), bottom=output.scrollHeight-output.scrollTop-output.clientHeight<100;
    const markup=(group?'':state.teams.map(t=>`<button class="agent" data-team="${escape(t.name)}">${escape(t.name)} →</button>`).join(''))+rows.map(m=>`<div class="line"><span class="speaker">${escape(name(m.from))} → ${escape(name(m.to))} · ${escape(m.group)} · ${new Date(m.createdAt).toLocaleTimeString()}${m.read?'':' · queued'}</span>${escape(m.text)}</div>`).join('')+(rows.length?'':'<div class="muted">No team messages yet. Agents share updates through their mailboxes; this thread shows each handoff as it arrives.</div>');
    if(v.markup!==markup){output.innerHTML=markup;v.markup=markup;if(bottom)output.scrollTop=output.scrollHeight;}
  } catch(e){notice(e.message);} finally{v.loading=false;}
}
function activity() {
  view('activity','<div class="caption"><span class="path">Activity · all environments</span><button id="mark-activity-read">Mark read</button></div><div id="activity-output" class="output" role="log"></div>');
  activate('activity','Activity');
  $('#mark-activity-read').onclick=()=>{localStorage.setItem('activityReadAt',new Date().toISOString());renderActivity();};
  renderActivity();
}
function renderActivity() {
  const events=state?.activity || [], readAt=localStorage.getItem('activityReadAt') || '';
  const unread=events.filter(e=>e.at>readAt).length;$('#activity-count').textContent=unread?`(${unread})`:'';
  if(!$('#activity-output'))return;
  const markup=[...events].reverse().map(e=>`<button class="activity-item" data-id="${escape(e.target)}"><span>${escape(e.provider)} ${e.kind==='finished'?'finished a response':'exited'} · ${escape(hostName(e.host))}</span><small>${escape(e.title)} · ${new Date(e.at).toLocaleString()}</small></button>`).join('') || '<div class="muted">New agent completions appear here while Super Terminal is running. Old conversations do not generate alerts.</div>';
  replaceMarkup('#activity-output',markup);
}
function settings() {
  const v = view('settings','<div class="settings"><h1>Settings</h1><label for="font-size">Terminal text size</label><select id="font-size">'+Array.from({length:13},(_,i)=>`<option>${i+10}</option>`).join('')+'</select><label><input id="automatic-briefing" type="checkbox"> Automatic first briefing</label><p>One briefing when Conductor has no conversation yet. Further reviews run only when you ask.</p><label><input id="notify-finish" type="checkbox"> Notify when an agent finishes</label><p>Desktop alerts and an Activity log. Click an alert to open the agent. macOS notification preferences control banners and sound.</p><button id="test-notification">Test notification</button><h1 style="margin-top:30px">Agent startup prompts</h1><p>Applied to new agents. Existing terminals keep their current instructions.</p>'+['codex','claude','grok'].map(p=>`<label for="prompt-${p}">${p}</label><textarea id="prompt-${p}" maxlength="12000"></textarea>`).join('')+'<button id="save-prompts">Save prompts</button><p id="saved" role="status"></p></div>');
  activate('settings','Settings');
  $('#font-size').value = state.preferences.fontSize;
  $('#automatic-briefing').checked = state.preferences.automaticBriefing;
  $('#notify-finish').checked=state.preferences.notifyOnFinish;
  $('#notify-finish').onchange=e=>api('/preferences',{notifyOnFinish:e.target.checked},'PUT').then(p=>state.preferences=p).catch(e=>notice(e.message));
  $('#test-notification').onclick=()=>window.superTerminalDesktop?.testNotification ? window.superTerminalDesktop.testNotification().then(ok=>notice(ok?'Notification sent. macOS controls whether banners and sound appear.':'Desktop notifications are unavailable.')) : notice('Open the desktop app to receive notifications.');
  for(const p of ['codex','claude','grok']) $('#prompt-'+p).value = state.prompts[p];
  $('#font-size').onchange = async e => { try { state.preferences = await api('/preferences',{fontSize:Number(e.target.value)},'PUT');document.documentElement.style.setProperty('--text-size',state.preferences.fontSize+'px'); for(const v of views.values()) if(v.term) {v.term.options.fontSize=state.preferences.fontSize; v.resize();} } catch(e) {notice(e.message);} };
  $('#automatic-briefing').onchange = e => api('/preferences',{automaticBriefing:e.target.checked},'PUT').then(p=>{state.preferences=p;}).catch(e=>notice(e.message));
  $('#save-prompts').onclick = async () => { try { const prompts=Object.fromEntries(['codex','claude','grok'].map(p=>[p,$('#prompt-'+p).value])); await api('/prompts',prompts,'PUT'); state.prompts=prompts; $('#saved').textContent='Saved.'; } catch(e) {notice(e.message);} };
}
async function open(id) {
  const s = [...state.sessions,...state.history].find(s=>s.id === id); if(!s) {const v=view(id,'<div class="output muted">Waiting for this agent to reconnect. You can also select its saved conversation in the sidebar.</div>');v.pending=true;activate(id,'Reconnecting…');return;}
  if(s.host !== environment) {environment=s.host; localStorage.setItem('environment',environment);}
  if(s.kind === 'history' || s.kind === 'external') await showConversation(s,s.kind === 'external'); else connectTerminal(s);
}
async function newTerminal(provider = 'shell') {
  try {
    const current = state.sessions.find(s=>s.id === selected && s.host === environment);
    const s = await api('/sessions',{provider,host:environment,cwd:current?.cwd || (environment === 'local' ? state.defaultCwd : '~')});
    await refresh(); connectTerminal(s);
  } catch(e) { notice(e.message); }
}
async function refresh() {
  if(refreshing) return; refreshing=true;
  try {
    state = await api('/state');
    document.querySelectorAll('[data-requires-state]').forEach(el=>el.disabled=false);
    sidebar();
    if(!workspaceReady)await restoreWorkspace();
    renderChat();document.documentElement.style.setProperty('--text-size',state.preferences.fontSize+'px');
    for(const [id,v] of views)if(v.pending&&[...state.sessions,...state.history].some(s=>s.id===id)){v.element.remove();views.delete(id);const before=restoring,hostBefore=environment;restoring=true;await open(id);restoring=before;environment=hostBefore;localStorage.setItem('environment',environment);renderWorkspace();sidebar();}
    for(const v of views.values())if(v.term&&v.term.options.fontSize!==state.preferences.fontSize){v.term.options.fontSize=state.preferences.fontSize;v.resize();}
    for(const pane of layout.panes()){const active=views.get(pane.active);if(pane.active?.startsWith('messages:'))renderMessages(pane.active.slice(9));if(active?.source){active.source=state.sessions.find(s=>s.id===pane.active)||active.source;updateConversation(active);}}
    renderActivity();
    if(!bootBriefing && state.preferences.automaticBriefing && !state.coordinator.history.length && state.remote.every(r=>r.scannedAt || r.error) && !state.coordinator.running) {
      bootBriefing=true; sendChat('Read recent saved agent conversations across all environments. Tell me what still looks open, what appears finished, and ask what I want to focus on. Do not assume old work is still a priority.',true);
    }
  } catch(e) { notice(e.message);if(!state)$('#environment-status').textContent='Reconnecting…'; } finally { refreshing=false; }
}
$('#environment').onchange = e => {
  environment=e.target.value; localStorage.setItem('environment',environment); sidebar();
  const first=state.sessions.find(s=>s.host===environment && ['running','external','paused'].includes(s.status));
  if(first) open(first.id); else chat();
};
$('#conductor-nav').onclick=chat; $('#team-messages-nav').onclick=()=>messages(''); $('#settings-nav').onclick=settings;
document.addEventListener('click',e=>{const button=e.target.closest('[data-id]'); if(button) open(button.dataset.id); const team=e.target.closest('[data-team]'); if(team) messages(team.dataset.team);});
window.superTerminalDesktop?.onAction(action=>{
  if(!state){notice('Connecting to the local service…');return;}
  if(action==='conductor' || action==='coordinator') chat();
  if(action==='settings') settings();
  if(action==='new-terminal') newTerminal();
  if(action==='split-right')splitPanel('row');
  if(action==='split-below')splitPanel('column');
  if(action==='close-tab')closeTab(selected);
  if(action==='new-window')openWindow();
  if(action==='activity')activity();
  if(action==='next-panel'){const panes=layout.panes();focusPane(panes[(panes.findIndex(p=>p.id===layout.activePane)+1)%panes.length].id);views.get(selected)?.term?.focus();}
  if(typeof action==='object'&&action.type==='show-agent'){if(action.host){environment=action.host;sidebar();}refresh().then(()=>open(action.id));return;}
  if(typeof action==='string'&&action.startsWith('new-agent:')) newTerminal(action.split(':')[1]);
  if(action==='environment') $('#environment').focus();
});
document.addEventListener('pointerdown',e=>{const pane=e.target.closest('[data-pane]');if(pane&&pane.dataset.pane!==layout.activePane)focusPane(pane.dataset.pane);});
document.addEventListener('click',e=>{const split=e.target.closest('[data-layout]');if(split)splitPanel(split.dataset.layout);const tab=e.target.closest('[data-tab]');if(tab){layout.open(tab.dataset.tab);renderWorkspace();focusPane(layout.activePane);views.get(selected)?.term?.focus();}const close=e.target.closest('[data-close]');if(close)closeTab(close.dataset.close);const empty=e.target.closest('[data-close-panel]');if(empty){layout.removeEmpty(empty.dataset.closePanel);renderWorkspace();focusPane(layout.activePane);}const add=e.target.closest('[data-add-tab]');if(add){focusPane(add.dataset.addTab);newTerminal();}});
$('#new-window').onclick=openWindow;$('#notifications-nav').onclick=activity;
async function restoreWorkspace(){
  workspaceReady=true;
  const savedTabs=layout.panes().flatMap(p=>p.tabs),savedEnvironment=environment;restoring=true;
  for(const id of savedTabs){if(id==='conductor')chat();else if(id==='settings')settings();else if(id==='activity')activity();else if(id.startsWith('messages:'))await messages(id.slice(9));else await open(id);}
  restoring=false;environment=savedEnvironment;localStorage.setItem('environment',environment);renderWorkspace();focusPane(layout.activePane);
  if(initial.get('view')){const id=initial.get('view');if(id==='conductor')chat();else if(id==='settings')settings();else if(id==='activity')activity();else if(id.startsWith('messages:'))messages(id.slice(9));else await open(id);}
  if(!savedTabs.length&&!initial.get('view')){chat();await splitPanel('row');chat();}
}
installDividers();renderWorkspace();
document.querySelectorAll('[data-requires-state]').forEach(el=>el.disabled=true);
await refresh();
setInterval(refresh,5000);
