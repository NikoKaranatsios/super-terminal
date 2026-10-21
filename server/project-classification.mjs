import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeString = value => typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/.test(value);
const hostOf = row => row.host || 'local';
const ownerOf = row => row.owner || row.remoteUser || '';
const normalizedStart = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** A PID or tmux pane number alone is never a persistent assignment identity. */
export function classificationIdentity(row) {
  if (!row || !safeString(row.id) || !row.id || !safeString(hostOf(row))) return null;
  const base = [hostOf(row), ownerOf(row), row.kind, row.id];
  if (row.kind === 'managed') return `v1:${digest([...base, 'managed-record'])}`;
  if (row.kind === 'history') return `v1:${digest([...base, row.provider || '', row.sessionId || row.id])}`;
  const server = row.serverIdentity || row.tmuxServerIdentity;
  if (['tmux', 'remote'].includes(row.kind) && safeString(server) && server && safeString(row.pane) && row.pane) return `v1:${digest([...base, row.socket || 'default', server, row.pane])}`;
  const start = row.processStartIdentity || row.startIdentity || (hostOf(row) === 'local' ? normalizedStart(row.startedAt) : null);
  if (Number.isSafeInteger(row.pid) && row.pid > 1 && safeString(start) && start) return `v1:${digest([...base, row.pid, row.provider || row.command || '', start])}`;
  return null;
}

export function matchingAssignment(state, row) {
  const assignment = state.assignments?.[row.id];
  if (!assignment) return { assignment: null, reason: 'no-manual-assignment', stale: false };
  const identity = classificationIdentity(row);
  if (assignment.identity && identity === assignment.identity) return { assignment, reason: 'manual-assignment', stale: false };
  // The earlier local external assignment format retained exact ps lstart evidence.
  // Remote now-etimes estimates and tmux pane IDs are deliberately not upgraded.
  if (!assignment.identity && row.kind === 'external' && hostOf(row) === 'local' && row.id === `external:${row.pid}` && normalizedStart(assignment.startedAt) && normalizedStart(assignment.startedAt) === normalizedStart(row.startedAt)) return { assignment, reason: 'legacy-manual-assignment', stale: false };
  return { assignment: null, reason: identity ? 'assignment-process-changed' : 'assignment-identity-unavailable', stale: true };
}

/** Persist an intentional tracking move; never move a process cwd or rewrite task scope. */
export function setProjectAssignment(state, row, projectId, options = {}) {
  if (!row?.id) throw new Error('Agent not found.');
  const project = projectId ? state.projects?.find(p => p.id === projectId) : null;
  if (projectId && !project) throw new Error('Project not found.');
  if (project && hostOf(project) !== hostOf(row)) throw new Error('Choose a project in the agent’s environment. Moving its tracking assignment does not move its process.');
  const identity = classificationIdentity(row);
  if (!identity) throw new Error('This process has no stable discovery identity yet. Refresh before saving a manual project assignment.');
  const previous = matchingAssignment(state, row).assignment || {};
  const assignment = { ...previous, projectId: project?.id || null, source: 'manual', identity, actor: options.actor || 'user', updatedAt: options.now || new Date().toISOString() };
  if (!assignment.projectId || (previous.projectId ?? row.projectId ?? null) !== assignment.projectId) Object.assign(assignment, { scope: null, taskId: null, teamId: null, group: project?.name || 'Unassigned' });
  if (row.kind === 'managed') {
    const managed = state.sessions?.find(s => s.id === row.id);
    if (!managed) throw new Error('Managed agent not found.');
    Object.assign(managed, { projectId: assignment.projectId, projectAssignment: { source: 'manual', reason: project ? 'user-selected-project' : 'user-unassigned', verified: true } });
  }
  state.assignments ||= {};
  state.assignments[row.id] = assignment;
  return assignment;
}

