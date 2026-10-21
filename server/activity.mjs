import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readRecords } from './history.mjs';

// Explicit end-of-turn records only: commentary and tool calls are not completion.
export function completion(provider, records) {
  let result = null;
  for (const r of records) {
    const p = r.payload || {};
    const done = provider === 'codex' ? r.type === 'event_msg' && p.type === 'task_complete'
      : provider === 'claude' ? r.type === 'assistant' && !r.isSidechain && !r.isApiErrorMessage && r.message?.stop_reason === 'end_turn'
      : provider === 'grok' && r.type === 'turn_ended' && ['completed', 'success'].includes(r.outcome);
    const at = r.timestamp || r.ts;
    if (done && Number.isFinite(Date.parse(at))) result = { key: String(r.uuid || p.turn_id || at), at };
  }
  return result;
}

export class ActivityMonitor {
  constructor(store) {
    this.store = store; this.started = Date.now(); this.cache = new Map(); this.baselines = new Set(); this.seen = new Map(); this.live = new Map();
    store.state.activity ||= [];
  }
  add(source, kind, key) {
    const events = this.store.state.activity;
    if (events.some(e => e.key === key)) return;
    events.push({ id: randomUUID(), key, kind, at: new Date().toISOString(), target: source.historyId || source.id, host: source.host, provider: source.provider, title: String(source.role || source.title || source.provider).slice(0, 180) });
    this.store.state.activity = events.slice(-200); this.store.save();
  }
  notify({ title, text, target = 'conductor', host = 'local' }) {
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('A notification needs a short title and message.');
    const key = 'conductor:' + createHash('sha256').update(JSON.stringify([title, text, target])).digest('hex');
    const existing = this.store.state.activity.find(e => e.key === key);
    if (existing) return { ...existing, duplicate: true };
    const event = { id: randomUUID(), key, kind: 'conductor', notify: true, at: new Date().toISOString(), target, host, provider: 'conductor', title, text };
    this.store.state.activity.push(event);
    this.store.state.activity = this.store.state.activity.slice(-200);
    this.store.save(); return event;
  }
  histories(host, rows) {
    const baseline = !this.baselines.has(host);
    for (const row of rows) {
      let marker = row.completion;
      if (host === 'local' && row.file) {
        const file = row.provider === 'grok' ? path.join(path.dirname(row.file), 'events.jsonl') : row.file;
        try {
          const stat = fs.statSync(file), version = `${stat.size}:${stat.mtimeMs}`;
          if (stat.mtimeMs < this.started - 60000) continue;
          let cached = this.cache.get(file);
          if (cached?.version !== version) { cached = { version, marker: completion(row.provider, readRecords(file, 256 * 1024)) }; this.cache.set(file, cached); }
          marker = cached.marker;
        } catch { continue; }
      }
      if (!marker) continue;
      const changed = this.seen.get(row.id) !== marker.key;
      this.seen.set(row.id, marker.key);
      if (!baseline && changed && Date.parse(marker.at) >= this.started) this.add(row, 'finished', `${row.id}:${marker.key}`);
    }
    this.baselines.add(host);
  }
  processes(host, rows, healthy = true) {
    // A lost SSH connection is not evidence that the remote agent exited.
    if (!healthy) { this.live.delete(host); return; }
    const agents = rows.filter(s => s.host === host && !s.runtime && ['codex','claude','grok'].includes(s.provider) && ['running','external','paused'].includes(s.status));
    const previous = this.live.get(host);
    // Linux start time is inferred from integer elapsed seconds and can drift by <1s.
    const sameRun = (a, b) => a?.provider === b.provider && a?.pid === b.pid && (a?.startedAt === b.startedAt || Math.abs(Date.parse(a?.startedAt) - Date.parse(b.startedAt)) < 2000);
    if (previous) for (const old of previous.values()) if (!agents.some(s => s.id === old.id && sameRun(old, s))) {
      const current = rows.find(s => s.id === old.id);
      if (current?.connectionLost || current?.status === 'disconnected') continue;
      this.add(old, 'exited', `exit:${old.id}:${old.activityRun}`);
    }
    this.live.set(host, new Map(agents.map(s => [s.id, { ...s, activityRun: sameRun(previous?.get(s.id), s) ? previous.get(s.id).activityRun : randomUUID() }])));
  }
}
