import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import './style.css';

const $ = s => document.querySelector(s);
const token = $('meta[name="super-terminal-token"]').content;
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, environment = localStorage.getItem('environment') || 'local', selected = 'conductor', refreshing = false, bootBriefing = false;
const views = new Map();
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
  const name = s.role || linkedTitle || (s.kind === 'managed' ? s.title.replace(new RegExp('^'+s.provider+' · '),'') : '') || s.cwd?.split('/').filter(Boolean).at(-1) || (s.tty && !['?','??'].includes(s.tty) ? s.tty : 'PID '+s.pid);
  const title = history ? s.title : `${s.provider === 'shell' ? 'terminal' : s.provider}${s.runtime ? ' service' : ''} · ${name}`;
  const sub = history ? `${a?.status || 'unreviewed'} · ${s.provider}` : `${s.connectionLost ? 'SSH ended · local shell' : s.status === 'paused' ? 'paused' : s.runtime ? 'background runtime' : s.kind === 'external' ? 'external' : 'terminal'}${s.runtime ? ' · PID '+s.pid : s.tty ? ' · '+s.tty.replace('/dev/','') : ''}${state.teams.some(t=>t.name===s.group) ? ' · '+s.group : ''}`;
  return `<button class="agent${selected === s.id ? ' selected' : ''}" data-id="${escape(s.id)}" title="${escape(a?.summary || s.title+'\n'+s.cwd)}"><span class="label">${history ? '' : '<span class="dot">●</span>'}${escape(title)}</span><small>${escape(sub)}</small></button>`;
}
function replaceMarkup(selector, markup) { const el=$(selector); if(el._markup !== markup) { el.innerHTML=markup; el._markup=markup; } }
function sidebar() {
  const selector = $('#environment'), signature = JSON.stringify(state.hosts);
  if (selector.dataset.hosts !== signature) {
    selector.innerHTML = ['local',...state.hosts].map(h => `<option value="${escape(h)}">${escape(hostName(h))}</option>`).join('');
    selector.dataset.hosts = signature;
    if (!['local',...state.hosts].includes(environment)) environment = 'local';
  }
  selector.value = environment;
  const live = state.sessions.filter(s => s.host === environment && ['running','external','paused'].includes(s.status));
  const remote = state.remote.find(r => r.host === environment);
  $('#environment-status').textContent = remote?.error ? 'SSH unavailable · retrying' : remote?.scanning && !remote.scannedAt ? 'Connecting…' : `${live.filter(s=>s.status!=='paused').length} running${live.some(s=>s.status==='paused') ? ' · '+live.filter(s=>s.status==='paused').length+' paused' : ''}`;
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
    const element = document.createElement('section'); element.className = 'view'; element.innerHTML = markup; element.hidden = true; $('#main').append(element); views.set(id,{ element });
  }
  return views.get(id);
}
function activate(id, title) {
  selected = id; for (const [key,v] of views) v.element.hidden = key !== id;
  document.title = `${title} — Super Terminal`;
  sidebar();
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
  if (!$('#chat-output')) return;
  const status = state.coordinator, output = $('#chat-output');
  const signature = JSON.stringify(status.history);
  if (output.dataset.signature !== signature) {
    const nearBottom = output.scrollHeight-output.scrollTop-output.clientHeight < 100;
    output.innerHTML = status.history.map(t => `${t.automatic ? '' : `<div class="line"><span class="speaker user">you</span>${escape(t.prompt)}</div>`}${t.answer ? `<div class="line"><span class="speaker assistant">${t.status === 'error' ? 'error' : 'conductor'}</span>${escape(t.answer)}</div>` : ''}`).join('') || '<div class="muted">I can read your saved agent conversations, keep track of open work, and help you pick up where you left off.</div>';
    output.dataset.signature = signature; if (nearBottom) output.scrollTop = output.scrollHeight;
  }
  const reviewed = state.history.filter(s => assessment(s)).length;
  $('#chat-progress').textContent = status.running ? 'Reading history and preparing a reply…' : `${reviewed} / ${state.history.length} conversations reviewed · cached between replies`;
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
    v.term = new Terminal({ cursorBlink: true, fontFamily:'Menlo, Monaco, monospace', fontSize:state.preferences.fontSize, lineHeight:1.15, scrollback:10000, theme:{ background:'#161616', foreground:'#ddd', cursor:'#ddd', selectionBackground:'#4a5568' }, allowProposedApi:false });
    v.fit = new FitAddon(); v.term.loadAddon(v.fit); v.term.open(v.element.querySelector('.terminal'));
    v.resize = () => { if (v.element.hidden) return; try { v.fit.fit(); if (v.ws?.readyState === 1) v.ws.send(JSON.stringify({type:'resize',cols:v.term.cols,rows:v.term.rows})); } catch {} };
    new ResizeObserver(v.resize).observe(v.element.querySelector('.terminal'));
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
function settings() {
  const v = view('settings','<div class="settings"><h1>Settings</h1><label for="font-size">Terminal text size</label><select id="font-size">'+Array.from({length:13},(_,i)=>`<option>${i+10}</option>`).join('')+'</select><label><input id="automatic-briefing" type="checkbox"> Automatic first briefing</label><p>One briefing when Conductor has no conversation yet. Further reviews run only when you ask.</p><h1 style="margin-top:30px">Agent startup prompts</h1><p>Applied to new agents. Existing terminals keep their current instructions.</p>'+['codex','claude','grok'].map(p=>`<label for="prompt-${p}">${p}</label><textarea id="prompt-${p}" maxlength="12000"></textarea>`).join('')+'<button id="save-prompts">Save prompts</button><p id="saved" role="status"></p></div>');
  activate('settings','Settings');
  $('#font-size').value = state.preferences.fontSize;
  $('#automatic-briefing').checked = state.preferences.automaticBriefing;
  for(const p of ['codex','claude','grok']) $('#prompt-'+p).value = state.prompts[p];
  $('#font-size').onchange = async e => { try { state.preferences = await api('/preferences',{fontSize:Number(e.target.value)},'PUT'); for(const v of views.values()) if(v.term) {v.term.options.fontSize=state.preferences.fontSize; v.resize();} } catch(e) {notice(e.message);} };
  $('#automatic-briefing').onchange = e => api('/preferences',{automaticBriefing:e.target.checked},'PUT').then(p=>{state.preferences=p;}).catch(e=>notice(e.message));
  $('#save-prompts').onclick = async () => { try { const prompts=Object.fromEntries(['codex','claude','grok'].map(p=>[p,$('#prompt-'+p).value])); await api('/prompts',prompts,'PUT'); state.prompts=prompts; $('#saved').textContent='Saved.'; } catch(e) {notice(e.message);} };
}
async function open(id) {
  const s = [...state.sessions,...state.history].find(s=>s.id === id); if(!s) return;
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
    state = await api('/state'); sidebar(); renderChat();
    const active = views.get(selected);
    if(selected.startsWith('messages:')) renderMessages(selected.slice(9));
    if(active?.source) { active.source = state.sessions.find(s=>s.id===selected) || active.source; updateConversation(active); }
    if(!bootBriefing && state.preferences.automaticBriefing && !state.coordinator.history.length && state.remote.every(r=>r.scannedAt || r.error) && !state.coordinator.running) {
      bootBriefing=true; sendChat('Read recent saved agent conversations across all environments. Tell me what still looks open, what appears finished, and ask what I want to focus on. Do not assume old work is still a priority.',true);
    }
  } catch(e) { notice(e.message); } finally { refreshing=false; }
}
$('#environment').onchange = e => {
  environment=e.target.value; localStorage.setItem('environment',environment); sidebar();
  const first=state.sessions.find(s=>s.host===environment && ['running','external','paused'].includes(s.status));
  if(first) open(first.id); else chat();
};
$('#conductor-nav').onclick=chat; $('#team-messages-nav').onclick=()=>messages(''); $('#settings-nav').onclick=settings;
document.addEventListener('click',e=>{const button=e.target.closest('[data-id]'); if(button) open(button.dataset.id); const team=e.target.closest('[data-team]'); if(team) messages(team.dataset.team);});
window.superTerminalDesktop?.onAction(action=>{
  if(action==='conductor' || action==='coordinator') chat();
  if(action==='settings') settings();
  if(action==='new-terminal') newTerminal();
  if(action.startsWith('new-agent:')) newTerminal(action.split(':')[1]);
  if(action==='environment') $('#environment').focus();
});
await refresh(); if(state) chat();
setInterval(refresh,5000);
