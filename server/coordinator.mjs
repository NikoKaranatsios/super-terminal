import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dataDir, env, which } from './core.mjs';
import { ConductorLoop } from './conductor-loop.mjs';

export const MAX_INPUT_BYTES = 24000;
const READ_ACTIONS = new Set(['read_conversation', 'search_history']);
const REPLAY_GUARDED = new Set(['start_agent','start_team','start_work_session','create_project','create_task','create_goal','message_agent','prompt_agent','notify','add_team_members','brief_team','resume_conversation']);
const clip = (value, length = 600) => String(value ?? '').slice(0, length);
const terminal = s => ({ id:s.id, provider:s.provider, host:s.host, cwd:s.cwd, status:s.status, title:clip(s.title,200), projectId:s.projectId, taskId:s.taskId, scope:s.scope, historyId:s.historyId, runtime:!!s.runtime, connectionLost:!!s.connectionLost });
const canonical = value => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k] ?? null))])) : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const taskRows = state => Array.isArray(state.tasks) ? state.tasks : Object.values(state.tasks || {});
const isOpen = t => !['done','completed','cancelled','archived','stopped'].includes(t.status);
function compact(value, depth = 0) {
  if (typeof value === 'string') return clip(value, 1200);
  if (!value || typeof value !== 'object') return value;
  if (depth > 5) return '[nested content omitted]';
  if (Array.isArray(value)) return value.slice(0, 12).map(v => compact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([k,v]) => [k, compact(v, depth + 1)]));
}
export function boundInput(input, limit = MAX_INPUT_BYTES) {
  const out = JSON.parse(JSON.stringify(input));
  out.omitted ||= {};
  if (out.snapshot?.coverage) out.snapshot.coverage.sentReviewEvidence = out.snapshot.reviewEvidence?.length || 0;
  const size = () => Buffer.byteLength(JSON.stringify(out));
  for (const key of ['historyIndex','previousAssessments','reviewEvidence','messages','teams','projects','workSessions','terminals','tasks']) {
    const list = out.snapshot?.[key];
    while (size() > limit && list?.length) { list.pop(); out.omitted[key] = (out.omitted[key] || 0) + 1; }
  }
  while (size() > limit && out.conversation?.length) { out.conversation.shift(); out.omitted.conversation = (out.omitted.conversation || 0) + 1; }
  if (size() > limit && out.memory) { out.memory = ''; out.omitted.memory = true; }
  if (size() > limit) {
    out.actionResults = (out.actionResults || []).map(r => ({ action:{type:r.action.type,target:r.action.target}, status:r.status, result:{ error:clip(r.result?.error,300), result:clip(r.result?.result,300), id:r.result?.id } }));
    out.omitted.actionDetails = true;
  }
  if (size() > limit) throw new Error('This request exceeds the bounded Conductor input size. Send a shorter request.');
  if (out.snapshot?.coverage) out.snapshot.coverage.sentReviewEvidence = out.snapshot.reviewEvidence?.length || 0;
  return out;
}
export function applyAssessments(state, assessments, evidence) {
  const allowed = new Map(evidence.map(r => [r.id, r]));
  for (const item of Array.isArray(assessments) ? assessments : []) {
    const source = allowed.get(item.id);
    if (!source || !['open','completed','uncertain','stale'].includes(item.status)) continue;
    state.assessments[item.id] = { status:item.status, summary:clip(item.summary), version:source.updatedAt, reviewedAt:new Date().toISOString() };
  }
}
// An allowlist intentionally excludes reasoning items, encrypted content and raw envelopes.
export function publicProviderEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const item = event.item || {};
  if (['item.started','item.updated','item.completed'].includes(event.type)) {
    const base = { type:event.type, itemId:item.id, status:item.status, name:item.type };
    if (item.type === 'agent_message') return { ...base, text:clip(item.text,16000) };
    if (item.type === 'command_execution') return { ...base, command:clip(item.command,2000), output:clip(item.aggregated_output,16000), exitCode:item.exit_code };
    if (item.type === 'mcp_tool_call') return { ...base, name:[item.server,item.tool].filter(Boolean).join('/'), command:clip(JSON.stringify(compact(item.arguments || {})),4000), output:clip((item.result?.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n'),16000), text:clip(item.error?.message || '',2000) };
    if (item.type === 'web_search') return { ...base, text:clip(item.query,2000) };
    if (item.type === 'file_change') return { ...base, text:(item.changes || []).slice(0,40).map(c => `${clip(c.kind,40)} ${clip(c.path,300)}`).join('\n') };
    if (item.type === 'todo_list') return { ...base, text:(item.items || []).slice(0,40).map(x => `${x.completed ? '[x]' : '[ ]'} ${clip(x.text,300)}`).join('\n') };
    if (item.type === 'error') return { ...base, text:clip(item.message,2000) };
    return null;
  }
  if (['thread.started','turn.started','turn.completed','turn.failed','error'].includes(event.type)) return { type:event.type, text:clip(event.error?.message || event.message || '',2000), ...(event.type === 'turn.completed' ? { usage:event.usage || null } : {}) };
  // Only explicitly exposed summaries, never a generic "reasoning" object's text.
  if (event.type === 'reasoning_summary') return { type:event.type, text:clip(event.summary,6000) };
  return null;
}
export function collectWork(state, live = []) {
  const activeSessions = (state.workSessions || []).filter(s => s.status === 'active');
  const sessionIds = new Set(activeSessions.map(s => s.id));
  const archived = new Set((state.projects || []).filter(p => p.status === 'archived').map(p => p.id));
  const tasks = taskRows(state).filter(t => !['stopped','paused'].includes(t.status) && !archived.has(t.projectId) && (!t.scope?.workSessionId || sessionIds.has(t.scope.workSessionId)));
  const projectIds = new Set([...activeSessions.flatMap(s => s.projects.map(p => p.canonicalProjectId || p.projectId || p.id)), ...tasks.map(t => t.projectId)].filter(Boolean));
  const ids = new Set(tasks.map(t => t.id));
  for (const id of archived) projectIds.delete(id);
  const assignedIds = new Set(tasks.map(t => t.agentId).filter(Boolean));
  const managed = live.filter(s => s.kind === 'managed' && !s.enrollmentRevokedAt && !archived.has(s.projectId) && (!s.taskId || ids.has(s.taskId)) && (!s.scope?.workSessionId || sessionIds.has(s.scope.workSessionId)) && (sessionIds.has(s.scope?.workSessionId) || projectIds.has(s.projectId) || ids.has(s.taskId) || assignedIds.has(s.id)));
  const agentIds = new Set(managed.map(s => s.id));
  const messages = (state.messages || []).filter(m => agentIds.has(m.from) && ['coordinator','conductor'].includes(m.to)).slice(-20);
  const goals = activeSessions.flatMap(s => s.projects.filter(p => !archived.has(p.canonicalProjectId || p.projectId || p.id)).flatMap(p => (p.goals || []).filter(g => !['stopped','paused'].includes(g.status))));
  const scope = { workSessionIds:[...sessionIds], projectIds:[...projectIds], taskIds:[...ids], agentIds:[...agentIds] };
  const projection = { tasks:tasks.map(t => ({id:t.id,status:t.status,revision:t.revision,notes:t.notes,lastReport:t.lastReport})), goals:goals.map(g => ({id:g.id,status:g.status,notes:g.notes})), agents:managed.map(s => ({id:s.id,status:s.status,connectionLost:s.connectionLost})), messages:messages.map(m => m.id) };
  return { signature:digest(projection), eligible:!!(tasks.length || goals.length), hasWork:tasks.some(isOpen) || goals.some(isOpen), active:managed.some(s => ['running','external'].includes(s.status)), scope, live,
    coverage:{ tasks:tasks.length, enrolledAgents:managed.length, externalAgentsExcluded:live.filter(s => s.kind !== 'managed').length } };
}

export class Coordinator {
  running = false;
  child = null;
  constructor(store, options = {}) {
    this.store = store; this.options = options; this.now = options.now || Date.now;
    store.state.conductor ||= { turns:[], memory:'', assessments:{} };
    this.state = store.state.conductor;
    this.state.turns ||= []; this.state.assessments ||= {}; this.state.actionReceipts ||= {};
    this.state.loop ||= { state:'running', lastRoundAt:null, nextRoundAt:null, lastError:null, rounds:0 };
    if (!['running','paused','stopped'].includes(this.state.loop.state)) this.state.loop.state = 'stopped';
    for (const t of this.state.turns) if (t.status === 'running') Object.assign(t, { status:'error', answer:'The service closed before this reply finished. Recorded actions may already have completed; inspect their results before retrying.' });
    this.loop = new ConductorLoop(this.state.loop, {
      collect:async () => this.collectReader ? this.collectReader() : collectWork(this.store.state, await this.liveReader()),
      decide:async data => this.ask('Continue the user-authorized work in the supplied scope. Collect progress, resolve the next concrete step, coordinate agents, and notify the user only when useful. If blocked on the user, ask once and avoid repeated prompts.', '', data.live || await this.liveReader(), this.history, '', false, 'local', { autonomous:true, scope:data.scope }),
      busy:() => this.running, save:() => this.store.save(), now:this.now, ...options.loopOptions
    });
  }
  configure({ liveReader, history, actionHandler, collectReader } = {}) {
    if (liveReader) this.liveReader = liveReader;
    if (history) this.history = history;
    if (actionHandler) this.actionHandler = actionHandler;
    if (collectReader) this.collectReader = collectReader;
    return this;
  }
  startLoop(options = {}) {
    if (options.state) this.loop.control(options.state);
    if (!this.liveReader || !this.history) throw new Error('Conductor collection needs liveReader and history.');
    this.loop.start(); return this.state.loop;
  }
  controlLoop(value) {
    const state = this.loop.control(value);
    if (value !== 'running' && this.currentMode === 'autonomous') this.cancel();
    return state;
  }
  stopLoop() { this.loop.stop(); this.cancel(); this.state.loop.nextRoundAt = null; this.store.save(); }
  status() { return { running:this.running, history:this.state.turns.slice(-100), assessments:this.state.assessments, model:'gpt-6-luna', loop:{...this.state.loop}, usageTotals:{...this.state.usageTotals} }; }
  async snapshot(live, history, prompt, { scope, autonomous = false, workSessionId = '', group = '' } = {}) {
    const state = this.store.state;
    const allowedSessions = new Set(scope?.workSessionIds || (workSessionId ? [workSessionId] : []));
    const allowedProjects = new Set(scope?.projectIds || []);
    const allowedTasks = new Set(scope?.taskIds || []);
    const allowedAgents = new Set(scope?.agentIds || []);
    const exactScope = !!scope || autonomous;
    const scoped = exactScope || !!workSessionId || !!group;
    const visibleLive = live.filter(s => exactScope ? allowedAgents.has(s.id) : !scoped || allowedAgents.has(s.id) || allowedTasks.has(s.taskId) || allowedProjects.has(s.projectId) || allowedSessions.has(s.scope?.workSessionId) || (!autonomous && group && s.group === group));
    const liveHistoryIds = new Set(visibleLive.map(s => s.historyId).filter(Boolean));
    const allRows = autonomous ? [] : await history.all();
    const rows = allRows.filter(r => !scoped || liveHistoryIds.has(r.id));
    const pending = rows.filter(r => this.state.assessments[r.id]?.version !== r.updatedAt);
    // Autonomous status collection uses structured work, not repeated transcript reads.
    const selected = autonomous ? [] : pending.slice(0, 4);
    const words = prompt.toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu) || [];
    const relevant = autonomous ? [] : rows.filter(r => !selected.some(s => s.id === r.id) && words.some(w => `${r.title} ${r.cwd}`.toLowerCase().includes(w))).slice(0,2);
    const evidence = await Promise.all([...selected,...relevant].map(async r => {
      try { const t = await history.transcript(r.id); return { id:r.id, host:r.host, title:clip(r.title,160), updatedAt:r.updatedAt, messages:t.messages.slice(-2).map(m => ({role:m.role,text:clip(m.text,500)})) }; }
      catch(e) { return {id:r.id,updatedAt:r.updatedAt,error:clip(e.message,200)}; }
    }));
    const tasks = taskRows(state).filter(t => exactScope ? allowedTasks.has(t.id) : !scoped || allowedTasks.has(t.id) || allowedProjects.has(t.projectId) || allowedSessions.has(t.scope?.workSessionId)).sort((a,b) => Number(isOpen(b)) - Number(isOpen(a)));
    const parentSessions = new Set([...allowedSessions, ...(!autonomous && exactScope ? tasks.map(t=>t.scope?.workSessionId).filter(Boolean) : [])]);
    const sessions = (state.workSessions || []).filter(s => !scoped || parentSessions.has(s.id));
    const canonicalProject = p => p.canonicalProjectId || p.projectId || p.id;
    const teamVisible = team => {
      if (autonomous) return (!team.scope?.workSessionId || allowedSessions.has(team.scope.workSessionId)) && (allowedProjects.has(team.projectId) || allowedSessions.has(team.scope?.workSessionId));
      if (!exactScope) return !scoped || allowedProjects.has(team.projectId) || allowedSessions.has(team.scope?.workSessionId) || (group && team.name===group);
      if (team.scope?.workSessionId && parentSessions.size && !parentSessions.has(team.scope.workSessionId)) return false;
      if (scope?.layer==='task') return allowedTasks.has(team.scope?.goalId) || visibleLive.some(agent=>agent.teamId===team.id || (!agent.teamId && agent.group===team.name && agent.host===team.host && agent.cwd===team.cwd));
      return allowedProjects.has(team.projectId) || state.workSessions?.some(session=>parentSessions.has(session.id) && session.projects.some(p=>p.id===team.scope?.projectId && allowedProjects.has(canonicalProject(p))));
    };
    return { coverage:{indexed:rows.length,excludedHistory:allRows.length-rows.length,previouslyReviewed:rows.length-pending.length,reviewThisTurn:evidence.length,pending:pending.length-evidence.filter(e=>pending.some(p=>p.id===e.id)).length, totalTasks:tasks.length,totalTerminals:visibleLive.length},
      tasks:tasks.slice(0,80).map(t => ({ id:t.id,projectId:t.projectId,workSessionId:t.scope?.workSessionId,parentTaskId:t.parentTaskId,title:clip(t.title,200),status:t.status,notes:clip(t.notes),revision:t.revision,agentId:t.agentId,lastReport:compact(t.lastReport),evidence:compact((t.evidence || []).slice(-2)),dependsOn:t.dependsOn })),
      terminals:visibleLive.slice(0,40).map(terminal), reviewEvidence:evidence,
      workSessions:sessions.slice(-4).map(s => ({id:s.id,title:clip(s.title,200),status:s.status,...(!exactScope || autonomous ? {notes:clip(s.notes)} : {}),projects:s.projects.filter(p => !exactScope || allowedProjects.has(canonicalProject(p))).slice(0,12).map(p=>({id:p.id,canonicalProjectId:p.canonicalProjectId,projectId:p.projectId,name:clip(p.name,120),host:p.host,cwd:p.cwd,goals:(p.goals||[]).filter(g => !exactScope || allowedTasks.has(g.id)).slice(0,16).map(g=>({id:g.id,title:clip(g.title,200),status:g.status,notes:clip(g.notes,300)}))}))})),
      projects:(state.projects || []).filter(p=>!scoped || allowedProjects.has(p.id)).slice(0,24).map(p=>({id:p.id,name:clip(p.name,120),host:p.host,cwd:p.cwd,status:p.status,...(scope?.layer==='task' ? {} : {notes:clip(p.notes,300)})})),
      teams:(state.teams || []).filter(teamVisible).slice(0,16).map(t=>({id:t.id,name:clip(t.name,120),host:t.host,cwd:t.cwd,projectId:t.projectId,mission:clip(t.mission,400)})),
      historyIndex:rows.slice(0,16).map(r=>({id:r.id,title:clip(r.title,160),host:r.host,cwd:r.cwd})),
      messages:(state.messages || []).filter(m=>!scoped || visibleLive.some(s=>s.id===m.from || s.id===m.to)).slice(-10).map(m=>({id:m.id,from:m.from,to:m.to,group:m.group,read:m.read,text:clip(m.text,500)})) };
  }
  addTrace(entry, event) {
    const clean = publicProviderEvent(event);
    if (!clean) return;
    const row = {...clean,seq:(entry.traceSequence || 0)+1,at:new Date(this.now()).toISOString()};
    entry.traceSequence = row.seq;
    const bytes = Buffer.byteLength(JSON.stringify(row));
    entry.trace ||= [];
    if (entry.trace.length >= 512 || (entry.traceBytes || 0)+bytes > 131072) { entry.traceOmitted=(entry.traceOmitted||0)+1; return; }
    entry.trace.push(row); entry.traceBytes=(entry.traceBytes||0)+bytes;
    this.store.save(); this.options.onUpdate?.(entry);
  }
  async runModel(input, entry, round) {
    if (this.options.modelRunner) return this.options.modelRunner(input, {round,onEvent:event=>this.addTrace(entry,event),isCancelled:()=>this.cancelled});
    const bin = which('codex');
    if (!bin) throw new Error('Conductor needs your installed Codex CLI and login.');
    const cwd = path.join(dataDir,'coordinator'); fs.mkdirSync(cwd,{recursive:true,mode:0o700});
    const outputFile = path.join(cwd,`${entry.id}-${round}.json`);
    try {
      return await new Promise((resolve,reject) => {
        const child = spawn(bin,['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only',
          '--disable','shell_tool','--disable','unified_exec','--disable','plugins','--disable','remote_plugin','--disable','multi_agent','--disable','skill_search','--enable','skip_host_skill_discovery',
          '-c','web_search="disabled"','-c','model_reasoning_effort="low"','-c',`model_instructions_file=${JSON.stringify(fileURLToPath(new URL('./coordinator-instructions.md',import.meta.url)))}`,
          '-m','gpt-6-luna','--output-schema',fileURLToPath(new URL('./conductor-schema.json',import.meta.url)),'--json','-o',outputFile,'-'],{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});
        this.child=child;
        let stderr='', buffer='', usage=null;
        const consume = line => { try { const event=JSON.parse(line); if(event.type==='turn.completed')usage=event.usage || usage; this.addTrace(entry,event); } catch {} };
        const timeout=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}},180000);
        child.stdout.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(buffer.length>262144){buffer='';entry.traceOmitted=(entry.traceOmitted||0)+1;}});
        child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
        child.on('error',error=>{clearTimeout(timeout);reject(error);});
        child.on('close',code=>{clearTimeout(timeout);this.child=null;if(buffer.trim())consume(buffer);if(code!==0)return reject(Object.assign(new Error(stderr.trim().slice(-1200)||'Reply cancelled or timed out.'),{usage}));try{resolve({...JSON.parse(fs.readFileSync(outputFile,'utf8')),usage});}catch(e){reject(Object.assign(e,{usage}));}});
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
      });
    } finally { try {fs.unlinkSync(outputFile);}catch{} }
  }
  async ask(prompt, group, live, history, workSessionId='', automatic=false, environment='local', options={}) {
    if(this.running)throw new Error('Conductor is already replying.');
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>6000)throw new Error('Enter a message of up to 6,000 characters.');
    this.running=true;this.cancelled=false;this.currentMode=options.autonomous?'autonomous':automatic?'briefing':'manual';
    const entry={id:randomUUID(),prompt,automatic:automatic||!!options.autonomous,mode:this.currentMode,createdAt:new Date(this.now()).toISOString(),status:'running',trace:[],actions:[],usage:null,modelRounds:0};
    this.state.turns.push(entry);this.store.save();
    try {
      if(options.autonomous)entry.observedSignature=collectWork(this.store.state,live).signature;
      let snapshot=await this.snapshot(live,history,prompt,{...options,workSessionId,group});entry.coverage=snapshot.coverage;
      const input={userMessage:prompt,mode:this.currentMode,automatic,authorizedScope:options.scope||null,selectedEnvironment:environment,memory:clip(this.state.memory,1600),
        conversation:this.state.turns.filter(t=>t.id!==entry.id&&t.status==='complete'&&t.mode!=='autonomous').slice(-4).map(t=>({user:clip(t.prompt,500),conductor:clip(t.answer,700)})),snapshot,actionResults:[]};
      let result;const executed=new Map();
      for(let round=0;round<3;round++) {
        if(this.cancelled)throw new Error('Reply cancelled. Recorded actions were not rolled back.');
        const bounded=boundInput(input);entry.inputBytes=Buffer.byteLength(JSON.stringify(bounded));entry.omitted=bounded.omitted;
        entry.modelRounds++;
        try { result=await this.runModel(bounded,entry,round); } catch(error) { if(error.usage) this.addUsage(entry,error.usage); throw error; }
        this.addUsage(entry,result?.usage);
        if(!result||typeof result.answer!=='string'||!Array.isArray(result.actions)||!Array.isArray(result.assessments))throw new Error('Conductor returned an invalid structured reply.');
        applyAssessments(this.state,result.assessments,bounded.snapshot.reviewEvidence||[]);
        if(this.cancelled)throw new Error('Reply cancelled. Recorded actions were not rolled back.');
        if(!result.actions.length)break;
        for(let index=0;index<result.actions.length;index++) {
          const action=result.actions[index];
          const key=digest(action);
          if(round===2||index>=4) {entry.actions.push({action,status:'not_run',result:{error:'Action limit reached.'}});continue;}
          if(this.cancelled) {entry.actions.push({action,status:'not_run',result:{error:'Reply cancelled.'}});continue;}
          const prior=executed.get(key)||(options.autonomous&&REPLAY_GUARDED.has(action.type)?this.state.actionReceipts[key]:null);
          if(prior){const receipt={action,status:'duplicate',result:prior.result||{error:'A prior operation may have partial effects. Inspect current state before retrying.'}};entry.actions.push(receipt);input.actionResults.push(compact(receipt));continue;}
          const ledger={action,status:'started'};entry.actions.push(ledger);
          const guarded=options.autonomous&&REPLAY_GUARDED.has(action.type);
          if(guarded)this.state.actionReceipts[key]={status:'started',turnId:entry.id};
          this.store.save();
          try {
            if(automatic&&!READ_ACTIONS.has(action.type))throw new Error('Automatic briefings cannot mutate work. Continuous orchestration is a separate mode.');
            if(!this.actionHandler)throw new Error('Platform controls are unavailable.');
            ledger.result=await this.actionHandler(action,{autonomous:!!options.autonomous,scope:options.scope||null,turnId:entry.id,operationId:`${entry.id}:${key}`});
            ledger.status=ledger.result?.error?'failed':'executed';
          }catch(e){ledger.status='failed';ledger.result={error:e.message};}
          executed.set(key,ledger);if(guarded)this.state.actionReceipts[key]={...compact(ledger),turnId:entry.id};
          input.actionResults.push(compact(ledger));this.store.save();
        }
        if(round===2){result.answer+='\n\nRemaining actions were not run because the round limit was reached.';break;}
        const refreshedLive=await this.liveReader();
        if(options.autonomous)entry.observedSignature=collectWork(this.store.state,refreshedLive).signature;
        input.snapshot=await this.snapshot(refreshedLive,history,prompt,{...options,workSessionId,group});
      }
      if(!result.answer.trim())throw new Error('Conductor returned an empty reply.');
      this.state.memory=clip(result.memory||this.state.memory,2500);
      Object.assign(entry,{answer:result.answer,status:'complete'});
    }catch(error){Object.assign(entry,{status:'error',answer:error.message});}
    finally{this.running=false;this.child=null;this.currentMode=null;this.store.save();this.options.onUpdate?.(entry);}
    return entry;
  }
  addUsage(entry,usage) { if(usage && typeof usage === 'object') { entry.usage ||= {}; for(const [key,value] of Object.entries(usage)) if(Number.isFinite(value)) { entry.usage[key]=(entry.usage[key]||0)+value; this.state.usageTotals ||= {}; this.state.usageTotals[key]=(this.state.usageTotals[key]||0)+value; } } }
  cancel(){this.cancelled=true;if(this.child?.pid)try{process.kill(-this.child.pid,'SIGTERM');}catch{}}
}
