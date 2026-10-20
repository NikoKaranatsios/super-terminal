import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir, env, which, tmuxRun } from './core.mjs';

export function applyAssessments(state, assessments, evidence) {
  const allowed = new Map(evidence.map(r => [r.id, r]));
  for (const item of assessments || []) {
    const source = allowed.get(item.id);
    if (!source || !['open','completed','uncertain','stale'].includes(item.status)) continue;
    state.assessments[item.id] = { status: item.status, summary: String(item.summary || '').slice(0, 600), version: source.updatedAt, reviewedAt: new Date().toISOString() };
  }
}
export class Coordinator {
  running = false;
  child = null;
  constructor(store) {
    this.store = store;
    store.state.conductor ||= { turns: [], memory: '', assessments: {} };
    this.state = store.state.conductor;
    for (const t of this.state.turns) if (t.status === 'running') Object.assign(t, { status: 'error', answer: 'The app closed before this reply finished. Please ask again.' });
  }
  status() { return { running: this.running, history: this.state.turns.slice(-100), assessments: this.state.assessments, model: 'gpt-6-luna' }; }
  async snapshot(live, history, prompt) {
    const rows = await history.all();
    const pending = rows.filter(r => this.state.assessments[r.id]?.version !== r.updatedAt);
    const selected = [];
    // Spread the bounded review across environments instead of starving older servers.
    const environments = [...new Set(rows.map(r => r.host))];
    const buckets = environments.map(host => pending.filter(r => r.host === host));
    while (selected.length < 18 && buckets.some(b => b.length)) for (const bucket of buckets) if (bucket.length && selected.length < 18) selected.push(bucket.shift());
    // Include conversations referred to by title in the user's follow-up.
    const words = prompt.toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu) || [];
    const relevant = rows.filter(r => !selected.some(s => s.id === r.id) && words.some(w => (r.title+' '+r.cwd).toLowerCase().includes(w))).slice(0, 6);
    const evidence = await Promise.all([...selected, ...relevant].map(async r => {
      try {
        const t = await history.transcript(r.id);
        return { id: r.id, host: r.host, provider: r.provider, title: r.title, cwd: r.cwd, updatedAt: r.updatedAt, messages: t.messages.slice(-3).map(m => ({ role: m.role, text: m.text.slice(-650) })) };
      } catch (e) { return { id: r.id, updatedAt: r.updatedAt, title: r.title, host: r.host, error: e.message }; }
    }));
    const terminals = await Promise.all(live.filter(s => ['running','external','paused'].includes(s.status)).map(async s => {
      let excerpt = '';
      if (s.kind === 'managed') try { excerpt = (await tmuxRun(['capture-pane','-p','-t',s.tmuxName,'-S','-12'])).stdout.slice(-650); } catch {}
      return { id: s.id, provider: s.provider, host: s.host, cwd: s.cwd, pid: s.pid, runtime: s.runtime || false, connectionLost: s.connectionLost || false, status: s.status, title: s.title, group: s.group, projectId: s.projectId, historyId: s.historyId, excerpt };
    }));
    return { capturedAt: new Date().toISOString(), environments: [...(history.remotes?.values() || [])].map(r => ({ host: r.host, scannedAt: r.scannedAt, error: r.error, historyCount: r.history?.length || 0, note: r.elevatedRead ? 'Read-only scan used this SSH account’s existing passwordless sudo access for provider histories.' : 'Only histories readable by the configured SSH account are indexed.' })), coverage: { indexed: rows.length, previouslyReviewed: rows.length-pending.length, reviewThisTurn: evidence.length, pending: pending.filter(r=>!evidence.some(e=>e.id===r.id)).length }, terminals,
      reviewEvidence: evidence, disconnectedTerminals: live.filter(s=>s.status==='disconnected').map(({id,title,host,status})=>({id,title,host,status})), previousAssessments: Object.entries(this.state.assessments).slice(-60).map(([id,a]) => ({id,status:a.status,summary:a.summary})),
      workSessions: (this.store.state.workSessions || []).slice(-10), projects: this.store.state.projects || [], teams: this.store.state.teams.map(t => ({id:t.id,name:t.name,host:t.host,cwd:t.cwd,mission:t.mission.slice(0,1500)})), historyIndex: rows.slice(0,100).map(r => ({id:r.id,title:r.title,host:r.host,cwd:r.cwd})), messages: this.store.state.messages.slice(-12).map(m => ({ from: m.from, text: m.text.slice(0,600) })) };
  }
  async ask(prompt, group, live, history, workSessionId = '', automatic = false, environment = 'local') {
    if (this.running) throw new Error('Conductor is already replying.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) throw new Error('Enter a message of up to 6,000 characters.');
    const bin = which('codex');
    if (!bin) throw new Error('Conductor needs your installed Codex CLI and login.');
    this.running = true; this.cancelled = false;
    const entry = { id: crypto.randomUUID(), prompt, automatic, createdAt: new Date().toISOString(), status: 'running' };
    this.state.turns.push(entry); this.store.save();
    let outputFile;
    try {
      const snapshot = await this.snapshot(live, history, prompt);
      entry.coverage = snapshot.coverage;
      if(this.cancelled) throw new Error('Reply cancelled.');
      const cwd = path.join(dataDir, 'coordinator');
      fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
      outputFile = path.join(cwd, `${entry.id}.json`);
      const input = { userMessage: prompt, automatic, selectedEnvironment: environment, memory: this.state.memory, conversation: this.state.turns.filter(t => t.id !== entry.id && t.status === 'complete').slice(-8).map(t => ({ user: t.prompt, conductor: t.answer, actions:t.actions })), snapshot, actionResults:[] };
      let result;
      for (let round = 0; round < 3; round++) {
      if(this.cancelled) throw new Error('Reply cancelled.');
      result = await new Promise((resolve, reject) => {
        const child = spawn(bin, ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
          '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'plugins', '--disable', 'remote_plugin',
          '--disable', 'multi_agent', '--disable', 'skill_search', '--enable', 'skip_host_skill_discovery',
          '-c', 'web_search="disabled"', '-c', 'model_reasoning_effort="low"',
          '-c', `model_instructions_file=${JSON.stringify(fileURLToPath(new URL('./coordinator-instructions.md', import.meta.url)))}`,
          '-m', 'gpt-6-luna', '--output-schema', fileURLToPath(new URL('./conductor-schema.json', import.meta.url)),
          '--json', '-o', outputFile, '-'], { cwd, env, stdio: ['pipe','pipe','pipe'], detached: true });
        this.child = child;
        let stderr = '', json = '';
        const timeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 180000);
        child.stdout.on('data', d => { json = (json + d).slice(-200000); });
        child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
        child.on('error', err => { clearTimeout(timeout); reject(err); });
        child.on('close', code => {
          this.child = null;
          clearTimeout(timeout);
          if (code !== 0) return reject(new Error(stderr.trim().slice(-1200) || 'Reply cancelled or timed out.'));
          try {
            const events = json.split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
            resolve({ ...JSON.parse(fs.readFileSync(outputFile,'utf8')), usage: events.findLast(e => e.type === 'turn.completed')?.usage || null });
          } catch (e) { reject(e); }
        });
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify(input));
      });
      applyAssessments(this.state, result.assessments, snapshot.reviewEvidence);
      if (!Array.isArray(result.actions) || !result.actions.length) break;
      if (round === 2) { result.answer += '\n\nThe action limit for this reply was reached. Remaining actions were not run.'; break; }
      for (const action of result.actions.slice(0,4)) {
        if(this.cancelled) throw new Error('Reply cancelled.');
        let outcome;
        try {
          if (automatic && !['read_conversation','search_history'].includes(action.type)) throw new Error('Automatic briefings cannot change sessions or projects.');
          if (!this.actionHandler) throw new Error('Platform controls are unavailable.');
          outcome = await this.actionHandler(action);
        } catch(e) { outcome = {error:e.message}; }
        input.actionResults.push({action,result:outcome});
      }
      entry.actions = input.actionResults; this.store.save();
      input.snapshot.terminals = (await this.liveReader()).map(({id,title,host,cwd,provider,status,group}) => ({id,title,host,cwd,provider,status,group}));
      input.snapshot.workSessions = (this.store.state.workSessions || []).slice(-10); input.snapshot.teams = this.store.state.teams; input.snapshot.projects = this.store.state.projects || [];
      }
      if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('Conductor returned an empty reply. Please try again.');
      applyAssessments(this.state, result.assessments, snapshot.reviewEvidence);
      this.state.memory = String(result.memory || this.state.memory).slice(0, 4000);
      Object.assign(entry, { answer: result.answer, usage: result.usage, status: 'complete' });
    } catch (error) { Object.assign(entry, { status: 'error', answer: error.message }); }
    finally {
      if (outputFile) try { fs.unlinkSync(outputFile); } catch {}
      this.running = false; this.child = null; this.store.save();
    }
    return entry;
  }
  cancel() { this.cancelled = true; if (this.child?.pid) try { process.kill(-this.child.pid, 'SIGTERM'); } catch {} }
}