function contained(root, candidate) {
  const relative = path.posix.relative(root, candidate);
  return relative === '' || (!relative.startsWith('../') && relative !== '..' && !path.posix.isAbsolute(relative));
}
function localPath(value, filesystem) {
  if (!safeString(value) || !path.isAbsolute(value)) return null;
  let current = path.normalize(value);
  const missing = [];
  for (let depth = 0; depth < 128; depth++) {
    try { return { path: path.join(filesystem.realpathSync(current), ...missing), exists: missing.length === 0 }; }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
      const parent = path.dirname(current);
      if (parent === current) return null;
      missing.unshift(path.basename(current)); current = parent;
    }
  }
  return null;
}
function canonicalPath(host, value, context) {
  const key = `${host}\0${value}`;
  if (context.paths.has(key)) return context.paths.get(key);
  let result = null;
  if (safeString(value)) result = host === 'local' ? localPath(value, context.fs) : path.posix.isAbsolute(value) ? { path: path.posix.normalize(value), exists: false } : null;
  context.paths.set(key, result);
  return result;
}
function smallFile(file, filesystem, limit = 4096) {
  let fd;
  try {
    // A repository marker may be malformed or hostile; FIFOs/devices must never block discovery.
    fd = filesystem.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stat = filesystem.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) return null;
    const bytes = Buffer.alloc(limit + 1);
    const count = filesystem.readSync(fd, bytes, 0, bytes.length, 0);
    return count <= limit ? bytes.subarray(0, count).toString('utf8').trim() : null;
  } catch { return null; }
  finally { if (fd !== undefined) filesystem.closeSync(fd); }
}
function directory(file, filesystem) { try { return filesystem.statSync(file).isDirectory(); } catch { return false; } }
function gitDirectory(root, filesystem) {
  const marker = path.join(root, '.git');
  let git = marker;
  if (!directory(git, filesystem)) {
    const link = smallFile(marker, filesystem);
    if (!link?.startsWith('gitdir: ') || /[\r\n\0]/.test(link)) return false;
    try { git = filesystem.realpathSync(path.resolve(root, link.slice(8).trim())); } catch { return false; }
  }
  const head = smallFile(path.join(git, 'HEAD'), filesystem, 512);
  if (!head || !/^(?:ref: refs\/[^\s\0]+|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(head)) return false;
  if (directory(path.join(git, 'objects'), filesystem)) return true;
  const common = smallFile(path.join(git, 'commondir'), filesystem);
  return !!common && !/[\r\n\0]/.test(common) && directory(path.resolve(git, common, 'objects'), filesystem);
}

/** Inspect Git markers only; no Git commands, config, hooks, shell, or network access. */
export function discoverRepositoryRoot(cwd, options = {}) {
  const filesystem = options.fs || fs;
  const canonical = localPath(cwd, filesystem);
  if (!canonical?.exists || !directory(canonical.path, filesystem)) return null;
  let current = canonical.path;
  for (let depth = 0; depth < 64; depth++) {
    if (gitDirectory(current, filesystem)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}
function repositoryEvidence(row, context) {
  const host = hostOf(row), cwd = canonicalPath(host, host !== 'local' ? row.canonicalCwd || row.cwd : row.cwd, context);
  if (!cwd) return null;
  if (host === 'local') {
    if (!context.repositories.has(cwd.path)) context.repositories.set(cwd.path, discoverRepositoryRoot(row.cwd, { fs: context.fs }));
    const root = context.repositories.get(cwd.path);
    return root ? { root, verified: true, reason: 'local-git-marker' } : null;
  }
  // Only the trusted remote reader may assert this flag; transcript text is not proof.
  if (row.repositoryVerified !== true) return null;
  const root = canonicalPath(host, row.repository, context)?.path;
  return root && contained(root, cwd.path) ? { root, verified: true, reason: 'remote-reader-git-marker' } : null;
}
function projectRoots(state, context) {
  return state.projects.flatMap(project => {
    const root = canonicalPath(hostOf(project), project.cwd, context);
    return root ? [{ project, host: hostOf(project), root: root.path, verified: root.exists }] : [];
  });
}
function longestProject(roots, host, cwd) {
  if (!cwd) return { project: null, reason: 'working-directory-unavailable' };
  const matches = roots.filter(p => p.host === host && contained(p.root, cwd.path)).sort((a, b) => b.root.length - a.root.length);
  if (!matches.length) return { project: null, reason: 'no-project-root-match' };
  const best = matches.filter(p => p.root === matches[0].root);
  if (best.length !== 1) return { project: null, reason: 'ambiguous-project-root' };
  return { project: best[0].project, root: best[0].root, verified: cwd.exists && best[0].verified, reason: 'working-directory-within-project' };
}
function assignmentAccess(state, assignment, project) {
  const task = state.tasks?.find(t => t.id === assignment.taskId && t.projectId === project.id);
  const team = state.teams?.find(t => t.id === assignment.teamId && t.projectId === project.id);
  const scopeProject = state.workSessions?.find(s => s.id === assignment.scope?.workSessionId)?.projects.find(p => p.id === assignment.scope?.projectId && (p.canonicalProjectId || p.id) === project.id);
  const scope = scopeProject && (!assignment.scope.goalId || scopeProject.goals?.some(g => g.id === assignment.scope.goalId)) ? assignment.scope : null;
  return { scope, taskId: task?.id || null, teamId: team?.id || null, group: team?.name || project.name };
}

/** Classify copies of inventory rows; the only optional mutation is adding verified project metadata. */
export function classifyProjects(state, inventory = {}, options = {}) {
  if (state.projects !== undefined && !Array.isArray(state.projects)) throw new Error('Invalid projects state.');
  state.projects ||= [];
  const context = { fs: options.fs || fs, paths: new Map(), repositories: new Map() };
  let roots = projectRoots(state, context);
  const createdProjects = [], diagnostics = [];
  const maxDiscoveries = Number.isSafeInteger(options.maxDiscoveries) ? Math.max(0, Math.min(100, options.maxDiscoveries)) : 40;
  const at = options.now || new Date().toISOString();
  function classify(row) {
    const host = hostOf(row);
    const finish = (projectId, source, reason, verified = false, extra = {}) => ({ ...row, projectId, projectAssignment: { source, reason, verified, ...extra } });
    if (host !== 'local' && options.allowedHosts && !options.allowedHosts.includes(host)) return finish(null, 'unclassified', 'environment-not-enabled');
    const matched = matchingAssignment(state, row);
    if (matched.stale && diagnostics.length < 100) diagnostics.push({ id: row.id, reason: matched.reason });
    const managed = row.kind === 'managed' ? state.sessions?.find(s => s.id === row.id) || row : null;
    // Managed enrollment is authoritative; a tracking override must not undo a
    // later explicit team/task handoff (including an authorized cross-project team).
    const manual = managed ? managed.projectAssignment?.source === 'manual' ? { projectId: managed.projectId, source: 'manual' } : null : matched.assignment;
    if (manual) {
      if (!manual.projectId) return managed ? finish(null, 'manual', 'user-unassigned', true) : { ...finish(null, 'manual', 'user-unassigned', true), scope: null, taskId: null, teamId: null, group: 'Unassigned' };
      const project = state.projects.find(p => p.id === manual.projectId);
      if (!project || hostOf(project) !== host) return finish(null, 'unclassified', project ? 'assigned-project-environment-conflict' : 'assigned-project-missing');
      return { ...finish(project.id, 'manual', 'user-selected-project', true), ...(!managed && matched.assignment ? assignmentAccess(state, matched.assignment, project) : {}) };
    }
    // Managed UUID assignments represent explicit launch/team/task intent, not path guesses.
    if (managed?.projectId && !['path', 'repository', 'unclassified'].includes(managed.projectAssignment?.source)) {
      const project = state.projects.find(p => p.id === managed.projectId);
      return project && hostOf(project) === host ? finish(project.id, 'assigned', 'managed-assignment', true) : finish(null, 'unclassified', 'assigned-project-missing-or-conflicting');
    }
    if (row.runtime) return finish(null, 'unclassified', 'shared-provider-runtime');
    const cwd = canonicalPath(host, host !== 'local' ? row.canonicalCwd || row.cwd : row.cwd, context);
    const evidence = repositoryEvidence(row, context);
    let discovered = false;
    if (options.discover === true && evidence && createdProjects.length < maxDiscoveries && !roots.some(p => p.host === host && p.root === evidence.root)) {
      const project = { id: `detected-${digest([host, evidence.root]).slice(0, 24)}`, name: path.posix.basename(evidence.root) || 'Repository', host, cwd: evidence.root, notes: '', status: 'active', createdAt: at, discovery: { source: 'repository', evidence: evidence.reason } };
      if (!state.projects.some(p => p.id === project.id)) {
        state.projects.push(project); createdProjects.push(project); roots = projectRoots(state, context); discovered = true;
      }
    }
    const result = longestProject(roots, host, cwd);
    if (!result.project) return finish(null, 'unclassified', result.reason, false, matched.stale ? { stale: true } : {});
    const source = discovered || (result.project.discovery?.source === 'repository' && result.root === evidence?.root) ? 'repository' : 'path';
    return finish(result.project.id, source, source === 'repository' ? evidence?.reason || 'verified-repository-root' : result.reason, source === 'repository' || result.verified, matched.stale ? { stale: true } : {});
  }
  // Sessions have first choice of the bounded discovery slots, then saved history.
  let sessions = (inventory.sessions || []).map(classify);
  let history = (inventory.history || []).map(classify);
  // A later verified history row may discover the root for an earlier live row.
  if (createdProjects.length) { sessions = (inventory.sessions || []).map(classify); history = (inventory.history || []).map(classify); }
  return { sessions, history, createdProjects, changed: createdProjects.length > 0, diagnostics };
}
