import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

export const run = promisify(execFile);
export const home = os.homedir();
export const dataDir = process.env.SUPER_TERMINAL_DATA || path.join(home, '.super-terminal');
export const shell = process.env.SHELL || (fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/sh');
export const socket = process.env.SUPER_TERMINAL_SOCKET || 'super-terminal';
export const env = { ...process.env, PATH: [...new Set([process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.grok/bin'), path.join(home, '.local/bin')].filter(Boolean))].join(':') };
// An attachment must not inherit a parent tmux client or agent nesting markers.
delete env.TMUX;
delete env.CLAUDECODE;
delete env.CLAUDE_CODE_ENTRYPOINT;

export function which(name) {
  for (const dir of env.PATH.split(':')) {
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}
export const tmux = which('tmux');
export function quote(value) { return "'" + String(value).replaceAll("'", "'\\''") + "'"; }
export function text(value, max = 200) {
  if (typeof value !== 'string' || value.length > max || /[\0\r\n]/.test(value)) throw new Error('Invalid text value');
  return value.trim();
}
export function validHost(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) throw new Error('Use an SSH alias or user@hostname (configure ports in ~/.ssh/config).');
  return value;
}
export function localDirectory(value = home) {
  const p = path.resolve(value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value);
  if (!fs.statSync(p).isDirectory()) throw new Error('Working directory must be a folder.');
  return p;
}
export function repository(cwd) {
  if (!cwd) return null;
  let p = cwd;
  while (p !== path.dirname(p)) {
    if (fs.existsSync(path.join(p, '.git'))) return p;
    p = path.dirname(p);
  }
  return null;
}
export function contextPath(group) {
  return path.join(dataDir, 'context', createHash('sha256').update(group).digest('hex').slice(0, 24) + '.md');
}
export function ensureContext(group) {
  const file = contextPath(group);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${group}\n\nShared context for this group. Add decisions, useful paths, and handoff notes here.\n`, { mode: 0o600 });
  return file;
}
export function createStore(root = dataDir) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, 'state.json');
  let state = { sessions: [], hosts: [] };
  if (fs.existsSync(file)) {
    // Fail visibly instead of overwriting damaged user state.
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(state.sessions) || !Array.isArray(state.hosts)) throw new Error('Invalid state.json');
  }
  return {
    state,
    save() {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
    }
  };
}
export async function tmuxRun(args, targetSocket = socket) {
  if (!tmux) throw new Error('tmux is required. Install it with: brew install tmux');
  return run(tmux, [...(targetSocket ? ['-L', targetSocket] : []), ...args], { env, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
}
export function providerOf(command) {
  const name = path.basename(command || '').replace(/^\(|\)$/g, '');
  return ['codex', 'claude', 'grok'].includes(name) ? name : 'shell';
}
