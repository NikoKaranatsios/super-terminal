import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { createStore, dataDir, home, shell, env, socket, tmux, tmuxRun, which, quote, text, localDirectory, repository, validHost, ensureContext } from './core.mjs';
import { History, EnvironmentHistory, publicHistory, matchHistory } from './history.mjs';
import { tmuxSessions, externalTerminals, scanRemote, remoteRead } from './discovery.mjs';
import { AgentBrowsers } from './browsers.mjs';
import { performAction } from './conductor-actions.mjs';
import { Coordinator } from './coordinator.mjs';
import { ActivityMonitor } from './activity.mjs';
import { allowedHosts, connections, defaultPrompt, prepareBridge, startupPrompt, publicSession } from './agent-platform.mjs';
import { parseTopics, workProgress, resolveScope, scopeContext, canCommunicate, carryProjects, mergeProjects, wrapSummary } from './work-sessions.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 4317);
const token = randomBytes(32).toString('hex');
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const origins = new Set([...hosts].map(h => `http://${h}`));
const store = createStore();
store.state.hosts = [...allowedHosts];
store.state.messages ||= [];
store.state.teams ||= [];
store.state.projects ||= [];
store.state.lifecycle ||= {};
store.state.workSessions ||= [];
store.state.prompts ||= Object.fromEntries(['codex', 'claude', 'grok'].map(p => [p, defaultPrompt]));
store.save();
const remoteCache = new Map();
const history = new EnvironmentHistory(new History(), remoteCache, remoteRead);
store.state.preferences ||= { fontSize: 13, automaticBriefing: true };
store.state.preferences.notifyOnFinish ??= true;
const activity = new ActivityMonitor(store);
const browsers = new AgentBrowsers();
const coordinator = new Coordinator(store);
coordinator.liveReader = liveSessions;
coordinator.actionHandler = action => performAction(action, { store, liveSessions, createSession, allowedHosts, sendMessage, history, invalidate: () => { externalTime = 0; for(const host of allowedHosts) refreshRemote(host); } });
const attachments = new Set();
const providers = ['codex', 'claude', 'grok', 'shell'];
const app = express();
const server = http.createServer(app);
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin))) return res.status(403).send('Local access only');
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  });
  next();
});
app.use(express.json({ limit: '256kb' }));
app.get('/desktop-health', (req, res) => res.json({
  product: 'super-terminal', protocol: 1,
  dataKey: createHash('sha256').update(path.resolve(dataDir)).digest('hex')
}));
function authorized(value) {
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
app.use('/api', (req, res, next) => {
  if (req.path === '/agent' && req.method === 'POST') {
    req.agent = store.state.sessions.find(s => s.agentToken && s.agentToken === req.headers['x-super-terminal-agent']);
    if (req.agent) return next();
  }
  return authorized(req.headers['x-super-terminal']) ? next() : res.status(403).json({ error: 'Reload Super Terminal to reconnect.' });
});
app.get('/', (req, res) => res.type('html').send(fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8').replace('__TOKEN__', token)));
app.use(express.static(path.join(root, 'dist'), { index: false }));
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

let externalCache = [], externalTime = 0;
async function liveSessions() {
  const [own, defaults] = await Promise.all([tmuxSessions(), tmuxSessions(null)]);
  const live = store.state.sessions.map(s => {
    const pane = own.find(t => t.name === s.tmuxName);
    const connectionLost = s.host !== 'local' && pane && pane.command !== 'ssh';
    const remotePane = remoteCache.get(s.host)?.sessions.find(t => t.title === s.tmuxName);
    return { ...publicSession(s), connectionLost: !!connectionLost, status: pane ? (pane.dead ? 'exited' : connectionLost ? 'disconnected' : 'running') : 'stopped', command: pane?.command, tty: pane?.tty, provider: s.host === 'local' || connectionLost ? (['codex','claude','grok'].includes(pane?.command) ? pane.command : 'shell') : remotePane?.provider || s.provider };
  });
  const imported = defaults.map(t => ({
    id: `tmux:${t.pane}`, kind: 'tmux', provider: ['codex', 'claude', 'grok'].includes(t.command) ? t.command : 'shell',
    title: `${t.name} · ${t.pane}`, cwd: t.cwd, host: 'local', group: path.basename(repository(t.cwd) || t.cwd) || 'Loose sessions',
    target: t.target, pane: t.pane, tty: t.tty, status: t.dead ? 'exited' : 'running'
  }));
  if (Date.now() - externalTime > 7000) {
    externalCache = await externalTerminals([...own, ...defaults].map(t => t.tty));
    externalTime = Date.now();
  }
  const remote = [...remoteCache.values()].flatMap(r => [
    ...r.sessions.filter(p => !live.some(s => s.host === p.host && s.tmuxName === p.title && ['running','paused'].includes(s.status) && !s.connectionLost)),
    ...r.processes
  ]);
  const rows = await history.all();
  return [...live, ...imported, ...externalCache, ...remote].map(s => { const { files, ...publicRow } = s; return { ...publicRow, ...store.state.assignments?.[s.id], status: s.kind !== 'external' && store.state.lifecycle[s.id] === 'paused' && ['running','external','paused'].includes(s.status) ? 'paused' : s.status, historyId: matchHistory(s, rows), linkedHistory: rows.filter(r => r.host === s.host && r.provider === s.provider && s.files?.includes(r.file)).map(r => r.id), historyMatch: s.resumeId || s.files?.length || s.historyId ? 'file-or-id' : 'start-time' };  });
}
app.get('/api/state', route(async (req, res) => {
  const [sessions, conversations] = await Promise.all([liveSessions(), history.all(req.query.refresh === '1')]);
  res.json({
    sessions, history: conversations.map(publicHistory), hosts: store.state.hosts, hostNames: Object.fromEntries(connections.map(c => [c.target, c.name])),
    remote: allowedHosts.map(host => { const r = remoteCache.get(host); return { host, scannedAt: r?.scannedAt, error: r?.error, scanning: scanTasks.has(host), historyCount: r?.history?.length || 0, elevatedRead: r?.elevatedRead || false }; }),
    preferences: store.state.preferences, activity: store.state.activity,
    home, defaultCwd: path.join(home, 'Projects'), prompts: store.state.prompts,
    coordinator: coordinator.status(), messages: store.state.messages.slice(-100),
    teams: store.state.teams, projects: store.state.projects,
    workSessions: store.state.workSessions.map(s => ({ ...s, progress: workProgress(s) })),
    browsers: [...browsers.contexts.keys()],
    providers: providers.map(id => ({ id, available: id === 'shell' || !!which(id) })),
    tmuxAvailable: !!tmux, warnings: history.warnings
  });
}));
app.get('/api/messages', (req, res) => res.json(store.state.messages.filter(m => !req.query.group || m.group === req.query.group)));
app.get('/api/activity', (req, res) => res.json({ events: store.state.activity, enabled: store.state.preferences.notifyOnFinish }));
app.get('/api/history/:id', route(async (req, res) => res.json(await history.transcript(req.params.id))));

async function createSession(body) {
  let provider = body.provider || 'shell';
  if (!providers.includes(provider)) throw new Error('Unknown agent.');
  let original = body.historyId ? await history.get(body.historyId) : null;
  if (body.historyId && !original) throw new Error('Conversation not found.');
  if (original) {
    provider = original.provider;
    const previous = store.state.sessions.find(s => s.historyId === original.id);
    if (previous && (await tmuxSessions()).some(t => t.name === previous.tmuxName)) return publicSession(previous);
  }
  const host = original?.host || (body.host && body.host !== 'local' ? validHost(body.host) : 'local');
  if (host !== 'local' && !allowedHosts.includes(host)) throw new Error('This SSH connection is not enabled in your local connections.json.');
  if (original && body.host && body.host !== original.host) throw new Error('Resume a conversation in its original environment.');
  const cwd = host === 'local' ? localDirectory(body.cwd || original?.cwd || home) : text(body.cwd || original?.cwd || '~', 2000);
  const repo = host === 'local' ? repository(cwd) : null;
  const group = text(body.group || original?.group || path.basename(repo || cwd) || 'Loose sessions', 120);
  const title = text(body.title || original?.title || `${provider === 'shell' ? 'Terminal' : provider} · ${path.basename(cwd)}`, 200);
  const id = randomUUID();
  const tmuxName = `st-${id.slice(0, 12)}`;
  const session = { id, remoteUser: host !== 'local' ? original?.owner || null : null, projectId: store.state.projects.some(p => p.id === body.projectId) ? body.projectId : null, kind: 'managed', provider, host, cwd, group, title, role: text(body.role || '', 100), tmuxName, historyId: original?.id || null, createdAt: new Date().toISOString(), status: 'running', agentToken: randomBytes(32).toString('hex') };
  session.scope = resolveScope(store.state.workSessions, body.scope);
  const bridge = await prepareBridge(session, root, port);
  const team = store.state.teams.find(t => t.name === group);
  let task = typeof body.task === 'string' && body.task.trim() ? body.task.slice(0, 12000) : team?.mission || '';
  if (session.scope) task += `\n\nAssignment scope:\n${JSON.stringify(scopeContext(store.state.workSessions, session.scope), null, 2)}\nWork at your assigned layer: session-level agents coordinate the whole session, project-level agents own project outcomes, and goal-level agents focus on that goal. Coordinate with peers before overlapping edits. Report completed work and blockers through the mailbox; never mark success without verification.`;
  const role = typeof body.prompt === 'string' ? body.prompt.slice(0, 12000) : store.state.prompts[provider] || defaultPrompt;
  const prompt = startupPrompt(session, bridge, role, task);
  let command;
  if (host === 'local') {
    const bin = provider === 'shell' ? shell : which(provider);
    if (!bin) throw new Error(`${provider} is not installed or is missing from PATH.`);
    const args = provider === 'shell' ? ['-l'] : original ? (provider === 'codex' ? ['resume', original.sessionId, prompt] : ['--resume', original.sessionId, prompt]) : [prompt];
    command = [bin, ...args].map(quote).join(' ');
  } else {
    const dir = cwd === '~' ? '"$HOME"' : cwd.startsWith('~/') ? `"$HOME"/${quote(cwd.slice(2))}` : quote(cwd);
    const resumeArgs = original ? (provider === 'codex' ? ['resume', original.sessionId, prompt] : ['--resume', original.sessionId, prompt]) : [prompt];
    const agentCommand = provider === 'shell' ? 'exec "${SHELL:-/bin/sh}" -l' : `exec ${[provider, ...resumeArgs].map(quote).join(' ')}`;
    const remoteCommand = `export SUPER_TERMINAL_AGENT_CONFIG=${quote(bridge.configPath)}; exec "\${SHELL:-/bin/sh}" -lc ${quote(agentCommand)}`;
    const remoteScriptBody = `cd ${dir} || exit; if command -v tmux >/dev/null 2>&1; then exec tmux new-session -A -s ${quote(tmuxName)} ${quote(remoteCommand)}; else ${remoteCommand}; fi`;
    const remoteScript = session.remoteUser ? `sudo -n -u ${quote(session.remoteUser)} sh -lc ${quote(remoteScriptBody)}` : remoteScriptBody;
    command = ['ssh', '-tt', '-o', 'ConnectTimeout=10', ...bridge.sshArgs, host, remoteScript].map(quote).join(' ');
    if (!store.state.hosts.includes(host)) store.state.hosts.push(host);
  }
  const contextFile = ensureContext(group);
  const launch = `${command}; printf '\\n[Session finished. You are now in a shell.]\\n'; exec ${quote(shell)} -l`;
  await tmuxRun(['new-session', '-d', '-s', tmuxName, '-c', host === 'local' ? cwd : home, '-x', '140', '-y', '40',
    '-e', `SUPER_TERMINAL_CONTEXT=${contextFile}`, '-e', `SUPER_TERMINAL_GROUP=${group}`, '-e', `SUPER_TERMINAL_AGENT_CONFIG=${bridge.configPath}`,
    [shell, '-lc', launch].map(quote).join(' ')]);
  await tmuxRun(['set-option', '-t', tmuxName, 'status', 'off']);
  await tmuxRun(['set-option', '-t', tmuxName, 'mouse', 'on']);
  await tmuxRun(['set-option', '-t', tmuxName, 'history-limit', '50000']);
  store.state.sessions.push(session);
  store.save();
  return publicSession(session);
}
app.post('/api/sessions', route(async (req, res) => res.json(await createSession(req.body))));
app.patch('/api/sessions/:id', route(async (req, res) => {
  const session = store.state.sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (req.body.title !== undefined) session.title = text(req.body.title, 200);
  if (req.body.group !== undefined) {
    session.group = text(req.body.group, 120); ensureContext(session.group);
    const team = store.state.teams.find(t => t.name === session.group);
    if (team?.scope) session.scope = resolveScope(store.state.workSessions, team.scope);
    if (team?.mission) sendMessage('you', session.id, `You have joined team "${team.name}". Shared mission:\n${team.mission}\nCheck peers and context for your scope. Coordinate ownership before starting overlapping work. Preserve your current work and normal approval requirements.`, team.name);
  }
  if (req.body.role !== undefined) session.role = text(req.body.role, 100);
  if (req.body.scope !== undefined) {
    session.scope = resolveScope(store.state.workSessions, req.body.scope);
    if (session.scope) sendMessage('you', session.id, `Your working-session assignment:\n${JSON.stringify(scopeContext(store.state.workSessions, session.scope), null, 2)}\nCheck peers and coordinate before overlapping edits. Preserve current work and normal permissions.`, session.group);
  }
  store.save(); res.json(publicSession(session));
}));
app.delete('/api/sessions/:id', route(async (req, res) => {
  const session = store.state.sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const exists = (await tmuxSessions()).some(t => t.name === session.tmuxName);
  if (exists) await tmuxRun(['kill-session', '-t', session.tmuxName]);
  await browsers.action(session.id, { action: 'close' });
  store.state.sessions = store.state.sessions.filter(s => s.id !== session.id);
  store.save(); res.json({ ok: true });
}));
app.post('/api/hosts', route(async (req, res) => {
  const host = validHost(req.body.host);
  if (!allowedHosts.includes(host)) throw new Error('This SSH connection is not enabled in your local connections.json.');
  if (!store.state.hosts.includes(host)) store.state.hosts.push(host);
  store.save(); res.json({ host });
}));
app.put('/api/prompts', route(async (req, res) => {
  for (const provider of ['codex', 'claude', 'grok']) {
    if (typeof req.body[provider] === 'string' && req.body[provider].length <= 12000) store.state.prompts[provider] = req.body[provider];
  }
  store.save(); res.json({ ok: true });
}));
app.post('/api/work-sessions', route(async (req, res) => {
  const title = text(req.body.title || `Work session · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, 200);
  let projects = parseTopics(req.body.topics || '', await history.all());
  const previous = store.state.workSessions.find(s => s.id === req.body.carryFrom);
  if (previous) projects = mergeProjects(carryProjects(previous), projects);
  for (const s of store.state.workSessions) if (s.status === 'active') s.status = 'paused';
  const session = { id: randomUUID(), title, status: 'active', startedAt: new Date().toISOString(), endedAt: null, notes: '', summary: '', projects };
  store.state.workSessions.push(session); store.save(); res.json(session);
}));
app.patch('/api/work-sessions/:id', route(async (req, res) => {
  const session = store.state.workSessions.find(s => s.id === req.params.id);
  if (!session) throw new Error('Working session not found.');
  if (req.body.title !== undefined) session.title = text(req.body.title, 200);
  if (req.body.notes !== undefined) {
    if (typeof req.body.notes !== 'string' || req.body.notes.length > 12000) throw new Error('Session notes are limited to 12,000 characters.');
    session.notes = req.body.notes;
  }
  if (req.body.status === 'active') {
    for (const s of store.state.workSessions) if (s.status === 'active') s.status = 'paused';
    session.status = 'active'; session.endedAt = null;
  } else if (req.body.status === 'wrapped') {
    session.status = 'wrapped'; session.endedAt = new Date().toISOString(); session.summary = wrapSummary(session);
  } else if (req.body.status === 'paused') session.status = 'paused';
  store.save(); res.json(session);
}));
app.post('/api/work-sessions/:id/projects', route(async (req, res) => {
  const session = store.state.workSessions.find(s => s.id === req.params.id);
  if (!session) throw new Error('Working session not found.');
  const name = text(req.body.name, 120);
  if (!name) throw new Error('Project name is required.');
  const host = req.body.host && req.body.host !== 'local' ? validHost(req.body.host) : 'local';
  if (host !== 'local' && !allowedHosts.includes(host)) throw new Error('This SSH host is not configured.');
  const cwd = host === 'local' ? localDirectory(req.body.cwd || home) : text(req.body.cwd || '~', 2000);
  const project = { id: randomUUID(), name, host, cwd, goals: [] };
  session.projects.push(project); store.save(); res.json(project);
}));
app.patch('/api/work-sessions/:id/projects/:projectId', route(async (req, res) => {
  const project = store.state.workSessions.find(s => s.id === req.params.id)?.projects.find(p => p.id === req.params.projectId);
  if (!project) throw new Error('Project not found.');
  const host = req.body.host && req.body.host !== 'local' ? validHost(req.body.host) : 'local';
  if (host !== 'local' && !allowedHosts.includes(host)) throw new Error('This SSH host is not configured.');
  project.host = host;
  project.cwd = host === 'local' ? localDirectory(req.body.cwd || home) : text(req.body.cwd || '~', 2000);
  store.save(); res.json(project);
}));
app.post('/api/work-sessions/:id/goals', route(async (req, res) => {
  const session = store.state.workSessions.find(s => s.id === req.params.id);
  const project = session?.projects.find(p => p.id === req.body.projectId);
  if (!project) throw new Error('Project not found.');
  const title = text(req.body.title, 800);
  if (!title) throw new Error('Goal title is required.');
  const goal = { id: randomUUID(), title, status: 'todo', notes: '' };
  project.goals.push(goal); store.save(); res.json(goal);
}));
app.patch('/api/work-sessions/:id/goals/:goalId', route(async (req, res) => {
  const session = store.state.workSessions.find(s => s.id === req.params.id);
  const goal = session?.projects.flatMap(p => p.goals).find(g => g.id === req.params.goalId);
  if (!goal) throw new Error('Goal not found.');
  if (req.body.status !== undefined) {
    if (!['todo', 'doing', 'done'].includes(req.body.status)) throw new Error('Invalid progress status.');
    goal.status = req.body.status;
  }
  if (req.body.notes !== undefined) {
    if (typeof req.body.notes !== 'string' || req.body.notes.length > 6000) throw new Error('Goal notes are limited to 6,000 characters.');
    goal.notes = req.body.notes;
  }
  store.save(); res.json(goal);
}));
app.post('/api/teams', route(async (req, res) => {
  const name = text(req.body.name, 120);
  if (!name) throw new Error('Give the team a name.');
  if (store.state.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) throw new Error('A team with this name already exists.');
  const host = req.body.host && req.body.host !== 'local' ? validHost(req.body.host) : 'local';
  if (host !== 'local' && !allowedHosts.includes(host)) throw new Error('This SSH host is not configured.');
  const cwd = host === 'local' ? localDirectory(req.body.cwd || home) : text(req.body.cwd || '~', 2000);
  if (typeof req.body.mission !== 'string' || req.body.mission.length > 12000) throw new Error('A mission can contain up to 12,000 characters.');
  const team = { id: randomUUID(), name, mission: req.body.mission, cwd, host, scope: resolveScope(store.state.workSessions, req.body.scope), createdAt: new Date().toISOString() };
  store.state.teams.push(team); ensureContext(name); store.save();
  res.json(team);
}));
app.patch('/api/teams/:id', route(async (req, res) => {
  const team = store.state.teams.find(t => t.id === req.params.id);
  if (!team) throw new Error('Team not found.');
  if (typeof req.body.mission !== 'string' || req.body.mission.length > 12000) throw new Error('A mission can contain up to 12,000 characters.');
  team.mission = req.body.mission; store.save(); res.json(team);
}));
app.post('/api/teams/:id/brief', route(async (req, res) => {
  const team = store.state.teams.find(t => t.id === req.params.id);
  if (!team?.mission.trim()) throw new Error('Add a mission first.');
  const members = store.state.sessions.filter(s => s.group === team.name);
  for (const member of members) sendMessage('you', member.id, `Team "${team.name}" briefing:\n${team.mission}\nYour role: ${member.role || 'Collaborator'}. Coordinate with peers through the mailbox. Confirm ownership before editing overlapping files, report blockers, and preserve normal approval requirements.`, team.name);
  res.json({ count: members.length });
}));
app.post('/api/teams/:id/start', route(async (req, res) => {
  const team = store.state.teams.find(t => t.id === req.params.id);
  if (!team?.mission.trim()) throw new Error('Add a mission first.');
  if (!Array.isArray(req.body.roles) || req.body.roles.length < 1 || req.body.roles.length > 6) throw new Error('Choose between one and six agents.');
  const roles = req.body.roles.map(r => ({ name: text(r.name, 100), provider: text(r.provider, 20), assignment: typeof r.assignment === 'string' ? r.assignment.slice(0, 4000) : '' }));
  if (roles.some(r => !r.name || !providers.includes(r.provider))) throw new Error('Each agent needs a role and an installed provider.');
  const existing = await tmuxSessions();
  if (store.state.sessions.some(s => s.group === team.name && roles.some(r => r.name === s.role) && existing.some(t => t.name === s.tmuxName))) throw new Error('An agent with one of these roles is already running. Give new agents different roles.');
  const launched = [], errors = [];
  for (const role of roles) {
    try {
      launched.push(await createSession({ provider: role.provider, host: team.host, cwd: team.cwd, group: team.name, title: `${team.name} / ${role.name}`, role: role.name, scope: team.scope,
        task: `Shared team mission:\n${team.mission}\n\nYour role: ${role.name}.\n${role.assignment}\nUse the platform mailbox to agree on ownership, share progress, and hand off work. Check peers before editing files. Do not spawn extra agents unless the user requests them.` }));
    } catch (error) { errors.push({ role: role.name, error: error.message }); }
  }
  res.json({ launched, errors });
}));
function sendMessage(from, to, message, group) {
  if (typeof message !== 'string' || !message.trim() || message.length > 12000) throw new Error('Messages must contain 1–12,000 characters.');
  if (to !== 'coordinator' && !store.state.sessions.some(s => s.id === to)) throw new Error('Recipient not found.');
  const row = { id: randomUUID(), from, to, text: message, group, createdAt: new Date().toISOString(), read: false };
  store.state.messages.push(row);
  store.state.messages = store.state.messages.slice(-2000);
  store.save(); return row;
}
app.post('/api/messages', route(async (req, res) => {
  const to = store.state.sessions.find(s => s.id === req.body.to);
  res.json(sendMessage('you', req.body.to, req.body.message, to?.group || 'All sessions'));
}));
app.post('/api/agent', route(async (req, res) => {
  const agent = req.agent;
  if (!agent) return res.status(403).json({ error: 'Agent credential required.' });
  const b = req.body;
  if (b.command === 'peers') return res.json({ self: agent.id, peers: store.state.sessions.filter(s => s.id !== agent.id && canCommunicate(agent, s)).map(({ id, title, provider, host, group, scope, role }) => ({ id, title, provider, host, group, scope, role })), coordinator: 'coordinator' });
  if (b.command === 'inbox') {
    const messages = store.state.messages.filter(m => m.to === agent.id && !m.read).slice(-50);
    for (const m of messages) m.read = true;
    store.save(); return res.json({ messages });
  }
  if (b.command === 'send') {
    const target = store.state.sessions.find(s => s.id === b.to);
    if (b.to !== 'coordinator' && (!target || !canCommunicate(agent, target))) throw new Error('Peers must share your group or working session. Ask the user to assign the sessions for cross-project handoffs.');
    return res.json(sendMessage(agent.id, b.to, b.message, agent.group));
  }
  if (b.command === 'context') return res.json({ group: agent.group, scope: scopeContext(store.state.workSessions, agent.scope), mission: store.state.teams.find(t => t.name === agent.group)?.mission || '', content: fs.readFileSync(ensureContext(agent.group), 'utf8') });
  if (b.command === 'progress') {
    const working = store.state.workSessions.find(s => s.id === agent.scope?.workSessionId);
    if (!working) throw new Error('Ask the user to assign you to a working session first.');
    const goalId = b.goal || agent.scope.goalId;
    const project = working.projects.find(p => p.goals.some(g => g.id === goalId));
    const goal = project?.goals.find(g => g.id === goalId);
    if (!goal || (agent.scope.projectId && project.id !== agent.scope.projectId) || (agent.scope.goalId && goal.id !== agent.scope.goalId)) throw new Error('That goal is outside your assigned scope.');
    if (!['todo', 'doing', 'done'].includes(b.status)) throw new Error('Choose todo, doing, or done.');
    if (b.status === 'done' && !b.notes?.trim()) throw new Error('Include a concise verification note when marking a goal done.');
    if (b.notes !== undefined && b.notes !== null && (typeof b.notes !== 'string' || b.notes.length > 6000)) throw new Error('Notes must be text of up to 6,000 characters.');
    goal.status = b.status;
    if (b.notes) goal.notes = b.notes;
    sendMessage(agent.id, 'coordinator', `${project.name} / ${goal.title}: ${goal.status}${goal.notes ? '\n' + goal.notes : ''}`, agent.group);
    store.save(); return res.json(goal);
  }
  if (b.command === 'browser') return res.json(await browsers.action(agent.id, b));
  throw new Error('Unknown agent command.');
}));
app.post('/api/browser/:id', route(async (req, res) => {
  if (!store.state.sessions.some(s => s.id === req.params.id)) throw new Error('A managed agent session is required.');
  res.json(await browsers.action(req.params.id, req.body));
}));
app.post('/api/coordinator', route(async (req, res) => {
  if (coordinator.running) throw new Error('The coordinator is already running.');
  const group = req.body.group ? text(req.body.group, 120) : '';
  const workSessionId = req.body.workSessionId ? text(req.body.workSessionId, 80) : '';
  if (workSessionId && !store.state.workSessions.some(s => s.id === workSessionId)) throw new Error('Working session not found.');
  const live = await liveSessions();
  res.json(await coordinator.ask(req.body.prompt, group, live, history, workSessionId, req.body.automatic === true, req.body.environment === 'local' || allowedHosts.includes(req.body.environment) ? req.body.environment : 'local'));
}));
app.post('/api/coordinator/cancel', (req, res) => { coordinator.cancel(); res.json({ ok: true }); });
const scanTasks = new Map();
async function refreshRemote(host, forceIndex = false) {
  if (!allowedHosts.includes(host)) throw new Error('This SSH connection is not enabled.');
  if (scanTasks.has(host)) return scanTasks.get(host);
  const previous = remoteCache.get(host);
  const withIndex = forceIndex || !previous?.indexedAt || Date.now() - previous.indexedAt > 60000;
  const task = scanRemote(host, withIndex).then(result => {
    remoteCache.set(host, { ...result, history: result.history || previous?.history || [], indexedAt: withIndex ? Date.now() : previous?.indexedAt });
    return { host, scannedAt: result.scannedAt };
  }).catch(error => {
    // Retain history, but never show an unreachable host's old processes as currently running.
    remoteCache.set(host, { host, sessions: [], processes: [], history: previous?.history || [], indexedAt: previous?.indexedAt, scannedAt: previous?.scannedAt, error: error.message.slice(0, 300) });
    return { host, error: error.message };
  }).finally(() => scanTasks.delete(host));
  scanTasks.set(host, task); return task;
}
app.post('/api/hosts/scan', route(async (req, res) => res.json(await refreshRemote(validHost(req.body.host), true))));
app.put('/api/preferences', route(async (req, res) => {
  if (req.body.fontSize !== undefined) {
    const size = Number(req.body.fontSize);
    if (!Number.isInteger(size) || size < 10 || size > 22) throw new Error('Text size must be between 10 and 22.');
    store.state.preferences.fontSize = size;
  }
  if (typeof req.body.automaticBriefing === 'boolean') store.state.preferences.automaticBriefing = req.body.automaticBriefing;
  if (typeof req.body.notifyOnFinish === 'boolean') store.state.preferences.notifyOnFinish = req.body.notifyOnFinish;
  store.save(); res.json(store.state.preferences);
}));
app.get('/api/context', route(async (req, res) => {
  const group = text(req.query.group, 120);
  const file = ensureContext(group);
  res.json({ group, path: file, content: fs.readFileSync(file, 'utf8') });
}));
app.put('/api/context', route(async (req, res) => {
  const group = text(req.body.group, 120);
  if (typeof req.body.content !== 'string' || req.body.content.length > 100000) throw new Error('Notes are limited to 100,000 characters.');
  const file = ensureContext(group);
  fs.writeFileSync(file + '.tmp', req.body.content, { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  res.json({ ok: true, path: file });
}));

const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
server.on('upgrade', (req, raw, head) => {
  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${port}`); } catch { return raw.destroy(); }
  if (!hosts.has(req.headers.host) || !origins.has(req.headers.origin) || url.pathname !== '/terminal' || !authorized(url.searchParams.get('token'))) {
    raw.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return raw.destroy();
  }
  wss.handleUpgrade(req, raw, head, ws => wss.emit('connection', ws, url));
});
wss.on('connection', async (ws, url) => {
  let terminal, heartbeat;
  const send = payload => { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); };
  try {
    const id = url.searchParams.get('id');
    const managed = store.state.sessions.find(s => s.id === id);
    let bin = tmux, args;
    if (managed) {
      if (!(await tmuxSessions()).some(t => t.name === managed.tmuxName)) throw new Error('This terminal has stopped. Launch a new terminal or resume its conversation.');
      args = ['-L', socket, 'attach-session', '-t', managed.tmuxName];
    } else if (id?.startsWith('tmux:')) {
      const pane = (await tmuxSessions(null)).find(t => `tmux:${t.pane}` === id);
      if (!pane) throw new Error('This tmux pane no longer exists.');
      await tmuxRun(['select-window', '-t', pane.pane], null);
      await tmuxRun(['select-pane', '-t', pane.pane], null);
      args = ['attach-session', '-t', pane.target];
    } else {
      const remote = [...remoteCache.values()].flatMap(r => r.sessions).find(r => r.id === id);
      if (!remote) throw new Error('Terminal not found. Refresh the sidebar.');
      bin = which('ssh');
      const remoteTmux = remote.requiresSudo ? `sudo -n -u ${quote(remote.owner)} tmux` : 'tmux';
      args = ['-tt', '-o', 'ConnectTimeout=10', remote.host, `${remoteTmux} select-window -t ${quote(remote.pane)}; ${remoteTmux} select-pane -t ${quote(remote.pane)}; exec ${remoteTmux} attach-session -t ${quote(remote.target)}`];
    }
    if (ws.readyState !== 1) return;
    terminal = pty.spawn(bin, args, { name: 'xterm-256color', cols: 120, rows: 35, cwd: home, env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } });
    attachments.add(terminal);
    terminal.onData(data => {
      if (ws.bufferedAmount > 4 * 1024 * 1024) { ws.close(1013, 'Reconnect to catch up'); return; }
      send({ type: 'output', data });
    });
    terminal.onExit(({ exitCode }) => {
      attachments.delete(terminal);
      send({ type: 'exit', exitCode });
      ws.close(1000);
    });
    send({ type: 'ready' });
    ws.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 65536) terminal.write(message.data);
        else if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
          terminal.resize(Math.min(500, Math.max(20, message.cols)), Math.min(200, Math.max(5, message.rows)));
        }
      } catch {}
    });
    let alive = true;
    ws.on('pong', () => { alive = true; });
    heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 30000);
  } catch (e) { send({ type: 'error', message: e.message }); ws.close(); }
  const cleanup = () => {
    clearInterval(heartbeat);
    if (terminal) { attachments.delete(terminal); try { terminal.kill(); } catch {} }
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});
app.use((err, req, res, next) => {
  if (err instanceof TypeError) console.error(`${req.method} ${req.path}: ${err.stack}`);
  const message = err.code === 'ENOENT' ? 'Working directory or command was not found.' : err.message;
  res.status(400).json({ error: message?.slice(0, 1500) || 'Something went wrong.' });
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Open http://127.0.0.1:${port} or set PORT to another port.` : error.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Super Terminal → http://127.0.0.1:${port}\nAgent sessions persist in tmux when this server stops.`);
  process.parentPort?.postMessage({ type: 'ready', port });
  if (process.env.SUPER_TERMINAL_TEST !== '1') {
    for (const host of allowedHosts) refreshRemote(host);
    const scanTimer = setInterval(() => { if (!stopping) for (const host of allowedHosts) refreshRemote(host); }, 20000);
    scanTimer.unref();
    let checking = false;
    const checkActivity = async () => {
      if (checking || stopping) return; checking = true;
      try {
        const [rows, sessions] = await Promise.all([history.all(), liveSessions()]);
        activity.histories('local', rows.filter(r => r.host === 'local'));
        activity.processes('local', sessions);
        for (const host of allowedHosts) {
          const remote = remoteCache.get(host);
          if (remote?.scannedAt && !remote.error) activity.histories(host, remote.history || []);
          activity.processes(host, sessions, !!remote?.scannedAt && !remote.error);
        }
      } finally { checking = false; }
    };
    checkActivity().catch(() => {});
    const activityTimer = setInterval(() => checkActivity().catch(() => {}), 5000); activityTimer.unref();
  }
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(0), 4000);
  for (const attachment of attachments) { try { attachment.kill(); } catch {} }
  for (const client of wss.clients) client.close();
  coordinator.cancel();
  await browsers.close();
  server.close(() => { clearTimeout(deadline); process.exit(0); });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
process.parentPort?.on('message', event => { if (event.data?.type === 'shutdown') stop(); });
