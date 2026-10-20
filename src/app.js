import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import { createWorkUI } from './work.js';

const $ = s => document.querySelector(s);
const token = $('meta[name="super-terminal-token"]').content;
let state = null, selected = 'home', mode = 'all', search = '', grouping = 'group', splitId = null, updating = false;
let draggedSession = null;
const terminals = new Map(), expanded = new Set(), collapsed = new Set();
const providerNames = { codex: 'Codex', claude: 'Claude', grok: 'Grok', shell: 'Terminal' };
const providerIcons = { codex: '◉', claude: '✳', grok: '𝕏', shell: '›_' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = p => `<span class="agent-icon ${esc(p)}">${providerIcons[p] || '›_'}</span>`;
const hostName = h => h === 'local' ? 'This Mac' : state?.hostNames?.[h] || h;
const shortPath = p => p?.replace(state?.home, '~') || 'No working directory';
const relative = d => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
const allItems = () => [...state.sessions, ...state.history];
const itemById = id => allItems().find(s => s.id === id);
const getGroup = s => grouping === 'host' ? hostName(s.host) : grouping === 'provider' ? providerNames[s.provider] : s.group;
function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 5500);
}
async function api(url, method = 'GET', body) {
  const r = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Super-Terminal': token }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function refresh(force = false) {
  if (updating) return;
  updating = true;
  try {
    state = await api('/state' + (force ? '?refresh=1' : ''));
    $('#connection-state').textContent = 'Connected';
    renderSidebar();
    if (selected === 'home') renderHome();
    else if (selected === 'messages') renderMessages();
    else if (selected.startsWith('team:')) updateTeamMembers();
    else if (selected === 'work') workUI.overview();
    else if (selected.startsWith('work:')) workUI.update();
  } catch (e) { $('#connection-state').textContent = 'Offline'; if (!state) $('#main').innerHTML = `<div class="empty-state"><h1>Start your local server</h1><p>${esc(e.message)}</p><code>npm start</code></div>`; }
  finally { updating = false; }
}
function renderSidebar() {
  const items = allItems().filter(s =>
    (mode !== 'history' || s.kind === 'history') &&
    (mode !== 'live' || (s.kind !== 'history' && s.status !== 'stopped')) &&
    `${s.title} ${s.cwd} ${s.provider} ${s.group} ${s.host}`.toLowerCase().includes(search.toLowerCase())
  );
  const groups = new Map();
  for (const item of items) {
    const key = getGroup(item) || 'Loose sessions';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  $('#session-count').textContent = `${items.length} terminals & chats`;
  $('#message-count').textContent = state.messages.filter(m => !m.read).length;
  $('#coord-nav').classList.toggle('active', selected === 'coordinator');
  $('#work-nav').classList.toggle('active', selected === 'work' || selected.startsWith('work:'));
  $('#messages-nav').classList.toggle('active', selected === 'messages');
  $('#session-list').innerHTML = [...groups].map(([group, rows]) => {
    const visible = expanded.has(group) || search ? rows : rows.slice(0, 6);
    return `<section class="session-group"><button class="group-heading" data-collapse="${esc(group)}"><span>${collapsed.has(group) ? '›' : '⌄'} <span class="folder-icon">▱</span> ${esc(group)}</span><span>${rows.length}</span></button>
    ${collapsed.has(group) ? '' : visible.map(s => `<button class="session-row ${s.id === selected ? 'active' : ''}" data-session="${esc(s.id)}" ${s.kind === 'managed' ? 'draggable="true"' : ''} title="${esc(s.title)}&#10;${esc(s.cwd)}${s.kind === 'managed' ? '&#10;Drag onto a team to add this agent.' : ''}">
      ${badge(s.provider)}<span class="session-label"><span class="session-title">${esc(s.title)}</span><span class="session-meta">${esc(s.kind === 'history' ? relative(s.updatedAt) : hostName(s.host))}<span>·</span>${s.kind === 'history' ? 'saved' : s.kind === 'external' ? 'external terminal' : s.status}</span></span>
      <span class="status-dot ${s.kind === 'history' ? 'saved' : s.kind === 'external' ? 'external' : s.status}"></span>
    </button>`).join('')}
    ${!collapsed.has(group) && visible.length < rows.length ? `<button class="show-more" data-expand="${esc(group)}">Show ${rows.length - visible.length} more ↓</button>` : ''}</section>`;
  }).join('') || '<div class="no-results">No sessions match.<br>Try another search.</div>';
  $('#team-list').innerHTML = state.teams.length ? state.teams.map(team => `<button class="team-link ${selected === 'team:' + team.id ? 'active' : ''}" data-team="${esc(team.id)}" data-drop-team="${esc(team.name)}"><span class="team-glyph">⌘</span><span>${esc(team.name)}</span><span class="count">${state.sessions.filter(s => s.kind === 'managed' && s.group === team.name).length}</span></button>`).join('') : '<button class="empty-teams" data-action="new-team">＋ Bring agents together</button>';
}
function header(title, subtitle = '', actions = '') {
  return `<header class="main-header"><div class="heading"><h1>${esc(title)}</h1><span>${esc(subtitle)}</span></div><div class="header-actions">${actions}</div></header>`;
}
function renderHome() {
  const live = state.sessions.filter(s => s.status === 'running');
  const recent = state.history.slice(0, 6);
  $('#main').innerHTML = `${header('Workspace', 'All your agents, in one place.', '<span class="privacy-tag"><i class="local-dot"></i> 127.0.0.1</span>')}
  <div class="home-scroll"><div class="home-intro"><div class="eyebrow">READY WHEN YOU ARE</div><h2>Pick up where you left off<span class="accent">.</span></h2><p>Your terminals, conversations, and agent handoffs.<br>Everything stays on this machine until you ask an agent to work.</p></div>
  <div class="launch-grid">${['codex', 'claude', 'grok', 'shell'].map(p => `<button class="launch-card" data-new-provider="${p}">${badge(p)}<span>${providerNames[p]}</span><small>${p === 'shell' ? 'A fresh shell' : 'Your existing CLI & login'}</small><span class="launch-arrow">↗</span><i class="available-dot ${state.providers.find(a => a.id === p)?.available ? '' : 'missing'}"></i></button>`).join('')}</div>
  <div class="section-title"><h3>Connections</h3><span>Configured SSH connections</span></div><div class="hosts">
  ${state.hosts.map(host => {
    const remote = state.remote.find(r => r.host === host);
    return `<div class="host-card"><div class="host-symbol">⌘</div><div><strong>${esc(hostName(host))}</strong><code>${esc(host)}</code><small>${remote?.error ? 'Unable to scan · connect to check' : remote ? `${remote.processes.length} agent processes · ${state.sessions.filter(s => s.kind === 'remote' && s.host === host).length} tmux panes` : 'Connecting…'}</small></div><div class="host-actions"><button class="text-button" data-scan="${esc(host)}">Scan</button><button class="small-button" data-connect="${esc(host)}">Connect ↗</button></div></div>`;
  }).join('')}</div>
  <div class="section-title"><h3>Recent conversations</h3><span>${state.history.length} discovered locally</span></div>
  <div class="recent-list">${recent.map(s => `<button class="recent-row" data-session="${esc(s.id)}">${badge(s.provider)}<span><strong>${esc(s.title)}</strong><small>${esc(s.group)} <span>·</span> ${providerNames[s.provider]}</small></span><time>${relative(s.updatedAt)}</time><span class="muted">↗</span></button>`).join('') || '<p class="muted">No saved conversations found yet. Start your first agent above.</p>'}</div>
  <div class="home-bottom"><span><b>${live.length}</b> controllable terminals</span><span><b>${state.sessions.filter(s => s.kind === 'external').length}</b> external terminals</span><span><b>0</b> idle AI requests</span><button class="text-button" data-action="coordinator">Ask the coordinator ↗</button></div>
  </div>`;
}
async function select(id) {
  selected = id;
  splitId = null;
  renderSidebar();
  if (id === 'home') return renderHome();
  if (id === 'coordinator') return renderCoordinator();
  if (id === 'messages') return renderMessages();
  if (id.startsWith('team:')) return renderTeam(id.slice(5));
  if (id === 'work') return workUI.overview();
  if (id.startsWith('work:')) return workUI.detail(id.slice(5));
  const session = itemById(id);
  if (!session) return;
  if (session.kind === 'history') {
    $('#main').innerHTML = `${header(session.title, `${providerNames[session.provider]} / ${shortPath(session.cwd)}`, `<button class="primary" data-resume="${esc(session.id)}">Resume conversation ↗</button>`)}<div class="transcript" id="transcript"><div class="loading">Reading conversation…</div></div>`;
    try {
      const result = await api('/history/' + encodeURIComponent(id));
      if (selected !== id) return;
      $('#transcript').innerHTML = `<div class="transcript-notice">${esc(result.note)}</div>${result.messages.map(m => `<article class="message ${esc(m.role)}"><div class="message-author">${m.role === 'user' ? 'YOU' : providerNames[session.provider].toUpperCase()}</div><div class="message-text">${esc(m.text)}</div></article>`).join('') || '<div class="empty-state"><h2>No preview available</h2><p>Resume this session to see its full conversation in the CLI.</p></div>'}`;
    } catch (e) { toast(e.message); }
  } else if (session.kind === 'external') {
    const related = state.history.filter(s => s.provider === session.provider && s.cwd === session.cwd).slice(0, 6);
    $('#main').innerHTML = `${header(session.title, `${hostName(session.host)} / ${shortPath(session.cwd)}`)}<div class="external-view"><span class="large-terminal-icon">›_</span><div class="eyebrow">RUNNING ELSEWHERE · ${esc(hostName(session.host))}</div><h2>${providerNames[session.provider]} is already open.</h2><p>This process belongs to <code>${esc(session.tty)}</code> (PID ${session.pid}).<br>Use its original terminal to continue the live session, or open a saved conversation below.</p><div class="info-box">New sessions launched here can be controlled directly and stay alive when you close this window. Existing tmux sessions can also be attached.</div><button class="primary" data-new-provider="${esc(session.provider)}" data-new-host="${esc(session.host)}">Start ${providerNames[session.provider]} here</button><h3>Conversations in this folder</h3>${related.map(s => `<button class="recent-row" data-session="${esc(s.id)}">${badge(s.provider)}<span><strong>${esc(s.title)}</strong><small>${relative(s.updatedAt)}</small></span><span>↗</span></button>`).join('') || '<p class="muted">No matching saved conversations.</p>'}</div>`;
  } else if (session.status === 'stopped') {
    $('#main').innerHTML = `${header(session.title, shortPath(session.cwd), `<button class="small-button danger" data-stop="${esc(session.id)}">Remove</button>`)}<div class="empty-state"><h2>This terminal has stopped.</h2><p>Its saved agent conversation is still available in History.</p><button class="primary" data-new-provider="${esc(session.provider)}">Start a new session</button></div>`;
  } else renderTerminal(session);
}
function terminalFor(session) {
  if (terminals.has(session.id)) return terminals.get(session.id);
  const element = document.createElement('div'); element.className = 'terminal-mount';
  const term = new Terminal({
    cursorBlink: true, fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace',
    fontSize: 13, lineHeight: 1.28, scrollback: 10000, allowProposedApi: false,
    theme: { background: '#101316', foreground: '#d9e0e4', cursor: '#a6e3cf', selectionBackground: '#34504b', black: '#242b30', red: '#e78585', green: '#a6d5a7', yellow: '#e0c58b', blue: '#8fb9e3', magenta: '#c4a6d8', cyan: '#9ed9d3', white: '#d9e0e4' }
  });
  const fit = new FitAddon(); term.loadAddon(fit);
  const entry = { element, term, fit, connected: false, opened: false, closed: false };
  terminals.set(session.id, entry);
  function connect() {
    if (entry.closed) return;
    const ws = new WebSocket(`ws://${location.host}/terminal?token=${encodeURIComponent(token)}&id=${encodeURIComponent(session.id)}`);
    entry.ws = ws;
    const sendSize = () => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); };
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.type === 'output') term.write(message.data);
      if (message.type === 'ready') { entry.connected = true; fit.fit(); sendSize(); updateTerminalStatus(); }
      if (message.type === 'error') { term.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`); entry.closed = true; }
      if (message.type === 'exit') { entry.closed = true; term.writeln('\r\n\x1b[90m[Detached. The session may still be running.]\x1b[0m'); }
    });
    ws.addEventListener('close', () => {
      entry.connected = false; updateTerminalStatus();
      if (!entry.closed) setTimeout(connect, 1800);
    });
    ws.addEventListener('error', () => {});
    entry.sendSize = sendSize;
  }
  term.onData(data => { if (entry.ws?.readyState === 1) entry.ws.send(JSON.stringify({ type: 'input', data })); });
  term.onResize(() => entry.sendSize?.());
  entry.observer = new ResizeObserver(() => { if (element.offsetWidth > 0 && entry.opened) { try { fit.fit(); } catch {} } });
  entry.observer.observe(element);
  entry.connect = connect;
  return entry;
}
function updateTerminalStatus() {
  const status = $('#terminal-status');
  if (status) status.textContent = terminals.get(selected)?.connected ? 'Connected · session persists in tmux' : 'Connecting…';
}
function mountTerminal(session, target) {
  const entry = terminalFor(session);
  target.append(entry.element);
  if (!entry.opened) { entry.term.open(entry.element); entry.opened = true; entry.connect(); }
  requestAnimationFrame(() => { entry.fit.fit(); entry.term.focus(); });
}
function renderTerminal(session) {
  $('#main').innerHTML = `${header(session.title, `${providerNames[session.provider]} / ${hostName(session.host)} / ${shortPath(session.cwd)}`,
    `<button class="small-button" data-action="split">◫ ${splitId ? 'Single view' : 'Split'}</button><button class="small-button" data-context="${esc(session.group)}">Shared notes</button>${session.kind === 'managed' ? `<button class="small-button" data-browser="${esc(session.id)}">Browser ↗</button><button class="icon-button" data-edit="${esc(session.id)}" title="Rename or regroup" aria-label="Rename or regroup">⋯</button>` : ''}`)}
    <div class="terminal-tabs"><span class="active">${badge(session.provider)} ${esc(session.group)} <i class="local-dot"></i></span><span class="tab-hint">Full CLI · all your usual commands</span></div>
    <div class="terminal-layout ${splitId ? 'split' : ''}"><div class="terminal-pane" id="primary-terminal"></div>${splitId ? '<div class="terminal-pane" id="secondary-terminal"></div>' : ''}</div>
    <footer class="terminal-footer"><span id="terminal-status">Connecting…</span><span>${session.host === 'local' ? 'Your local shell & permissions' : 'SSH · remote tmux'}${session.kind === 'managed' ? ` <button class="text-button danger" data-stop="${esc(session.id)}">Close terminal</button>` : ''}</span></footer>`;
  mountTerminal(session, $('#primary-terminal'));
  if (splitId) mountTerminal(itemById(splitId), $('#secondary-terminal'));
  updateTerminalStatus();
}
function renderCoordinator() {
  const entries = state.coordinator.history;
  const groups = [...new Set([...allItems().map(s => s.group), ...state.teams.map(t => t.name)])].sort();
  $('#main').innerHTML = `${header('Coordinator', 'Consolidation without the background token burn.', `<span class="privacy-tag">✳ ${esc(state.coordinator.model)} · low effort</span>`)}
    <div class="coordinator-scroll"><div class="coordinator-intro"><span class="coordinator-mark">✳</span><h2>A second pair of eyes<br>across your agents.</h2><p>Ask for progress, overlaps, blockers, or a handoff.<br>Uses a small snapshot of recent activity and platform messages. Runs only when you ask.</p></div>
    <div class="prompt-suggestions"><button data-suggestion="Consolidate what my agents are working on. What changed, what is blocked, and what needs my attention?">Consolidate activity ↗</button><button data-suggestion="Find overlapping work across agents and propose concise handoffs.">Find overlaps ↗</button><button data-suggestion="Give me a brief update per workspace, separating confirmed progress from things that need checking.">Workspace update ↗</button></div>
    <form id="coordinator-form" class="coordinator-compose"><textarea name="prompt" id="coordinator-prompt" placeholder="What should I know across my agents?" required maxlength="6000" rows="3"></textarea><div><select name="group" aria-label="Coordinator scope"><option value="">All workspaces</option>${state.workSessions.map(s=>`<option value="ws:${esc(s.id)}">Session: ${esc(s.title)}</option>`).join('')}${groups.map(g => `<option>${esc(g)}</option>`).join('')}</select><span id="coord-status">${state.coordinator.running ? 'Preparing an update…' : 'No requests while idle'}</span><button type="submit" class="primary" ${state.coordinator.running ? 'disabled' : ''}>Ask coordinator ↑</button><button type="button" class="text-button" data-action="cancel-coordinator" ${state.coordinator.running ? '' : 'hidden'}>Cancel</button></div></form>
    <div id="consolidations">${entries.slice().reverse().map(c => `<article class="consolidation"><div class="section-title"><span>${c.status === 'error' ? 'Failed' : c.status === 'running' ? 'Preparing' : 'CONSOLIDATION'} · ${esc(c.group || 'All workspaces')}</span><time>${relative(c.createdAt)}</time></div><h3>${esc(c.prompt)}</h3><div class="message-text">${esc(c.answer || 'Reading the activity snapshot…')}</div><div class="usage">${c.usage ? `${Number(c.usage.input_tokens || 0).toLocaleString()} input · ${Number(c.usage.output_tokens || 0).toLocaleString()} output tokens` : `${(c.snapshotChars / 1000).toFixed(1)}k characters of context`}</div></article>`).join('')}</div></div>`;
}
function senderName(id) { return id === 'you' ? 'You' : id === 'coordinator' ? 'Coordinator' : state.sessions.find(s => s.id === id)?.title || id.slice(0, 8); }
function renderMessages() {
  $('#main').innerHTML = `${header('Agent messages', 'A shared mailbox for handoffs and updates.', '<button class="primary" data-action="compose">Write a message ＋</button>')}
  <div class="messages-scroll"><div class="transcript-notice">Agents in the same group or working session can find and message each other. Startup prompts ask them to check their inbox at meaningful milestones. Delivery is recorded when an agent reads its inbox.</div>
  ${state.messages.slice().reverse().map(m => `<article class="mail"><div class="mail-header"><strong>${esc(senderName(m.from))}</strong><span>→</span><strong>${esc(senderName(m.to))}</strong><time>${relative(m.createdAt)}</time></div><div class="message-text">${esc(m.text)}</div><div class="mail-meta">${esc(m.group)} · ${m.read ? 'Read' : m.to === 'coordinator' ? 'Included in coordinator snapshots' : 'Waiting in inbox'}</div></article>`).join('') || '<div class="empty-state"><span class="large-terminal-icon">⇄</span><h2>A place for useful handoffs.</h2><p>New agents receive mailbox instructions automatically.<br>Put agents in the same group to let them collaborate.</p></div>'}</div>`;
}
function renderTeam(id) {
  const team = state.teams.find(t => t.id === id);
  if (!team) return select('home');
  $('#main').innerHTML = `${header(`team / ${team.name}`, `${hostName(team.host)} / ${shortPath(team.cwd)}`, `<button class="small-button" data-context="${esc(team.name)}">Shared notes</button><button class="primary" data-launch-team="${esc(team.id)}">Launch agents ↗</button>`)}
    <div class="team-scroll"><div class="team-intro"><span class="eyebrow">SHARED DIRECTION. CLEAR OWNERSHIP.</span><h2>One mission, a few good agents.</h2><p>Give the team a larger piece of work. Assign roles, share context, and coordinate through the mailbox.</p></div>
    <form id="mission-form" data-id="${esc(team.id)}" class="mission-editor"><div class="section-title"><h3>Team mission</h3><span>What does done look like?</span></div><textarea name="mission" rows="5" maxlength="12000" placeholder="Describe the outcome, scope, and what success looks like…">${esc(team.mission)}</textarea><div class="mission-actions"><span>Agents get this mission when launched or briefed.</span><button class="small-button" type="submit">Save mission</button><button type="button" class="primary" data-brief-team="${esc(team.id)}">Brief existing agents →</button></div></form>
    <div class="section-title team-members-heading"><h3>Team members</h3><span>Drag a running agent from the sidebar onto this team</span></div><div id="team-members"></div>
    <div class="team-tools"><button class="small-button" data-add-member="${esc(team.id)}">＋ Add existing agent</button><button class="text-button" data-team-consolidate="${esc(team.name)}">Ask coordinator about this team ↗</button></div>
    <div class="section-title"><h3>Recent handoffs</h3><button class="text-button" data-action="messages">All messages ↗</button></div><div id="team-handoffs"></div></div>`;
  updateTeamMembers();
}
function updateTeamMembers() {
  const team = state.teams.find(t => 'team:' + t.id === selected);
  if (!team || !$('#team-members')) return;
  const members = state.sessions.filter(s => s.kind === 'managed' && s.group === team.name);
  $('#team-members').innerHTML = members.length ? members.map(s => `<button class="team-member" data-session="${esc(s.id)}">${badge(s.provider)}<span><strong>${esc(s.role || s.title)}</strong><small>${providerNames[s.provider]} · ${esc(hostName(s.host))}</small></span><span class="member-state"><i class="status-dot ${esc(s.status)}"></i>${esc(s.status)}</span><span>↗</span></button>`).join('') : '<div class="team-empty"><span>›_ ›_ ›_</span><p>Your team is ready for its first agents.<br>Launch a team or add terminals already running here.</p></div>';
  $('#team-handoffs').innerHTML = state.messages.filter(m => m.group === team.name).slice(-5).reverse().map(m => `<article class="team-handoff"><div>${esc(senderName(m.from))} <span>→</span> ${esc(senderName(m.to))}<time>${relative(m.createdAt)}</time></div><p>${esc(m.text)}</p></article>`).join('') || '<p class="form-note">Progress updates and handoffs will appear here.</p>';
}
function newTeamDialog() {
  const scopeOptions = state.workSessions.filter(s=>s.status!=='wrapped').flatMap(s=>[{label:s.title,scope:{workSessionId:s.id}},...s.projects.map(p=>({label:`${s.title} / ${p.name}`,scope:{workSessionId:s.id,projectId:p.id}}))]);
  showDialog(`<form id="team-form">${dialogTop('Create a team', 'A shared mission, a workspace, and agents you can bring together.')}<label>Team name<input name="name" required maxlength="120" placeholder="e.g. Romagnolo release"></label><div class="form-grid"><label>Location<select name="host"><option value="local">This Mac</option>${state.hosts.map(h => `<option value="${esc(h)}">${esc(hostName(h))}</option>`).join('')}</select></label><label>Working directory<input name="cwd" required value="${esc(state.defaultCwd)}"></label></div><label>Working-session assignment<select name="scope"><option value="">Independent team</option>${scopeOptions.map(o=>`<option value="${esc(JSON.stringify(o.scope))}">${esc(o.label)}</option>`).join('')}</select></label><label>Mission<textarea name="mission" rows="5" maxlength="12000" placeholder="The bigger piece of work. Include goals, boundaries, and acceptance criteria."></textarea></label><div class="dialog-footer"><span>Creating a team uses no tokens.</span><button class="primary" type="submit">Create team →</button></div></form>`);
  $('#team-form [name=host]').addEventListener('change', e => { $('#team-form [name=cwd]').value = e.target.value === 'local' ? state.defaultCwd : '~'; });
  $('#team-form [name=scope]').addEventListener('change', e => {
    if (!e.target.value) return;
    const scope = JSON.parse(e.target.value);
    const project = state.workSessions.find(s => s.id === scope.workSessionId)?.projects.find(p => p.id === scope.projectId);
    if (project) { $('#team-form [name=host]').value = project.host; $('#team-form [name=cwd]').value = project.cwd; }
  });
}
function launchTeamDialog(id) {
  const team = state.teams.find(t => t.id === id);
  const roles = [
    { name: 'Lead', provider: 'codex', assignment: 'Break down the mission, agree on ownership with peers, handle integration, and give the user concise progress updates.' },
    { name: 'Implementer', provider: 'claude', assignment: 'Implement the main changes. Coordinate file ownership with the lead before editing, and send a handoff when changes are ready.' },
    { name: 'Reviewer', provider: 'grok', assignment: 'Review the work and verify important behavior. Read peer updates, report concrete issues, and avoid competing edits to the same files.' }
  ];
  showDialog(`<form id="launch-team-form" data-id="${esc(id)}">${dialogTop('Launch the team', 'Each agent gets the mission, its role, and communication instructions.')}<div class="team-launch-mission">${esc(team.mission || 'Add a team mission before launching agents.')}</div>${roles.map((r, i) => `<fieldset class="role-config"><div><label class="role-toggle"><input type="checkbox" name="enabled-${i}" checked> Agent ${i + 1}</label><input name="role-${i}" aria-label="Agent ${i + 1} role" value="${r.name}" required maxlength="100"><select name="provider-${i}" aria-label="Agent ${i + 1} provider">${['codex','claude','grok'].map(p => `<option value="${p}" ${p === r.provider ? 'selected' : ''}>${providerNames[p]}</option>`).join('')}</select></div><textarea name="assignment-${i}" aria-label="Agent ${i + 1} assignment" rows="2" maxlength="4000">${r.assignment}</textarea></fieldset>`).join('')}<div class="form-error" role="alert"></div><div class="dialog-footer"><span>Selected agents start working on this mission.</span><button class="primary" type="submit" ${team.mission.trim() ? '' : 'disabled'}>Launch team ↗</button></div></form>`, true);
}
function showDialog(html, wide = false) {
  const d = $('#dialog'); d.className = wide ? 'wide' : ''; d.innerHTML = html; d.showModal();
  d.querySelector('input,textarea,select')?.focus();
}
const dialogTop = (title, subtitle = '') => `<div class="dialog-header"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close dialog">×</button></div>`;
function newSession(provider = 'codex', host = 'local', historyId = null, scope = null) {
  const original = historyId ? itemById(historyId) : null;
  const current = itemById(selected);
  const workSession = scope && state.workSessions.find(s=>s.id===scope.workSessionId);
  const project = workSession?.projects.find(p=>p.id===scope.projectId);
  if(project)host=project.host;
  showDialog(`<form id="new-form">${dialogTop(original ? 'Resume conversation' : 'New agent terminal', 'Your CLI, with a mailbox and an isolated browser.')}
    <input type="hidden" name="historyId" value="${esc(historyId || '')}">
    ${scope ? `<input type="hidden" name="scope" value="${esc(JSON.stringify(scope))}"><div class="scope-assignment-label">Assigned to: ${esc(workSession.title)}${project?' / '+esc(project.name):''}${scope.goalId?' / goal':''}</div>` : ''}
    <div class="form-grid"><label>Agent<select name="provider" ${original ? 'disabled' : ''}>${['codex', 'claude', 'grok', 'shell'].map(p => `<option value="${p}" ${p === (original?.provider || provider) ? 'selected' : ''}>${providerNames[p]}</option>`).join('')}</select></label>
    <label>Location<select name="host" ${original ? 'disabled' : ''}><option value="local">This Mac</option>${state.hosts.map(h => `<option value="${esc(h)}" ${h === host ? 'selected' : ''}>${esc(hostName(h))}</option>`).join('')}</select></label></div>
    <label>Working directory<input name="cwd" value="${esc(original?.cwd || project?.cwd || (host === 'local' ? current?.cwd || state.defaultCwd : '~'))}" required autocomplete="off"></label>
    <div class="form-grid"><label>Terminal name<input name="title" placeholder="e.g. API implementation" value="${esc(original?.title || '')}" maxlength="200"></label><label>Group / team<input name="group" placeholder="Automatic from folder" value="${esc(original?.group || project?.name || workSession?.title?.slice(0,120) || current?.group || '')}" list="group-options" maxlength="120"><datalist id="group-options">${[...new Set([...allItems().map(s => s.group),...state.teams.map(t=>t.name)])].map(g => `<option value="${esc(g)}">`).join('')}</datalist></label></div>
    <label>Initial task <span class="optional">optional</span><textarea name="task" rows="3" placeholder="What should this agent work on? Leave empty to start and wait." maxlength="12000"></textarea></label>
    <details><summary>Startup prompt</summary><label><textarea name="prompt" rows="5" maxlength="12000">${esc(state.prompts[original?.provider || provider] || '')}</textarea></label><p class="form-note">Mailbox and private-browser instructions are added automatically. Change defaults in ⚙.</p></details>
    <div class="form-error" role="alert"></div><div class="dialog-footer"><span>Sessions survive closing this window.</span><button type="submit" class="primary">${original ? 'Resume' : 'Launch session'} ↗</button></div></form>`);
  $('#new-form [name=host]').addEventListener('change', e => { $('#new-form [name=cwd]').value = e.target.value === 'local' ? state.defaultCwd : '~'; });
  $('#new-form [name=provider]').addEventListener('change', e => { $('#new-form [name=prompt]').value = state.prompts[e.target.value] || ''; });
}
const workUI = createWorkUI({$,esc,api,toast,header,badge,providerNames,hostName,shortPath,relative,showDialog,dialogTop,state:()=>state,selected:()=>selected,select,refresh,launch:(provider,scope)=>newSession(provider,'local',null,scope)});
async function contextDialog(group) {
  const c = await api('/context?group=' + encodeURIComponent(group));
  showDialog(`<form id="context-form">${dialogTop('Shared notes', group)}<input type="hidden" name="group" value="${esc(group)}"><textarea name="content" rows="15" class="notes-editor" maxlength="100000">${esc(c.content)}</textarea><p class="form-note">Agents in this group read these notes with the platform helper. Saving does not send an AI request.</p><code class="file-path">${esc(c.path)}</code><div class="dialog-footer"><button type="button" class="text-button" data-copy="${esc(c.path)}">Copy file path</button><button class="primary" type="submit">Save notes</button></div></form>`, true);
}
function settingsDialog() {
  showDialog(`<form id="settings-form">${dialogTop('Default startup prompts', 'Applied when launching or resuming an agent.')}<div class="settings-fields">${['codex', 'claude', 'grok'].map(p => `<label>${providerNames[p]}<textarea name="${p}" rows="4" maxlength="12000">${esc(state.prompts[p])}</textarea></label>`).join('')}</div><p class="form-note">Platform instructions for messaging and isolated browsers are always included. Normal CLI permissions remain in place.</p><div class="dialog-footer"><span>Local settings</span><button class="primary" type="submit">Save defaults</button></div></form>`, true);
}
function composeDialog() {
  showDialog(`<form id="message-form">${dialogTop('Send a handoff', 'The recipient will see it the next time it checks its inbox.')}<label>To<select name="to"><option value="coordinator">Coordinator</option>${state.sessions.filter(s => s.kind === 'managed').map(s => `<option value="${esc(s.id)}">${esc(s.title)} · ${esc(s.group)}</option>`).join('')}</select></label><label>Message<textarea name="message" required rows="6" maxlength="12000" placeholder="Progress, context, a blocker, or the next step…"></textarea></label><div class="dialog-footer"><span>No automatic AI request</span><button class="primary" type="submit">Send message →</button></div></form>`);
}
async function browserDialog(id) {
  showDialog(`${dialogTop('Agent browser', 'A separate profile. Your personal tabs and cookies are never used.')}<form id="browser-form" data-id="${esc(id)}" class="browser-controls"><input name="url" type="url" placeholder="https://…" aria-label="Browser URL" required><button class="primary" type="submit">Open ↗</button></form><div class="browser-toolbar"><button class="small-button" data-browser-refresh="${esc(id)}">Refresh view</button><button class="text-button" data-browser-close="${esc(id)}">Stop browser</button><span id="browser-state">Starts on demand</span></div><div id="browser-preview" class="browser-preview"><p>Open a URL or refresh to inspect this agent’s browser.</p></div>`, true);
  if (state.browsers.includes(id)) await updateBrowser(id);
}
async function updateBrowser(id) {
  $('#browser-state').textContent = 'Loading…';
  const result = await api('/browser/' + id, 'POST', { action: 'screenshot' });
  if (!$('#browser-preview')) return;
  $('#browser-preview').innerHTML = `<img src="data:image/png;base64,${result.image}" alt="Current page in the agent’s isolated browser">`;
  $('#browser-form [name=url]').value = result.url === 'about:blank' ? '' : result.url;
  $('#browser-state').textContent = 'Isolated · running';
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || !state) return;
  try {
    if(await workUI.click(button))return;
    if (button.dataset.session) return await select(button.dataset.session);
    if (button.dataset.team) return await select('team:' + button.dataset.team);
    if (button.dataset.launchTeam) return launchTeamDialog(button.dataset.launchTeam);
    if (button.dataset.teamConsolidate) {
      await select('coordinator'); $('#coordinator-form [name=group]').value = button.dataset.teamConsolidate;
      $('#coordinator-prompt').value = 'Give me a concise team update: progress against the mission, ownership, blockers, and the next useful handoffs.';
      return $('#coordinator-prompt').focus();
    }
    if (button.dataset.briefTeam) {
      await api('/teams/' + button.dataset.briefTeam, 'PATCH', { mission: $('#mission-form [name=mission]').value });
      const result = await api('/teams/' + button.dataset.briefTeam + '/brief', 'POST', {}); await refresh();
      return toast(`Mission sent to ${result.count} agent inbox${result.count === 1 ? '' : 'es'}.`);
    }
    if (button.dataset.addMember) {
      const team = state.teams.find(t => t.id === button.dataset.addMember);
      const candidates = state.sessions.filter(s => s.kind === 'managed' && s.group !== team.name);
      return showDialog(`${dialogTop('Add an existing agent', 'Moves the agent into this team and sends its mission to the inbox.')}<div class="split-options">${candidates.map(s => `<button class="recent-row" data-join="${esc(s.id)}" data-join-group="${esc(team.name)}">${badge(s.provider)}<span><strong>${esc(s.title)}</strong><small>${esc(s.group)}</small></span></button>`).join('') || '<p class="form-note">Launch a session first, or use Launch agents to start a fresh team.</p>'}</div>`);
    }
    if (button.dataset.join) { await api('/sessions/' + button.dataset.join, 'PATCH', { group: button.dataset.joinGroup }); $('#dialog').close(); await refresh(); return toast('Agent joined the team.'); }
    if (button.dataset.mode) { mode = button.dataset.mode; $('#filters').querySelectorAll('button').forEach(b => b.classList.toggle('selected', b === button)); return renderSidebar(); }
    if (button.dataset.expand) { expanded.add(button.dataset.expand); return renderSidebar(); }
    if (button.dataset.collapse) { const g = button.dataset.collapse; collapsed.has(g) ? collapsed.delete(g) : collapsed.add(g); return renderSidebar(); }
    if (button.dataset.newProvider) return newSession(button.dataset.newProvider, button.dataset.newHost || 'local');
    if (button.dataset.connect) return newSession('shell', button.dataset.connect);
    if (button.dataset.resume) return newSession(itemById(button.dataset.resume).provider, 'local', button.dataset.resume);
    if (button.dataset.scan) {
      button.disabled = true; button.textContent = 'Scanning…';
      await api('/hosts/scan', 'POST', { host: button.dataset.scan }); await refresh(); return toast('SSH sessions refreshed.');
    }
    if (button.dataset.context) return await contextDialog(button.dataset.context);
    if (button.dataset.copy) { await navigator.clipboard.writeText(button.dataset.copy); return toast('Copied.'); }
    if (button.dataset.suggestion) { $('#coordinator-prompt').value = button.dataset.suggestion; return $('#coordinator-prompt').focus(); }
    if (button.dataset.browser) return await browserDialog(button.dataset.browser);
    if (button.dataset.browserRefresh) return await updateBrowser(button.dataset.browserRefresh);
    if (button.dataset.browserClose) { await api('/browser/' + button.dataset.browserClose, 'POST', { action: 'close' }); $('#browser-preview').innerHTML = '<p>Browser stopped. Its profile is saved.</p>'; $('#browser-state').textContent = 'Stopped'; return; }
    if (button.dataset.edit) {
      const s = itemById(button.dataset.edit);
      return showDialog(`<form id="edit-form" data-id="${esc(s.id)}">${dialogTop('Session details')}<label>Name<input name="title" value="${esc(s.title)}" maxlength="200" required></label><label>Group<input name="group" value="${esc(s.group)}" maxlength="120" required></label><p class="form-note">Agents in the same group can message each other and share notes.</p><div class="dialog-footer"><span></span><button class="primary" type="submit">Save</button></div></form>`);
    }
    if (button.dataset.stop) {
      const s = itemById(button.dataset.stop);
      return showDialog(`<form id="stop-form" data-id="${esc(s.id)}">${dialogTop('Close this terminal?')}<p class="form-note">This ends the local terminal and its running process. ${s.host !== 'local' ? 'The remote tmux session will remain on the server.' : 'Saved agent conversations will remain available in History.'}</p><strong>${esc(s.title)}</strong><div class="dialog-footer"><button class="small-button" type="button" data-action="close-dialog">Keep running</button><button class="danger-button" type="submit">Close terminal</button></div></form>`);
    }
    switch (button.dataset.action) {
      case 'home': return await select('home');
      case 'new': return newSession();
      case 'coordinator': return await select('coordinator');
      case 'messages': return await select('messages');
      case 'refresh': await refresh(true); return toast('Sessions refreshed.');
      case 'settings': return settingsDialog();
      case 'compose': return composeDialog();
      case 'new-team': return newTeamDialog();
      case 'close-dialog': return $('#dialog').close();
      case 'cancel-coordinator': await api('/coordinator/cancel', 'POST', {}); return toast('Coordinator cancellation requested.');
      case 'split': {
        if (splitId) { splitId = null; return renderTerminal(itemById(selected)); }
        const candidates = state.sessions.filter(s => s.id !== selected && ['managed', 'tmux', 'remote'].includes(s.kind) && s.status === 'running');
        if (!candidates.length) return toast('Start a second terminal to use split view.');
        return showDialog(`${dialogTop('Choose a second terminal')}<div class="split-options">${candidates.map(s => `<button class="recent-row" data-split="${esc(s.id)}">${badge(s.provider)}<span><strong>${esc(s.title)}</strong><small>${esc(s.group)}</small></span></button>`).join('')}</div>`);
      }
    }
    if (button.dataset.split) { splitId = button.dataset.split; $('#dialog').close(); renderTerminal(itemById(selected)); }
  } catch (e) { toast(e.message); if (button.dataset.scan) { button.disabled = false; button.textContent = 'Scan'; } }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target, data = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type=submit]');
  if (submit) submit.disabled = true;
  try {
    if(await workUI.submit(form,data))return;
    if (form.id === 'new-form') {
      if(data.scope)data.scope=JSON.parse(data.scope);
      if (!data.historyId) delete data.historyId;
      const session = await api('/sessions', 'POST', data);
      $('#dialog').close(); await refresh(true); await select(session.id);
    } else if (form.id === 'team-form') { data.scope=data.scope?JSON.parse(data.scope):null; const team = await api('/teams', 'POST', data); $('#dialog').close(); await refresh(); await select('team:' + team.id); }
    else if (form.id === 'mission-form') { await api('/teams/' + form.dataset.id, 'PATCH', data); await refresh(); toast('Team mission saved.'); }
    else if (form.id === 'launch-team-form') {
      const roles = [0,1,2].filter(i => data['enabled-' + i]).map(i => ({name:data['role-' + i],provider:data['provider-' + i],assignment:data['assignment-' + i]}));
      const result = await api('/teams/' + form.dataset.id + '/start', 'POST', { roles }); await refresh();
      if (result.errors.length) { form.querySelector('.form-error').textContent = `${result.launched.length} launched. ` + result.errors.map(e => `${e.role}: ${e.error}`).join(' · '); }
      else { $('#dialog').close(); await select('team:' + form.dataset.id); toast(`${result.launched.length} agents launched with the team mission.`); }
    }
    else if (form.id === 'context-form') { await api('/context', 'PUT', data); $('#dialog').close(); toast('Shared notes saved.'); }
    else if (form.id === 'settings-form') { await api('/prompts', 'PUT', data); await refresh(); $('#dialog').close(); toast('Startup prompts saved.'); }
    else if (form.id === 'edit-form') { await api('/sessions/' + form.dataset.id, 'PATCH', data); $('#dialog').close(); await refresh(); await select(selected); }
    else if (form.id === 'stop-form') {
      await api('/sessions/' + form.dataset.id, 'DELETE');
      const t = terminals.get(form.dataset.id); if (t) { t.closed = true; t.ws?.close(); t.observer.disconnect(); t.term.dispose(); terminals.delete(form.dataset.id); }
      $('#dialog').close(); selected = 'home'; await refresh(); renderHome();
    } else if (form.id === 'message-form') { await api('/messages', 'POST', data); $('#dialog').close(); await refresh(); toast('Message added to inbox.'); }
    else if (form.id === 'coordinator-form') {
      if(data.group?.startsWith('ws:')){data.workSessionId=data.group.slice(3);data.group='';}
      $('#coord-status').textContent = 'Preparing a compact update…';
      form.querySelector('[data-action=cancel-coordinator]').hidden = false;
      await api('/coordinator', 'POST', data); await refresh();
      if (selected === 'coordinator') renderCoordinator();
    } else if (form.id === 'browser-form') { await api('/browser/' + form.dataset.id, 'POST', { action: 'open', url: data.url }); await updateBrowser(form.dataset.id); }
  } catch (e) {
    const error = form.querySelector('.form-error'); if (error) error.textContent = e.message; else toast(e.message);
    if (form.id === 'coordinator-form' && $('#coord-status')) $('#coord-status').textContent = e.message;
  } finally { if (submit) submit.disabled = false; }
});
$('#search').addEventListener('input', e => { search = e.target.value; renderSidebar(); });
$('#group-by').addEventListener('change', e => { grouping = e.target.value; renderSidebar(); });
document.addEventListener('dragstart', e => {
  const row = e.target.closest('[data-session][draggable]');
  if (!row) return;
  draggedSession = row.dataset.session; e.dataTransfer.setData('text/plain', draggedSession);
  e.dataTransfer.effectAllowed = 'move'; document.body.classList.add('dragging-agent');
});
document.addEventListener('dragend', () => { draggedSession = null; document.body.classList.remove('dragging-agent'); document.querySelectorAll('.drop-active').forEach(e => e.classList.remove('drop-active')); });
document.addEventListener('dragover', e => { const team = e.target.closest('[data-drop-team]'); if (team && draggedSession) { e.preventDefault(); team.classList.add('drop-active'); } });
document.addEventListener('dragleave', e => { e.target.closest('[data-drop-team]')?.classList.remove('drop-active'); });
document.addEventListener('drop', async e => {
  const team = e.target.closest('[data-drop-team]');
  if (!team || !draggedSession) return;
  e.preventDefault(); const id = draggedSession; team.classList.remove('drop-active'); document.body.classList.remove('dragging-agent');
  try { await api('/sessions/' + id, 'PATCH', { group: team.dataset.dropTeam }); await refresh(); toast('Agent joined ' + team.dataset.dropTeam + '.'); } catch (error) { toast(error.message); }
  draggedSession = null;
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'n') { event.preventDefault(); newSession(); }
});
$('#dialog').addEventListener('click', event => { if (event.target === $('#dialog')) { const b = event.target.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) event.target.close(); } });
await refresh();
setInterval(() => refresh(), 8000);
