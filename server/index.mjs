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
import { performAction, launchTeamMembers } from './conductor-actions.mjs';
import { Coordinator, collectWork } from './coordinator.mjs';
import { validateAutonomousAction } from './conductor-policy.mjs';
import { ActivityMonitor } from './activity.mjs';
import { allowedHosts, connections, defaultPrompt, prepareBridge, startupPrompt, publicSession } from './agent-platform.mjs';
import { parseTopics, workProgress, resolveScope, scopeContext, canCommunicate, carryProjects, mergeProjects, wrapSummary, resolveLaunchLocation } from './work-sessions.mjs';
import { initializeTasks, createTask, updateTask, recordTaskEvent, taskSummary, taskDescendsFrom } from './tasks.mjs';
import { controlAgent, removeAgent } from './lifecycle.mjs';
import { classifyProjects, matchingAssignment, setProjectAssignment } from './project-classification.mjs';
import { projectOf, teamOf, peersAllowed, contextKey, agentScopeContext, messageVisible, contextTarget, allowedProjectIds, canReadProjectContent } from './project-access.mjs';
import { resolveFocus } from './user-focus.mjs';
import { validateConductorContent } from './conductor-access.mjs';

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
initializeTasks(store.state);
// Pin enrollment identity once; later filesystem discovery must not silently move it.
const initialProjects = classifyProjects(store.state,{sessions:store.state.sessions,history:[]},{discover:true,allowedHosts});
for (const row of initialProjects.sessions) {
  const session = store.state.sessions.find(s => s.id === row.id);
  if (!session.projectId && row.projectId && session.projectAssignment?.source !== 'manual') {
    session.contextProjectId = null; session.contextIsolation = 'restart-required'; session.projectId = row.projectId;
  }
  if (session.projectId && session.projectAssignment?.source !== 'manual') session.projectAssignment = {source:'assigned',reason:'enrollment-project',verified:true};
}
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
const invalidate = () => { externalTime = 0; if (process.env.SUPER_TERMINAL_TEST !== '1') for(const host of allowedHosts) refreshRemote(host); };
const lifecycleContext = { store, allowedHosts, closeBrowser: id => browsers.action(id, { action: 'close' }), invalidate };
coordinator.configure({ history, progressReader: async ({ observations }) => Promise.all(observations.filter(o => o.historyId).slice(0,3).map(async o => {
  try { const transcript = await history.transcript(o.historyId); return { observationId:o.id, summary:transcript.messages.slice(-3).map(m => `${m.role}: ${m.text}`).join('\n').slice(-3000) }; }
  catch { return { observationId:o.id, unavailable:true, summary:'Conversation is unavailable.' }; }
})) });
coordinator.actionHandler = async (action, metadata = {}) => {
  if (metadata.context?.projectScoped && action.type === 'cleanup' && (!action.target || !metadata.scope?.agentIds?.includes(action.target))) throw new Error('Project cleanup requires an agent in the selected project.');
  if (action.type === 'resume_conversation') {
    const original = await history.get(action.target);
    if (!original) throw new Error('Conversation not found.');
    metadata = {...metadata,historyProjectId:classifyProjects(store.state,{sessions:[],history:[original]},{discover:false,allowedHosts}).history[0].projectId};
    if (!metadata.historyProjectId) throw new Error('Classify this conversation into a project before resuming it through Conductor.');
  }
  validateConductorContent(store.state,action,metadata);
  if (metadata.autonomous) {
    if (coordinator.status().loop.state !== 'running') throw new Error('Continuous coordination has been paused or stopped.');
    validateAutonomousAction(store.state, action, collectWork(store.state, await liveSessions()).scope);
  }
  return performAction(action, { ...lifecycleContext, ...metadata, liveSessions, createSession, allowedHosts, sendMessage, promptAgent, updateAgent: (id, patch) => updateManagedAgent(id, patch, 'conductor'), history,
    notify: action => {
      const task = store.state.tasks.find(t => t.id === (action.taskId || action.target));
      const agent = store.state.sessions.find(s => s.id === action.target);
      return activity.notify({ title: action.title || action.name || 'Conductor', text: action.text || action.body, target: task ? 'task:' + task.id : action.target || 'conductor', host: agent?.host || 'local' });
    } });
};
const attachments = new Set();
const activityStatus = {lastCheckedAt:null,lastError:null,running:false};
function backgroundStatus() {
  const enabled = process.env.SUPER_TERMINAL_TEST !== '1';
  return {
    service:{state:stopping?'stopping':'running',survivesQuit:false},
    collection:{state:enabled?'running':'disabled',intervalMs:5000,...activityStatus},
    localDiscovery:{mode:'on-demand',cacheMs:7000,lastCollectedAt:externalTime ? new Date(externalTime).toISOString() : null},
    remoteDiscovery:{state:enabled && allowedHosts.length?'running':'disabled',intervalMs:20000,historyCacheMs:60000},
    interface:{intervalMs:5000}, notifications:{intervalMs:3000,enabled:store.state.preferences.notifyOnFinish},
    terminal:{mode:'event-driven',attachments:attachments.size}, browser:{mode:'on-demand',contexts:browsers.contexts.size}
  };
}
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
  product: 'super-terminal', protocol: 2, version: '0.6.0',
  dataKey: createHash('sha256').update(path.resolve(dataDir)).digest('hex')
}));
function authorized(value) {
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
app.use('/api', (req, res, next) => {
  if (req.path === '/agent' && req.method === 'POST') {
    req.agent = store.state.sessions.find(s => s.agentToken && s.agentToken === req.headers['x-super-terminal-agent'] && !s.enrollmentRevokedAt && s.status !== 'stopped' && store.state.lifecycle[s.id] !== 'stopped');
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
    target: t.target, pane: t.pane, tty: t.tty, serverIdentity: t.serverIdentity, processStartIdentity:t.processStartIdentity, pid:t.pid, startedAt:t.startedAt, status: t.dead ? 'exited' : 'running'
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
  const sessions = [...live, ...imported, ...externalCache, ...remote].map(s => {
    const { files, ...publicRow } = s;
    const assignment = s.kind === 'managed' ? null : matchingAssignment(store.state, s).assignment;
    const metadata = assignment ? Object.fromEntries(['projectId','taskId','teamId','scope','group'].filter(k => assignment[k] !== undefined).map(k => [k,assignment[k]])) : {};
    return { ...publicRow, ...metadata, status: s.kind !== 'external' && store.state.lifecycle[s.id] === 'paused' && ['running','external','paused'].includes(s.status) ? 'paused' : s.status, historyId:matchHistory(s,rows), linkedHistory:rows.filter(r => r.host === s.host && r.provider === s.provider && files?.includes(r.file)).map(r=>r.id), historyMatch:s.resumeId || files?.length || s.historyId ? 'file-or-id' : 'start-time' };
  });
  const classified = classifyProjects(store.state, {sessions,history:rows}, {discover:true,allowedHosts});
  let provenanceChanged=false; store.state.historyProvenance ||= {};
  for (const row of classified.sessions.filter(s => s.kind === 'managed' && s.historyId)) {
    const session=store.state.sessions.find(s=>s.id===row.id);
    const previous=store.state.historyProvenance[row.historyId] || [];
    const sources=[...new Set([...previous,...(session.contentProjectIds || []),session.contextProjectId,...allowedProjectIds(store.state,session)].filter(Boolean))].sort();
    if (JSON.stringify(previous)!==JSON.stringify(sources)) {store.state.historyProvenance[row.historyId]=sources;provenanceChanged=true;}
  }
  if (classified.changed || provenanceChanged) store.save();
  return classified.sessions.map(s => ({...s,capabilities:{mailbox:s.kind === 'managed' && !s.enrollmentRevokedAt && !s.contextIsolation && ['running','paused'].includes(s.status), terminalInput:s.kind !== 'external' && !['stopped','exited'].includes(s.status), continuationHistoryId:s.contextIsolation ? null : s.historyId || null, assignProject:true}}));
}
app.get('/api/state', route(async (req, res) => {
  const [sessions, conversations] = await Promise.all([liveSessions(), history.all(req.query.refresh === '1')]);
  res.json({
    sessions, history: classifyProjects(store.state,{sessions:[],history:conversations},{discover:false,allowedHosts}).history.map(publicHistory), hosts: store.state.hosts, hostNames: Object.fromEntries(connections.map(c => [c.target, c.name])),
    remote: allowedHosts.map(host => { const r = remoteCache.get(host); return { host, scannedAt: r?.scannedAt, error: r?.error, scanning: scanTasks.has(host), historyCount: r?.history?.length || 0, elevatedRead: r?.elevatedRead || false }; }),
    preferences: store.state.preferences, activity: store.state.activity,
    home, defaultCwd: path.join(home, 'Projects'), prompts: store.state.prompts,
    coordinator: coordinator.status(), messages: store.state.messages.slice(-100), background:backgroundStatus(),
    teams: store.state.teams, projects: store.state.projects, tasks: store.state.tasks,
    workSessions: store.state.workSessions.map(s => ({ ...s, progress: workProgress(s) })),
    browsers: [...browsers.contexts.keys()],
    providers: providers.map(id => ({ id, available: id === 'shell' || !!which(id) })),
    tmuxAvailable: !!tmux, warnings: history.warnings
  });
}));
app.get('/api/messages', (req, res) => res.json(store.state.messages.filter(m => (!req.query.group || m.group === req.query.group) && (!req.query.agentId || m.to === req.query.agentId || m.from === req.query.agentId)).slice(-200)));
app.get('/api/activity', (req, res) => res.json({ events: store.state.activity, enabled: store.state.preferences.notifyOnFinish }));
app.get('/api/history/:id', route(async (req, res) => res.json(await history.transcript(req.params.id, req.query.cursor))));
app.get('/api/tasks', (req, res) => res.json(taskSummary(store.state, { projectId: req.query.projectId, workSessionId: req.query.workSessionId })));
app.post('/api/tasks', route(async (req, res) => { const task = createTask(store.state, req.body); store.save(); res.json(task); }));
app.patch('/api/tasks/:id', route(async (req, res) => { const task = updateTask(store.state, req.params.id, req.body); store.save(); res.json(task); }));

const launchLocks = new Map();
async function createSession(body) {
  const key = body.taskId || (!body.role && (body.scope?.goalId || body.goalId)) || body.historyId;
  if (!key) return createSessionUnlocked(body);
  const previous = launchLocks.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => createSessionUnlocked(body));
  launchLocks.set(key, operation);
  try { return await operation; } finally { if (launchLocks.get(key) === operation) launchLocks.delete(key); }
}
async function createSessionUnlocked(body) {
  let provider = body.provider || 'shell';
  if (!providers.includes(provider)) throw new Error('Unknown agent.');
  let original = body.historyId ? await history.get(body.historyId) : null;
  if (body.historyId && !original) throw new Error('Conversation not found.');
  if (original) {
    provider = original.provider;
    const originProject = classifyProjects(store.state,{sessions:[],history:[original]},{discover:true,allowedHosts}).history[0].projectId;
    const requested = body.projectId || store.state.tasks.find(t=>t.id===body.taskId)?.projectId;
    if (requested && requested !== originProject) throw new Error('A conversation cannot move into another project. Start a fresh agent.');
    const previous = store.state.sessions.find(s => s.historyId === original.id);
    if (previous && (await tmuxSessions()).some(t => t.name === previous.tmuxName)) {
      if (body.task?.trim()) await promptAgent(previous.id, body.task, 'you');
      return publicSession(previous);
    }
  }
  const location = resolveLaunchLocation(store.state, { ...body, ...(original ? { host: original.host, cwd: original.cwd } : {}) }, allowedHosts);
  const { host, cwd } = location;
  if (host !== 'local' && !allowedHosts.includes(host)) throw new Error('This SSH connection is not enabled in your local connections.json.');
  if (original && body.host && body.host !== original.host) throw new Error('Resume a conversation in its original environment.');
  const repo = host === 'local' ? repository(cwd) : null;
  const project = store.state.projects.find(p => p.id === location.projectId);
  const team = store.state.teams.find(t => t.id === location.teamId);
  const group = text(team?.name || body.group || original?.group || path.basename(repo || cwd) || 'Loose sessions', 120);
  const assigned = store.state.tasks.find(t => t.id === (location.taskId || (!body.role && location.scope?.goalId)));
  if (assigned) {
    const existing = (await liveSessions()).find(s => s.kind === 'managed' && s.taskId === assigned.id && !['stopped','exited'].includes(s.status) && !s.enrollmentRevokedAt);
    if (existing) return existing;
  }
  const missionTitle = body.task?.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 160);
  const title = text(String(body.title || assigned?.title || missionTitle || original?.title || `${provider === 'shell' ? 'Terminal' : 'Agent'} · ${project?.name || path.basename(cwd)}`).slice(0, 200), 200);
  const id = randomUUID();
  const tmuxName = `st-${id.slice(0, 12)}`;
  const session = { id, remoteUser: host !== 'local' ? original?.owner || null : null, projectId: location.projectId, teamId: team?.id || null, taskId: assigned?.id || null, assignmentRevision: 0, attemptId: randomUUID(), kind: 'managed', provider, host, cwd, group, title, role: text(body.role || '', 100), tmuxName, historyId: original?.id || null, createdAt: new Date().toISOString(), status: 'running', agentToken: randomBytes(32).toString('hex') };
  session.scope = location.scope;
  const classification = classifyProjects(store.state,{sessions:[session],history:[]},{discover:true,allowedHosts});
  session.projectId = classification.sessions[0].projectId || session.projectId;
  session.projectAssignment = session.projectId ? {source:'assigned',reason:'enrollment-project',verified:true} : classification.sessions[0].projectAssignment;
  session.contextProjectId = session.projectId || null;
  session.contentProjectIds = [...allowedProjectIds(store.state,session)];
  if (original) session.contentProjectIds = [...new Set([...session.contentProjectIds,...(store.state.historyProvenance?.[original.id] || [])])];
  if (session.contentProjectIds.some(id=>!allowedProjectIds(store.state,session).has(id))) throw new Error('This saved conversation contains shared-team context. Continue with its explicit team or start a fresh agent.');
  if (assigned && !canReadProjectContent(store.state,session,assigned)) throw new Error('This task contains context shared by a team. Join that team explicitly or start with an unshared task.');
  if (original) {
    const prior = classifyProjects(store.state,{sessions:[],history:[original]},{discover:false,allowedHosts}).history[0];
    if (prior.projectId !== session.projectId) throw new Error('A conversation cannot move into another project. Start a fresh agent in that project.');
  }
  session.mission = typeof body.task === 'string' ? body.task.slice(0, 12000) : team?.mission || assigned?.notes || '';
  const bridge = await prepareBridge(session, root, port);
  let task = typeof body.task === 'string' && body.task.trim() ? body.task.slice(0, 12000) : team?.mission || '';
  if (session.scope) task += `\n\nAssignment scope:\n${JSON.stringify(agentScopeContext(store.state, session), null, 2)}\nWork only in your assigned project. Report completed work and blockers through the mailbox; never mark success without verification.`;
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
  const contextFile = ensureContext(contextKey(store.state,session));
  const launch = `${command}; printf '\\n[Session finished. You are now in a shell.]\\n'; exec ${quote(shell)} -l`;
  await tmuxRun(['new-session', '-d', '-s', tmuxName, '-c', host === 'local' ? cwd : home, '-x', '140', '-y', '40',
    '-e', `SUPER_TERMINAL_CONTEXT=${contextFile}`, '-e', `SUPER_TERMINAL_GROUP=${group}`, '-e', `SUPER_TERMINAL_AGENT_CONFIG=${bridge.configPath}`,
    [shell, '-lc', launch].map(quote).join(' ')]);
  await tmuxRun(['set-option', '-t', tmuxName, 'status', 'off']);
  await tmuxRun(['set-option', '-t', tmuxName, 'mouse', 'on']);
  await tmuxRun(['set-option', '-t', tmuxName, 'history-limit', '50000']);
  store.state.sessions.push(session);
  if (assigned) updateTask(store.state, assigned.id, { agentId: session.id });
  else if (provider !== 'shell' && session.mission.trim()) {
    let taskProject = project || store.state.projects.find(p => p.host === host && p.cwd === (repo || cwd));
    if (!taskProject) { taskProject = { id: randomUUID(), name: path.basename(repo || cwd) || group, host, cwd: repo || cwd, status: 'active', notes: '', createdAt: session.createdAt }; store.state.projects.push(taskProject); }
    session.projectId = taskProject.id;
    session.contextProjectId = taskProject.id; session.projectAssignment = {source:'assigned',reason:'enrollment-project',verified:true};
    const task = createTask(store.state, { projectId: session.projectId, title, notes: session.mission.slice(0, 6000), agentId: session.id, scope: session.scope, parentTaskId: session.scope?.goalId || undefined, status: 'todo' });
    task.contentProjectIds = [...new Set([session.projectId,...session.contentProjectIds])];
    session.taskId = task.id;
  }
  store.save();
  return publicSession(session);
}
app.post('/api/sessions', route(async (req, res) => res.json(await createSession(req.body))));
function updateManagedAgent(id, body, actor = 'you') {
  const session = store.state.sessions.find(s => s.id === id);
  if (!session) throw new Error('Session not found.');
  const next = { ...session };
  for (const [field, length] of [['title',200],['role',100],['group',120]]) if (body[field] !== undefined) next[field] = text(body[field], length);
  const team = body.teamId ? store.state.teams.find(t => t.id === body.teamId) : null;
  if (body.teamId && !team) throw new Error('Team not found.');
  if (body.group !== undefined || body.teamId !== undefined) {
    next.teamId = team?.id || null;
    if (team) next.group = team.name;
  }
  if (body.scope !== undefined) {
    next.scope = resolveScope(store.state.workSessions, body.scope);
    const project = store.state.workSessions.find(s => s.id === next.scope?.workSessionId)?.projects.find(p => p.id === next.scope?.projectId);
    next.projectId = project?.canonicalProjectId || null;
    next.taskId = next.scope?.goalId || null;
  }
  if (body.projectId !== undefined) {
    if (body.projectId && !store.state.projects.some(p => p.id === body.projectId)) throw new Error('Project not found.');
    next.projectId = body.projectId || null;
    if (next.projectId && store.state.projects.find(p => p.id === next.projectId)?.host !== session.host) throw new Error('A project assignment must stay in the agent’s environment.');
  }
  const moved = (next.projectId || null) !== (session.projectId || null);
  if (moved) {
    next.taskId = null; next.scope = null; next.teamId = null; next.mission = '';
    next.contextProjectId = session.contextProjectId ?? session.projectId ?? null;
    next.contextIsolation = 'restart-required';
    next.group = store.state.projects.find(p => p.id === next.projectId)?.name || 'Unassigned';
  }
  if (session.teamId && session.teamId !== next.teamId) next.contextIsolation = 'restart-required';
  if (body.taskId !== undefined && !moved) next.taskId = body.taskId || null;
  const task = next.taskId ? store.state.tasks.find(t => t.id === next.taskId) : null;
  if (next.taskId && (!task || task.projectId !== next.projectId)) throw new Error('Task does not belong to the assigned project.');
  if (task?.scope && JSON.stringify(task.scope) !== JSON.stringify(next.scope)) throw new Error('Task conflicts with the assignment scope.');
  const fields = ['scope','group','projectId','taskId','teamId'];
  const reassigned = fields.some(key => JSON.stringify(session[key]) !== JSON.stringify(next[key]));
  if (reassigned) next.assignmentRevision = (session.assignmentRevision || 0) + 1;
  const previousTask = store.state.tasks.find(t => t.id === session.taskId && t.agentId === id);
  Object.assign(session, next);
  if (team && !session.contextIsolation) team.sharedProjectIds = [...new Set([...(team.sharedProjectIds || []),team.projectId,projectOf(store.state,session),...(session.contentProjectIds || [])].filter(Boolean))];
  if (reassigned) {
    if (previousTask && previousTask.id !== next.taskId) updateTask(store.state, previousTask.id, { agentId: null });
    if (task && task.agentId !== id) updateTask(store.state, task.id, { agentId:id });
    for (const message of store.state.messages) if (message.to === id && !message.read) message.delivery = 'withdrawn';
    ensureContext(contextKey(store.state,session));
    if (!session.contextIsolation) sendMessage(actor, id, `Your assignment changed. Read platform context and tasks at your next checkpoint. Preserve current work and normal permissions. Assignment revision: ${session.assignmentRevision}.`, session.group);
  }
  store.save(); return publicSession(session);
}
app.patch('/api/sessions/:id', route(async (req, res) => res.json(updateManagedAgent(req.params.id, req.body))));
app.patch('/api/sessions/:id/project', route(async (req,res) => {
  const row = (await liveSessions()).find(s => s.id === req.params.id);
  if (!row) throw new Error('Agent not found.');
  if (req.body.projectId !== null && typeof req.body.projectId !== 'string') throw new Error('Choose a project or Unassigned.');
  const project = req.body.projectId ? store.state.projects.find(p => p.id === req.body.projectId) : null;
  if (req.body.projectId && (!project || project.host !== row.host)) throw new Error('Choose a project in this environment.');
  if (row.kind === 'managed') updateManagedAgent(row.id,{projectId:req.body.projectId});
  const record = setProjectAssignment(store.state,row,req.body.projectId,{actor:'you'});
  for (const key of ['taskId','teamId','scope']) record[key] = null;
  store.save();
  const session = (await liveSessions()).find(s => s.id === row.id);
  res.json({session,note:session?.contextIsolation ? 'Project tracking changed. The existing conversation retains its prior context; start a fresh agent to work in this project. Its terminal remains available.' : 'Project tracking updated. The process and working directory are unchanged.'});
}));
app.post('/api/focus', route(async(req,res) => {
  const focus = resolveFocus(store.state,req.body,await liveSessions());
  coordinator.setFocus(focus); res.json({focus:coordinator.status().focus});
}));
async function promptAgent(id, message, from = 'conductor') {
  const agent = store.state.sessions.find(s => s.id === id);
  if (!agent || agent.enrollmentRevokedAt || agent.status === 'stopped' || agent.contextIsolation) throw new Error('An active managed agent in its original project is required. Start a fresh agent after a project move.');
  const live = (await liveSessions()).find(s => s.id === id);
  if (!live?.capabilities.mailbox) throw new Error('This agent has no active mailbox. Reconnect or start a fresh managed agent.');
  const row = sendMessage(from, id, message, agent.group);
  return { ...row, delivery: 'queued', note: 'Queued in the agent mailbox for its next checkpoint; this does not submit text into a CLI approval prompt.' };
}
app.post('/api/sessions/:id/prompt', route(async (req, res) => res.json(await promptAgent(req.params.id, req.body.text, 'you'))));
app.post('/api/sessions/:id/control', route(async (req, res) => {
  const target = (await liveSessions()).find(s => s.id === req.params.id);
  if (!target) throw new Error('Agent not found.');
  res.json(await controlAgent(target, req.body.state, lifecycleContext));
}));
app.delete('/api/sessions/:id', route(async (req, res) => {
  const session = store.state.sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json(await removeAgent(session, lifecycleContext));
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
  store.state.workSessions.push(session); initializeTasks(store.state); store.save(); res.json(session);
}));
app.patch('/api/work-sessions/:id', route(async (req, res) => {
  const session = store.state.workSessions.find(s => s.id === req.params.id);
  if (!session) throw new Error('Working session not found.');
  const update = { ...session };
  if (req.body.title !== undefined) update.title = text(req.body.title, 200);
  if (req.body.notes !== undefined) {
    if (typeof req.body.notes !== 'string' || req.body.notes.length > 12000) throw new Error('Session notes are limited to 12,000 characters.');
    update.notes = req.body.notes;
  }
  if (req.body.status !== undefined && !['active','paused','wrapped'].includes(req.body.status)) throw new Error('Unknown working-session state.');
  if (req.body.status === 'active') {
    for (const s of store.state.workSessions) if (s.status === 'active') s.status = 'paused';
    update.status = 'active'; update.endedAt = null;
  } else if (req.body.status === 'wrapped') {
    update.status = 'wrapped'; update.endedAt = new Date().toISOString(); update.summary = wrapSummary(update);
  } else if (req.body.status === 'paused') update.status = 'paused';
  Object.assign(session, update);
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
  session.projects.push(project); initializeTasks(store.state); store.save(); res.json(project);
}));
app.patch('/api/work-sessions/:id/projects/:projectId', route(async (req, res) => {
  const project = store.state.workSessions.find(s => s.id === req.params.id)?.projects.find(p => p.id === req.params.projectId);
  if (!project) throw new Error('Project not found.');
  const host = req.body.host === undefined ? project.host : req.body.host !== 'local' ? validHost(req.body.host) : 'local';
  if (host !== 'local' && !allowedHosts.includes(host)) throw new Error('This SSH host is not configured.');
  const cwd = host === 'local' ? localDirectory(req.body.cwd || project.cwd || home) : text(req.body.cwd || project.cwd || '~', 2000);
  Object.assign(project, { host, cwd });
  const canonical = store.state.projects.find(p => p.id === project.canonicalProjectId);
  if (canonical) Object.assign(canonical, { host: project.host, cwd: project.cwd });
  store.save(); res.json(project);
}));
app.post('/api/work-sessions/:id/goals', route(async (req, res) => {
  const session = store.state.workSessions.find(s => s.id === req.params.id);
  const project = session?.projects.find(p => p.id === req.body.projectId);
  if (!project) throw new Error('Project not found.');
  const title = text(req.body.title, 800);
  if (!title) throw new Error('Goal title is required.');
  const goal = { id: randomUUID(), title, status: 'todo', notes: '' };
  project.goals.push(goal); initializeTasks(store.state); store.save(); res.json(goal);
}));
app.patch('/api/work-sessions/:id/goals/:goalId', route(async (req, res) => {
  const session = store.state.workSessions.find(s => s.id === req.params.id);
  const goal = session?.projects.flatMap(p => p.goals).find(g => g.id === req.params.goalId);
  if (!goal) throw new Error('Goal not found.');
  updateTask(store.state, goal.id, req.body);
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
  const scope = resolveScope(store.state.workSessions, req.body.scope);
  const scopedProject = store.state.workSessions.find(s => s.id === scope?.workSessionId)?.projects.find(p => p.id === scope?.projectId);
  const team = { id: randomUUID(), name, mission: req.body.mission, cwd, host, projectId: req.body.projectId || scopedProject?.canonicalProjectId || null, scope, createdAt: new Date().toISOString() };
  team.sharedProjectIds = [team.projectId].filter(Boolean); team.contentProjectIds = [team.projectId].filter(Boolean);
  if (team.projectId && !store.state.projects.some(p => p.id === team.projectId)) throw new Error('Project not found.');
  store.state.teams.push(team); ensureContext(`team:${team.id}`); store.save();
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
  const members = store.state.sessions.filter(s => s.teamId === team.id && !s.contextIsolation && !s.enrollmentRevokedAt);
  for (const member of members) sendMessage('you', member.id, `Team "${team.name}" briefing:\n${team.mission}\nYour role: ${member.role || 'Collaborator'}. Coordinate with peers through the mailbox. Confirm ownership before editing overlapping files, report blockers, and preserve normal approval requirements.`, team.name);
  res.json({ count: members.length });
}));
app.post('/api/teams/:id/start', route(async (req, res) => {
  const team = store.state.teams.find(t => t.id === req.params.id);
  if (!team?.mission.trim()) throw new Error('Add a mission first.');
  if (!Array.isArray(req.body.roles) || req.body.roles.length < 1 || req.body.roles.length > 6) throw new Error('Choose between one and six agents.');
  const roles = req.body.roles.map(r => ({ name: text(r.name, 100), provider: text(r.provider, 20), assignment: typeof r.assignment === 'string' ? r.assignment.slice(0, 4000) : '' }));
  if (roles.some(r => !r.name || !providers.includes(r.provider))) throw new Error('Each agent needs a role and an installed provider.');
  const result = await launchTeamMembers(team, roles.map(r => ({ provider:r.provider, role:r.name, task:r.assignment })), { store, liveSessions, createSession });
  res.json({ ...result, launched:result.started });
}));
function sendMessage(from, to, message, group) {
  if (typeof message !== 'string' || !message.trim() || message.length > 12000) throw new Error('Messages must contain 1–12,000 characters.');
  if (to !== 'coordinator' && !store.state.sessions.some(s => s.id === to)) throw new Error('Recipient not found.');
  const recipient = store.state.sessions.find(s => s.id === to);
  const sender = store.state.sessions.find(s => s.id === from);
  if (recipient?.contextIsolation) throw new Error('Project moved: start a fresh agent before delivering new project context.');
  if (sender && recipient && !peersAllowed(store.state,sender,recipient)) throw new Error('Explicit shared-team membership is required.');
  const sourceProjectIds = sender ? [...new Set([...allowedProjectIds(store.state,sender),...(sender.contentProjectIds || [])])] : recipient ? [...allowedProjectIds(store.state,recipient)] : [];
  if (recipient && sourceProjectIds.some(id => !allowedProjectIds(store.state,recipient).has(id))) throw new Error('Message source context is outside the recipient’s project or explicit team.');
  const row = { id: randomUUID(), from, to, text: message, group, sourceProjectIds, projectId:projectOf(store.state,recipient || sender), teamId:teamOf(store.state,recipient || sender)?.id || null, assignmentRevision:recipient?.assignmentRevision || 0, createdAt: new Date().toISOString(), read: false, delivery:'queued' };
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
  if (agent.contextIsolation) throw new Error('This agent moved projects. Its prior conversation is retained, so platform context is suspended. Start a fresh agent in the new project.');
  if (b.command === 'peers') return res.json({ self: agent.id, peers: store.state.sessions.filter(s => s.id !== agent.id && peersAllowed(store.state,agent,s)).map(({ id, title, provider, host, teamId, role }) => ({ id, title, provider, host, teamId, role })), coordinator: 'coordinator' });
  if (b.command === 'inbox') {
    const messages = store.state.messages.filter(m => !m.read && m.delivery !== 'withdrawn' && messageVisible(store.state,m,agent)).slice(-50);
    for (const m of messages) { m.read = true; m.readAt = new Date().toISOString(); m.delivery = 'read'; agent.contentProjectIds = [...new Set([...(agent.contentProjectIds || []),...(m.sourceProjectIds || [])])]; }
    store.save(); return res.json({ messages });
  }
  if (b.command === 'send') {
    const target = store.state.sessions.find(s => s.id === b.to);
    if (b.to !== 'coordinator' && (!target || !peersAllowed(store.state,agent,target))) throw new Error('Explicit shared-team membership is required. A project label or working session does not grant peer access.');
    return res.json(sendMessage(agent.id, b.to, b.message, agent.group));
  }
  if (b.command === 'context') return res.json({ id: agent.id, agentId: agent.id, agent: { id: agent.id, attemptId: agent.attemptId || agent.id, assignmentRevision: agent.assignmentRevision || 0 }, attemptId: agent.attemptId || agent.id, assignmentRevision: agent.assignmentRevision || 0, projectId:projectOf(store.state,agent), teamId:teamOf(store.state,agent)?.id || null, taskId:agent.taskId, scope:agentScopeContext(store.state,agent), mission:agent.mission || '', teamMission:teamOf(store.state,agent)?.mission || '', content:fs.readFileSync(ensureContext(contextKey(store.state,agent)),'utf8') });
  if (b.command === 'tasks') return res.json({ tasks: store.state.tasks.filter(t => {
    if (!projectOf(store.state,agent) || t.projectId !== projectOf(store.state,agent)) return false;
    if (!canReadProjectContent(store.state,agent,t)) return false;
    if (agent.scope?.workSessionId && t.scope?.workSessionId !== agent.scope.workSessionId) return false;
    if (agent.scope?.projectId && t.scope?.projectId !== agent.scope.projectId) return false;
    if (agent.scope?.goalId && !taskDescendsFrom(store.state, t, agent.scope.goalId)) return false;
    if (agent.taskId && !taskDescendsFrom(store.state, t, agent.taskId)) return false;
    return true;
  }).slice(-100).map(({id,title,status,revision,projectId,notes,agentId}) => ({id,title,status,revision,projectId,notes:notes.slice(0,600),agentId})) });
  if (b.command === 'task' || b.command === 'report' || b.command === 'task_event') {
    const result = recordTaskEvent(store.state, agent, b); store.save(); return res.json(result);
  }
  if (b.command === 'progress') {
    const working = store.state.workSessions.find(s => s.id === agent.scope?.workSessionId);
    if (!working) throw new Error('Ask the user to assign you to a working session first.');
    const goalId = b.goal || agent.scope.goalId;
    const project = working.projects.find(p => p.goals.some(g => g.id === goalId));
    const goal = project?.goals.find(g => g.id === goalId);
    if (!goal || (agent.scope.projectId && project.id !== agent.scope.projectId) || (agent.scope.goalId && goal.id !== agent.scope.goalId)) throw new Error('That goal is outside your assigned scope.');
    recordTaskEvent(store.state, agent, { ...b, taskId: goal.id });
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
  if (req.body.focus) coordinator.setFocus(resolveFocus(store.state,req.body.focus,live));
  let scope;
  if (req.body.taskId || req.body.projectId) {
    const task = req.body.taskId ? store.state.tasks.find(t => t.id === req.body.taskId) : null;
    if (req.body.taskId && !task) throw new Error('Task not found.');
    const projectId = req.body.projectId || task?.projectId;
    if (!store.state.projects.some(p => p.id === projectId)) throw new Error('Project not found.');
    if (task && task.projectId !== projectId) throw new Error('Task is not in the selected project.');
    if (workSessionId && task?.scope?.workSessionId && task.scope.workSessionId !== workSessionId) throw new Error('Task is not in the selected working session.');
    const tasks = store.state.tasks.filter(t => t.projectId === projectId && (!task || t.id === task.id || t.parentTaskId === task.id) && (!workSessionId || t.scope?.workSessionId === workSessionId));
    scope = { layer:task ? 'task' : 'project', projectIds:[projectId], taskIds:tasks.map(t=>t.id), workSessionIds:workSessionId ? [workSessionId] : [], agentIds:live.filter(s=>(!task && s.projectId===projectId) || tasks.some(t=>t.id===s.taskId || t.agentId===s.id)).map(s=>s.id) };
  }
  res.json(await coordinator.ask(req.body.prompt, group, live, history, workSessionId, req.body.automatic === true, req.body.environment === 'local' || allowedHosts.includes(req.body.environment) ? req.body.environment : 'local', scope ? {scope} : {}));
}));
app.post('/api/coordinator/cancel', (req, res) => { coordinator.cancel(); res.json({ ok: true }); });
app.post('/api/coordinator/control', route(async (req, res) => res.json(coordinator.controlLoop(req.body.state))));
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
  const group = text(req.query.group || '', 120);
  const file = ensureContext(contextTarget(store.state,req.query));
  res.json({ group, path: file, content: fs.readFileSync(file, 'utf8') });
}));
app.put('/api/context', route(async (req, res) => {
  const group = text(req.body.group || '', 120);
  if (typeof req.body.content !== 'string' || req.body.content.length > 100000) throw new Error('Notes are limited to 100,000 characters.');
  const file = ensureContext(contextTarget(store.state,req.body));
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
    coordinator.startLoop();
    for (const host of allowedHosts) refreshRemote(host);
    const scanTimer = setInterval(() => { if (!stopping) for (const host of allowedHosts) refreshRemote(host); }, 20000);
    scanTimer.unref();
    let checking = false;
    const checkActivity = async () => {
      if (checking || stopping) return; checking = true;
      activityStatus.running = true;
      try {
        const [rows, sessions] = await Promise.all([history.all(), liveSessions()]);
        activity.histories('local', rows.filter(r => r.host === 'local'));
        activity.processes('local', sessions);
        for (const host of allowedHosts) {
          const remote = remoteCache.get(host);
          if (remote?.scannedAt && !remote.error) activity.histories(host, remote.history || []);
          activity.processes(host, sessions, !!remote?.scannedAt && !remote.error);
        }
        activityStatus.lastCheckedAt = new Date().toISOString(); activityStatus.lastError = null;
      } catch(error) { activityStatus.lastError = error.message.slice(0,300); throw error; }
      finally { checking = false; activityStatus.running = false; }
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
  coordinator.stopLoop();
  await browsers.close();
  server.close(() => { clearTimeout(deadline); process.exit(0); });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
process.parentPort?.on('message', event => { if (event.data?.type === 'shutdown') stop(); });
