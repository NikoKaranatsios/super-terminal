import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { home, repository } from './core.mjs';
import { readRecordPage, eventsFromRecords } from './transcript.mjs';

const roots = {
  codex: process.env.CODEX_HOME || path.join(home, '.codex'),
  claude: process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
  grok: process.env.GROK_HOME || path.join(home, '.grok')
};
const list = p => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
const json = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

export function readRecords(file, budget = 1024 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const read = (offset, length) => {
      const b = Buffer.alloc(length);
      return b.subarray(0, fs.readSync(fd, b, 0, length, offset)).toString('utf8');
    };
    const parts = size <= budget ? [read(0, size)] :
      [read(0, Math.floor(budget / 4)).split('\n').slice(0, -1).join('\n'), read(size - Math.floor(budget * 3 / 4), Math.floor(budget * 3 / 4)).split('\n').slice(1).join('\n')];
    return parts.flatMap(s => s.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }));
  } catch { return []; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => ['text', 'input_text', 'output_text'].includes(c.type)).map(c => c.text || '').join('\n');
}
export function humanText(value) {
  const query = value.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (query) return query[1].trim();
  return value.replace(/<(system-reminder|environment_context|user_info|rules|permissions instructions|skills_instructions)>[\s\S]*?<\/\1>/g, '').trim();
}
export function messagesFromRecords(provider, records) {
  const messages = [];
  for (const r of records) {
    let role, value;
    if (provider === 'codex') {
      const p = r.payload || r;
      if (r.type === 'response_item' && p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
        role = p.role; value = contentText(p.content);
      }
      if (p.type === 'userMessage') { role = 'user'; value = contentText(p.content); }
      if (p.type === 'agentMessage') { role = 'assistant'; value = p.text || contentText(p.content); }
    } else {
      role = r.type || r.role;
      if (!['user', 'assistant'].includes(role) || r.isMeta) continue;
      value = contentText(r.message?.content ?? r.content);
    }
    if (!role || !value) continue;
    value = humanText(value);
    if (!value || /^# (?:AGENTS|Instructions)|^<system-reminder>|^<user_info>|^<environment_context>/.test(value)) continue;
    // Do not show injected context or tool results as conversation messages.
    if (value.startsWith('<') && !value.startsWith('<user_query>') && role === 'user') continue;
    const previous = messages.at(-1);
    if (previous?.role === role && previous.text === value) continue;
    messages.push({ role, text: value.slice(0, 20000), timestamp: r.timestamp || null });
  }
  return messages.slice(-100);
}
function row(provider, sessionId, cwd, title, updatedAt, file) {
  const repo = repository(cwd);
  return {
    id: `${provider}:${sessionId}`, provider, sessionId, cwd: cwd || home,
    repository: repo, group: repo ? path.basename(repo) : (cwd && cwd !== home ? path.basename(cwd) : 'Loose sessions'),
    title: String(title || `${provider} conversation`).replace(/\s+/g, ' ').slice(0, 180),
    updatedAt, file, kind: 'history', host: 'local'
  };
}
export class History {
  cache = [];
  refreshed = 0;
  warnings = [];
  async all(force = false) {
    if (!force && Date.now() - this.refreshed < 15000) return this.cache;
    const rows = [];
    this.warnings = [];
    let db;
    try {
      const dbFiles = list(roots.codex).filter(f => /^state_\d+\.sqlite$/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
      if (dbFiles.length) {
        db = new DatabaseSync(path.join(roots.codex, dbFiles[0].name), { readOnly: true });
        for (const r of db.prepare('SELECT id, cwd, title, updated_at, created_at, rollout_path FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 2000').all()) {
          rows.push({ ...row('codex', r.id, r.cwd, r.title, new Date(r.updated_at * 1000).toISOString(), r.rollout_path), createdAt: new Date(r.created_at * 1000).toISOString() });
        }
      }
    } catch (e) { this.warnings.push(`Codex index: ${e.message}`); }
    finally { db?.close(); }
    if (!rows.length) {
      const walk = (dir, depth = 0) => {
        if (depth > 4) return;
        for (const f of list(dir)) {
          const file = path.join(dir, f.name);
          if (f.isDirectory()) walk(file, depth + 1);
          else if (f.name.endsWith('.jsonl')) {
            const records = readRecords(file, 65536);
            const meta = records.find(r => r.type === 'session_meta')?.payload;
            if (meta?.id) rows.push(row('codex', meta.id, meta.cwd, messagesFromRecords('codex', records).find(m => m.role === 'user')?.text, fs.statSync(file).mtime.toISOString(), file));
          }
        }
      };
      walk(path.join(roots.codex, 'sessions'));
    }
    for (const project of list(path.join(roots.claude, 'projects'))) {
      if (!project.isDirectory()) continue;
      for (const f of list(path.join(roots.claude, 'projects', project.name))) {
        if (!f.isFile() || !f.name.endsWith('.jsonl') || f.name.startsWith('agent-')) continue;
        const file = path.join(roots.claude, 'projects', project.name, f.name);
        const records = readRecords(file, 128 * 1024);
        const meta = records.find(r => r.cwd);
        if (!meta) continue;
        const title = records.findLast(r => r.type === 'custom-title')?.customTitle || records.findLast(r => r.type === 'summary')?.summary ||
          messagesFromRecords('claude', records).find(m => m.role === 'user')?.text;
        rows.push({ ...row('claude', meta.sessionId || f.name.slice(0, -6), meta.cwd, title, fs.statSync(file).mtime.toISOString(), file), createdAt: records.find(r => r.timestamp)?.timestamp });
      }
    }
    for (const project of list(path.join(roots.grok, 'sessions'))) {
      if (!project.isDirectory()) continue;
      for (const session of list(path.join(roots.grok, 'sessions', project.name))) {
        if (!session.isDirectory()) continue;
        const dir = path.join(roots.grok, 'sessions', project.name, session.name);
        const meta = json(path.join(dir, 'summary.json'));
        if (!meta?.info?.id) continue;
        rows.push(row('grok', meta.info.id, meta.info.cwd, meta.generated_title || meta.session_summary, meta.updated_at || meta.created_at, path.join(dir, 'chat_history.jsonl')));
      }
    }
    this.cache = rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    this.refreshed = Date.now();
    return this.cache;
  }
  async get(id) { return (await this.all()).find(r => r.id === id); }
  async transcript(id, cursor) {
    const session = await this.get(id);
    if (!session) throw new Error('Conversation no longer found. Refresh the sidebar.');
    let messages = [], events = [], page;
    let db;
    if (session.file && fs.existsSync(session.file)) {
      page = readRecordPage(session.file, cursor);
      events = eventsFromRecords(session.provider, page.records);
      messages = messagesFromRecords(session.provider, page.records);
    }
    if (!page && session.provider === 'codex') {
      try {
        db = new DatabaseSync(path.join(roots.codex, 'thread_history_1.sqlite'), { readOnly: true });
        const items = db.prepare('SELECT item_json FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 160').all(session.sessionId);
        const records = items.reverse().map(r => JSON.parse(r.item_json));
        messages = messagesFromRecords('codex', records);
        events = eventsFromRecords('codex', records);
      } catch {} finally { db?.close(); }
    }
    return { session: publicHistory(session), messages, events, nextCursor: page?.nextCursor ?? null, coverage: page?.coverage,
      note: page ? `${page.nextCursor ? 'Recent output; load earlier output to continue. ' : ''}Saved messages, commentary, tool calls and results exposed by the provider.${page.coverage.skippedLargeRecord ? ' A record larger than 8 MiB was omitted.' : ''}` : 'Recent provider database entries; the original output file is unavailable.' };
  }
}
export function publicHistory({ file, ...row }) { return row; }

// One read interface for local files and the two already-approved SSH accounts.
export class EnvironmentHistory {
  constructor(local, remotes, remoteRead) { Object.assign(this, { local, remotes, remoteRead }); this.transcripts = new Map(); }
  get warnings() { return this.local.warnings; }
  async all(force = false) { return [...await this.local.all(force), ...[...this.remotes.values()].flatMap(r => r.history || [])].sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); }
  async get(id) { return (await this.all()).find(r => r.id === id); }
  async transcript(id, cursor) {
    const session = await this.get(id);
    if (!session) throw new Error('Conversation no longer found.');
    if (session.host === 'local') return this.local.transcript(id, cursor);
    const cacheKey = `${id}:${cursor ?? ''}`;
    const cached = this.transcripts.get(cacheKey);
    if (cached?.version === session.updatedAt && Date.now() - cached.at < 15000) return cached.value;
    const result = await this.remoteRead(session.host, 'transcript', `${session.provider}:${session.sessionId}`, cursor);
    const value = { session: publicHistory(session), messages: result.messages, events: result.events, nextCursor: result.nextCursor ?? null, coverage: result.coverage,
      note: `${result.nextCursor ? 'Recent output; load earlier output to continue. ' : ''}Saved provider messages, commentary and tool output.${result.coverage?.skippedLargeRecord ? ' A record larger than 8 MiB was omitted.' : ''}` };
    this.transcripts.set(cacheKey, { version: session.updatedAt, at: Date.now(), value });
    if (this.transcripts.size > 100) this.transcripts.delete(this.transcripts.keys().next().value);
    return value;
  }
}
export function matchHistory(agent, rows) {
  const candidates = rows.filter(r => r.host === agent.host && r.provider === agent.provider);
  const exact = candidates.filter(r => agent.historyId === r.id || agent.resumeId === r.sessionId || agent.files?.includes(r.file));
  if (exact.length === 1) return exact[0].id;
  if (agent.runtime) return null;
  // New CLI sessions are created immediately after the process starts. Ambiguity stays unlinked.
  const started = candidates.filter(r => r.cwd === agent.cwd && Number.isFinite(Date.parse(agent.startedAt)) && Math.abs(Date.parse(r.createdAt)-Date.parse(agent.startedAt)) < 15000);
  return started.length === 1 ? started[0].id : null;
}
