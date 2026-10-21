import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dataDir, env, which } from './core.mjs';
import { ConductorLoop } from './conductor-loop.mjs';
import { collectProgress, normalizeFocus, hasFocus } from './conductor-progress.mjs';

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
  for (const key of ['historyIndex','previousAssessments','reviewEvidence','messages','teams','projects','workSessions','terminals','tasks','observedAgents','observations']) {
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
export function collectWork(state, live = [], options = {}) {
  const suppliedFocus = options.focus || state.conductor?.focus || {};
  const focus = { ...normalizeFocus(suppliedFocus), ...(typeof suppliedFocus.revision==='string'?{revision:suppliedFocus.revision}:{}), updatedAt:suppliedFocus.updatedAt || '' };
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
  const progress = collectProgress(state, live, scope, focus, options.activity);
  const reviewed = new Set(state.conductor?.reviewedObservationIds || []);
  const reviewedFocus = new Set(state.conductor?.reviewedFocusObservationIds || []);
  const baseline = Date.parse(state.conductor?.progressStartedAt || '') || 0;
  const pendingObservationIds = progress.observations.filter(o => o.kind === 'current_context' ? !reviewedFocus.has(o.id) : !reviewed.has(o.id) && (Date.parse(o.at) || 0) >= baseline).map(o => o.id);
  const projection = { tasks:tasks.map(t => ({id:t.id,status:t.status,revision:t.revision,notes:t.notes,lastReport:t.lastReport})), goals:goals.map(g => ({id:g.id,status:g.status,notes:g.notes})), agents:managed.map(s => ({id:s.id,status:s.status,connectionLost:s.connectionLost})), messages:messages.map(m => m.id), projects:(state.projects || []).filter(p=>projectIds.has(p.id)).map(p=>({id:p.id,name:p.name,notes:p.notes,status:p.status})), observations:progress.observations.map(o=>o.id), focus:hasFocus(focus) ? focus.revision : null, observedAgents:progress.observedAgents };
  return { signature:digest(projection), eligible:!!(tasks.length || goals.length || hasFocus(focus)), hasWork:tasks.some(isOpen) || goals.some(isOpen), active:managed.some(s => ['running','external'].includes(s.status)), scope, live, focus, ...progress, pendingObservationIds, pendingReview:pendingObservationIds.length > 0,
    coverage:{ tasks:tasks.length, enrolledAgents:managed.length, externalAgentsExcluded:live.filter(s => s.kind !== 'managed').length, observedProgress:progress.observations.length, omittedProgress:progress.omitted } };
}

export function projectCollection(state, data, projectId) {
  const tasks = taskRows(state).filter(t=>data.scope.taskIds.includes(t.id) && t.projectId===projectId);
  const taskIds = new Set(tasks.map(t=>t.id));
  const agentIds = new Set(data.live.filter(a=>data.scope.agentIds.includes(a.id) && (a.projectId===projectId || taskIds.has(a.taskId) || tasks.some(t=>t.agentId===a.id))).map(a=>a.id));
  const workSessionIds = data.scope.workSessionIds.filter(id=>tasks.some(t=>t.scope?.workSessionId===id) || state.workSessions?.some(s=>s.id===id && s.projects.some(p=>(p.canonicalProjectId || p.projectId || p.id)===projectId)));
  const scope = {layer:'project',projectIds:[projectId],taskIds:[...taskIds],agentIds:[...agentIds],workSessionIds};
  const supplied = data.focus || normalizeFocus({});
  const focused = supplied.projectId===projectId || taskIds.has(supplied.taskId) || supplied.agentIds.some(id=>agentIds.has(id));
  const focus = focused ? {...supplied,agentIds:supplied.agentIds.filter(id=>agentIds.has(id)),historyIds:supplied.historyIds.filter(id=>data.live.some(a=>agentIds.has(a.id) && a.historyId===id))} : normalizeFocus({});
  const progress = collectProgress(state,data.live,scope,focus);
  const pendingObservationIds = data.pendingObservationIds.filter(id=>progress.observations.some(o=>o.id===id));
  const messages = (state.messages || []).filter(m=>agentIds.has(m.from) && ['conductor','coordinator'].includes(m.to)).slice(-20);
  const signature = digest({project:(state.projects || []).find(p=>p.id===projectId),teams:(state.teams || []).filter(t=>t.projectId===projectId).map(t=>({id:t.id,name:t.name,mission:t.mission,contentProjectIds:t.contentProjectIds,sharedProjectIds:t.sharedProjectIds})),tasks:tasks.map(t=>({id:t.id,status:t.status,revision:t.revision})),agents:data.live.filter(a=>agentIds.has(a.id)).map(a=>({id:a.id,status:a.status,connectionLost:a.connectionLost,projectId:a.projectId,contextProjectId:a.contextProjectId,teamId:a.teamId,assignmentRevision:a.assignmentRevision,historyId:a.historyId,contentProjectIds:a.contentProjectIds,contextIsolation:a.contextIsolation})),observations:progress.observations.map(o=>o.id),focus:hasFocus(focus)?focus.revision:null,messages:messages.map(m=>m.id)});
  return {...data,scope,focus,...progress,pendingObservationIds,projectSignature:signature,hasWork:tasks.some(isOpen),pendingReview:pendingObservationIds.length>0};
}

export function contextProvenance(state, live, scope) {
  const selected=[...new Set(scope?.projectIds || [])];
  const projectScoped=selected.length===1 && ['project','task'].includes(scope?.layer);
  if(!projectScoped)return {key:'global',projectIds:(state.projects || []).map(p=>p.id),isolated:false,projectScoped:false,unknownSources:true,teamId:null};
  const sources=new Set(selected);let unknownSources=false;
  const visible=live.filter(a=>scope.agentIds.includes(a.id));
  const teams=new Set(visible.map(a=>a.teamId).filter(Boolean));
  for(const team of state.teams || [])if(team.projectId===selected[0] || teams.has(team.id))for(const source of [...(team.contentProjectIds || []),...(team.sharedProjectIds || [])])sources.add(source);
  const visibleIds=new Set(visible.map(a=>a.id));
  const provenanceAgents=[...visible,...(state.sessions || []).filter(a=>visibleIds.has(a.id) || (a.teamId && teams.has(a.teamId)))];
  for(const agent of provenanceAgents){const source=agent.contextProjectId || agent.projectId;if(source)sources.add(source);else unknownSources=true;for(const id of agent.contentProjectIds || [])sources.add(id);if(agent.contextIsolation)unknownSources=true;}
  for(const message of (state.messages || []).filter(m=>visibleIds.has(m.from) && ['conductor','coordinator'].includes(m.to)).slice(-10))for(const id of message.sourceProjectIds || [])sources.add(id);
  for(const task of taskRows(state).filter(t=>scope.taskIds.includes(t.id)))for(const id of task.contentProjectIds || [])sources.add(id);
  const projectIds=[...sources].sort();
  const isolated=projectIds.length===1 && !unknownSources;
  return {key:isolated?`project:${selected[0]}`:`project:${selected[0]}:shared:${digest([projectIds,unknownSources]).slice(0,16)}`,projectIds,isolated,projectScoped:true,unknownSources,teamId:teams.size===1?[...teams][0]:null};
}

function includeActionSources(context,state,action) {
  if(!context.projectScoped)return;
  const sourceIds=new Set(context.projectIds);
  const ids=new Set([action.target,action.taskId,action.goalId,action.teamId].filter(Boolean));
  const teams=new Set((state.teams || []).filter(t=>ids.has(t.id)).map(t=>t.id));
  for(const agent of state.sessions || [])if(ids.has(agent.id) || teams.has(agent.teamId)){
    const source=agent.contextProjectId || agent.projectId;if(source)sourceIds.add(source);else context.unknownSources=true;
    for(const id of agent.contentProjectIds || [])sourceIds.add(id);if(agent.contextIsolation)context.unknownSources=true;
  }
  for(const task of taskRows(state))if(ids.has(task.id)){if(task.projectId)sourceIds.add(task.projectId);for(const id of task.contentProjectIds || [])sourceIds.add(id);}
  for(const team of state.teams || [])if(ids.has(team.id)){if(team.projectId)sourceIds.add(team.projectId);for(const source of [...(team.contentProjectIds || []),...(team.sharedProjectIds || [])])sourceIds.add(source);}
  if((state.workSessions || []).some(s=>ids.has(s.id)))context.unknownSources=true; // Whole-session replies include cross-project prose.
  context.projectIds=[...sourceIds].sort();
  if(context.projectIds.length>1 || context.unknownSources)context.isolated=false;
}

export class Coordinator {
  running = false;
  child = null;
  constructor(store, options = {}) {
    this.store = store; this.options = options; this.now = options.now || Date.now;
    store.state.conductor ||= { turns:[], memory:'', assessments:{} };
    this.state = store.state.conductor;
    this.state.turns ||= []; this.state.assessments ||= {}; this.state.actionReceipts ||= {};
    this.state.progressStartedAt ||= new Date(this.now()).toISOString();
    this.state.reviewedObservationIds ||= []; this.state.contextMemory ||= {}; this.state.reviewedProjectSignatures ||= {}; this.progressCache = new Map();
    this.state.loop ||= { state:'running', lastRoundAt:null, nextRoundAt:null, lastError:null, rounds:0 };
    if (!['running','paused','stopped'].includes(this.state.loop.state)) this.state.loop.state = 'stopped';
    for (const t of this.state.turns) if (t.status === 'running') Object.assign(t, { status:'error', answer:'The service closed before this reply finished. Recorded actions may already have completed; inspect their results before retrying.' });
    this.loop = new ConductorLoop(this.state.loop, {
      collect:async () => this.collectReader ? this.collectReader() : this.collect(),
      decide:async data => this.decide(data),
      busy:() => this.running, save:() => this.store.save(), now:this.now, ...options.loopOptions
    });
  }
  configure({ liveReader, history, actionHandler, collectReader, progressReader, focusReader } = {}) {
    if (liveReader) this.liveReader = liveReader;
    if (history) this.history = history;
    if (actionHandler) this.actionHandler = actionHandler;
    if (collectReader) this.collectReader = collectReader;
    if (progressReader) this.progressReader = progressReader;
    if (focusReader) this.focusReader = focusReader;
    return this;
  }
  setFocus(input, { wake = true } = {}) {
    const focus = normalizeFocus(input);
    if (focus.revision === (this.state.focus?.contentKey || (this.state.focus ? normalizeFocus(this.state.focus).revision : null))) return this.state.focus;
    this.state.focusVersion=(this.state.focusVersion || 0)+1;
    this.state.focus = { ...focus, contentKey:focus.revision, revision:`${focus.revision}:${this.state.focusVersion}`, updatedAt:new Date(this.now()).toISOString() };
    this.state.reviewedFocusObservationIds=[];
    this.store.save(); if (wake) this.loop.wake(); return this.state.focus;
  }
  async collect(live) {
    if (this.focusReader) this.setFocus(await this.focusReader(), {wake:false});
    const data=collectWork(this.store.state, live || await this.liveReader());
    data.projectRounds=data.scope.projectIds.map(id=>projectCollection(this.store.state,data,id)).filter(part=>{
      const previous=this.state.reviewedProjectSignatures[part.scope.projectIds[0]];
      return previous!==part.projectSignature && (previous || part.hasWork || part.pendingReview);
    }).sort((a,b)=>Number(b.pendingReview)-Number(a.pendingReview) || Number(hasFocus(b.focus))-Number(hasFocus(a.focus)));
    data.pendingReview ||= data.projectRounds.length>0;
    return data;
  }
  async decide(data) {
    const selected=data.projectRounds?.[0] || data;
    return this.ask('Continue the user-authorized work in this context. Review new progress, distinguish response completion from verified task completion, coordinate the next concrete step, and notify the owner only when useful. Unchanged work needs no repeated status request.', '', selected.live, this.history, '', false, 'local', {autonomous:true,scope:selected.scope,collection:selected});
  }
  async progressEvidence(observations, focus, scope, live) {
    const selected = observations.filter(o => o.historyId && !this.progressCache.has(o.id)).slice(0,3);
    if (selected.length && this.progressReader) {
      let rows;
      try { rows = await this.progressReader({observations:selected,focus,scope,live}); }
      catch { rows = []; }
      for (const observation of selected) {
        const found = (Array.isArray(rows) ? rows : []).find(row=>row?.observationId === observation.id);
        this.progressCache.set(observation.id, found ? {summary:clip(found.summary,1200),evidence:clip(found.evidence,1200),unavailable:!!found.unavailable} : {unavailable:true});
      }
      while (this.progressCache.size > 256) this.progressCache.delete(this.progressCache.keys().next().value);
    }
    return observations.map(o => this.progressCache.has(o.id) ? {...o,excerpt:{...this.progressCache.get(o.id),source:'provider_history',trusted:false}} : o);
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
  status() { return { running:this.running, history:this.state.turns.slice(-100), assessments:this.state.assessments, model:'gpt-6-luna', loop:{...this.state.loop}, usageTotals:{...this.state.usageTotals}, focus:this.state.focus || null }; }
  async snapshot(live, history, prompt, { scope, autonomous = false, workSessionId = '', group = '', collection, context } = {}) {
    const state = this.store.state;
    const isolated = !!context?.projectScoped;
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
      if (autonomous) return (!team.scope?.workSessionId || allowedSessions.has(team.scope.workSessionId)) && allowedProjects.has(team.projectId);
      if (!exactScope) return !scoped || allowedProjects.has(team.projectId) || allowedSessions.has(team.scope?.workSessionId) || (group && team.name===group);
      if (team.scope?.workSessionId && parentSessions.size && !parentSessions.has(team.scope.workSessionId)) return false;
      if (scope?.layer==='task') return allowedTasks.has(team.scope?.goalId) || visibleLive.some(agent=>agent.teamId===team.id);
      return allowedProjects.has(team.projectId) || state.workSessions?.some(session=>parentSessions.has(session.id) && session.projects.some(p=>p.id===team.scope?.projectId && allowedProjects.has(canonicalProject(p))));
    };
    const collected = collection || collectWork(state,live);
    let focus = collected.focus || normalizeFocus({});
    if (scope && (isolated || !autonomous) && !scope.projectIds?.some(id=>id===focus.projectId) && !scope.taskIds?.includes(focus.taskId) && !scope.agentIds?.some(id=>focus.agentIds.includes(id))) focus = normalizeFocus({});
    if(isolated)focus={...focus,summary:undefined,agentIds:focus.agentIds.filter(id=>allowedAgents.has(id)),historyIds:focus.historyIds.filter(id=>live.some(a=>allowedAgents.has(a.id) && a.historyId===id))};
    const progress = collectProgress(state,live,scope || collected.scope,focus);
    const pendingIds = new Set(collected.pendingObservationIds || []);
    const observations = progress.observations.sort((a,b)=>Number(pendingIds.has(b.id))-Number(pendingIds.has(a.id))).slice(0,16);
    const progressRows = await this.progressEvidence(observations,focus,scope || collected.scope,live);
    return { observations:progressRows, observedAgents:progress.observedAgents.filter(a=>!isolated || allowedAgents.has(a.id)), currentFocus:hasFocus(focus) ? {...focus,authority:'context_only'} : null, coverage:{observedProgress:observations.length,omittedProgress:Math.max(0,progress.observations.length-observations.length)+progress.omitted,indexed:rows.length,excludedHistory:allRows.length-rows.length,previouslyReviewed:rows.length-pending.length,reviewThisTurn:evidence.length,pending:pending.length-evidence.filter(e=>pending.some(p=>p.id===e.id)).length, totalTasks:tasks.length,totalTerminals:visibleLive.length},
      tasks:tasks.slice(0,80).map(t => ({ id:t.id,projectId:t.projectId,workSessionId:t.scope?.workSessionId,parentTaskId:t.parentTaskId,title:clip(t.title,200),status:t.status,notes:clip(t.notes),revision:t.revision,agentId:t.agentId,lastReport:compact(t.lastReport),evidence:compact((t.evidence || []).slice(-2)),dependsOn:t.dependsOn })),
      terminals:visibleLive.slice(0,40).map(terminal), reviewEvidence:evidence,
      workSessions:sessions.slice(-4).map(s => ({id:s.id,...(isolated ? {} : {title:clip(s.title,200)}),status:s.status,...(!isolated && (!exactScope || autonomous) ? {notes:clip(s.notes)} : {}),projects:s.projects.filter(p => !exactScope || allowedProjects.has(canonicalProject(p))).slice(0,12).map(p=>({id:p.id,canonicalProjectId:p.canonicalProjectId,projectId:p.projectId,name:clip(p.name,120),host:p.host,cwd:p.cwd,goals:(p.goals||[]).filter(g => !exactScope || allowedTasks.has(g.id)).slice(0,16).map(g=>({id:g.id,title:clip(g.title,200),status:g.status,notes:clip(g.notes,300)}))}))})),
      projects:(state.projects || []).filter(p=>!scoped || allowedProjects.has(p.id)).slice(0,24).map(p=>({id:p.id,name:clip(p.name,120),host:p.host,cwd:p.cwd,status:p.status,...(scope?.layer==='task' ? {} : {notes:clip(p.notes,300)})})),
      teams:(state.teams || []).filter(teamVisible).filter(t=>!isolated || t.projectId===scope.projectIds[0]).slice(0,16).map(t=>({id:t.id,name:clip(t.name,120),host:t.host,cwd:t.cwd,projectId:t.projectId,mission:clip(t.mission,400)})),
      historyIndex:rows.slice(0,16).map(r=>({id:r.id,title:clip(r.title,160),host:r.host,cwd:r.cwd})),
      messages:(state.messages || []).filter(m=>isolated ? visibleLive.some(s=>s.id===m.from) && ['conductor','coordinator'].includes(m.to) : !scoped || visibleLive.some(s=>s.id===m.from || s.id===m.to)).slice(-10).map(m=>({id:m.id,from:m.from,to:m.to,...(isolated?{}:{group:m.group}),read:m.read,sourceProjectIds:m.sourceProjectIds,text:clip(m.text,500)})) };
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
    const projectIds=[...new Set(options.scope?.projectIds || [])];
    const context=contextProvenance(this.store.state,live,options.scope);
    const isolated=context.projectScoped;
    options={...options,context};
    const entry={id:randomUUID(),context,prompt,automatic:automatic||!!options.autonomous,mode:this.currentMode,createdAt:new Date(this.now()).toISOString(),status:'running',trace:[],actions:[],usage:null,modelRounds:0};
    this.state.turns.push(entry);this.store.save();
    try {
      if(options.autonomous){ const observed=options.collection || collectWork(this.store.state,live); entry.observedSignature=observed.signature; entry.observedProjectSignature=observed.projectSignature; }
      let snapshot=await this.snapshot(live,history,prompt,{...options,workSessionId,group});entry.coverage=snapshot.coverage;
      const input={userMessage:prompt,mode:this.currentMode,automatic,authorizedScope:options.scope||null,selectedEnvironment:environment,context,memory:clip(isolated ? this.state.contextMemory[context.key] : this.state.memory,1600),
        conversation:this.state.turns.filter(t=>t.id!==entry.id&&t.status==='complete'&&t.mode!=='autonomous' && (isolated ? t.context?.key===context.key && t.context?.isolated===context.isolated && !t.context?.unknownSources && digest(t.context?.projectIds || [])===digest(context.projectIds) : !t.context?.projectScoped)).slice(-4).map(t=>({user:clip(t.prompt,500),conductor:clip(t.answer,700)})),snapshot,actionResults:[]};
      let result;const executed=new Map();
      for(let round=0;round<3;round++) {
        if(this.cancelled)throw new Error('Reply cancelled. Recorded actions were not rolled back.');
        const latestContext=contextProvenance(this.store.state,live,options.scope);
        for(const id of latestContext.projectIds)if(!context.projectIds.includes(id))context.projectIds.push(id);
        context.unknownSources ||= latestContext.unknownSources;
        if(context.projectIds.length>1 || context.unknownSources)context.isolated=false;
        const bounded=boundInput(input);entry.inputBytes=Buffer.byteLength(JSON.stringify(bounded));entry.omitted=bounded.omitted;
        entry.observedObservationIds=[...new Set([...(entry.observedObservationIds || []),...(bounded.snapshot.observations || []).map(o=>o.id)])];
        if(bounded.snapshot.currentFocus)entry.focusRevision=bounded.snapshot.currentFocus.revision;
        entry.modelRounds++;
        try { result=await this.runModel(bounded,entry,round); } catch(error) { if(error.usage) this.addUsage(entry,error.usage); throw error; }
        this.addUsage(entry,result?.usage);
        if(!result||typeof result.answer!=='string'||!Array.isArray(result.actions)||!Array.isArray(result.assessments))throw new Error('Conductor returned an invalid structured reply.');
        applyAssessments(this.state,result.assessments,bounded.snapshot.reviewEvidence||[]);
        if(this.cancelled)throw new Error('Reply cancelled. Recorded actions were not rolled back.');
        if(!result.actions.length)break;
        for(let index=0;index<result.actions.length;index++) {
          const action=result.actions[index];
          const key=digest({context:context.key,action});
          if(round===2||index>=4) {entry.actions.push({action,status:'not_run',result:{error:'Action limit reached.'}});continue;}
          if(this.cancelled) {entry.actions.push({action,status:'not_run',result:{error:'Reply cancelled.'}});continue;}
          const prior=executed.get(key)||(options.autonomous&&REPLAY_GUARDED.has(action.type)?this.state.actionReceipts[key]:null);
          if(prior){
            const source=prior.sourceContext;
            if(source){for(const id of source.projectIds || [])if(!context.projectIds.includes(id))context.projectIds.push(id);context.unknownSources ||= source.unknownSources;if(context.projectIds.length>1 || context.unknownSources)context.isolated=false;}
            const known=executed.has(key) || (source && source.key===context.key);
            const receipt={action,status:'duplicate',result:known ? prior.result||{error:'A prior operation may have partial effects. Inspect current state before retrying.'} : {error:'A prior operation exists in another or unknown context. Inspect current scoped state; its content was not imported.'}};
            entry.actions.push(receipt);input.actionResults.push(compact(receipt));continue;
          }
          const ledger={action,status:'started'};entry.actions.push(ledger);
          const guarded=options.autonomous&&REPLAY_GUARDED.has(action.type);
          if(guarded)this.state.actionReceipts[key]={status:'started',turnId:entry.id};
          this.store.save();
          try {
            if(automatic&&!READ_ACTIONS.has(action.type))throw new Error('Automatic briefings cannot mutate work. Continuous orchestration is a separate mode.');
            if(!this.actionHandler)throw new Error('Platform controls are unavailable.');
            if(isolated && action.type==='search_history')throw new Error('Global history search is unavailable in an isolated project turn.');
            if(isolated && action.type==='read_conversation' && !live.some(a=>options.scope.agentIds.includes(a.id) && a.historyId===action.target))throw new Error('Conversation is outside the isolated project context.');
            includeActionSources(context,this.store.state,action);
            ledger.result=await this.actionHandler(action,{autonomous:!!options.autonomous,scope:options.scope||null,context,contextKey:context.key,contextProjectIds:context.projectIds,mixedContext:!context.isolated,turnId:entry.id,operationId:`${entry.id}:${key}`});
            ledger.status=ledger.result?.error?'failed':'executed';
          }catch(e){ledger.status='failed';ledger.result={error:e.message};}
          ledger.sourceContext={...context,projectIds:[...context.projectIds]};
          executed.set(key,ledger);if(guarded)this.state.actionReceipts[key]={...compact(ledger),sourceContext:ledger.sourceContext,turnId:entry.id};
          const afterContext=contextProvenance(this.store.state,live,options.scope);
          for(const id of afterContext.projectIds)if(!context.projectIds.includes(id))context.projectIds.push(id);
          context.unknownSources ||= afterContext.unknownSources;
          if(context.projectIds.length>1 || context.unknownSources)context.isolated=false;
          input.actionResults.push(compact(ledger));this.store.save();
        }
        if(round===2){result.answer+='\n\nRemaining actions were not run because the round limit was reached.';break;}
        const refreshedLive=await this.liveReader();
        live=refreshedLive;
        let refreshed=collectWork(this.store.state,refreshedLive);
        if(options.autonomous && isolated)refreshed=projectCollection(this.store.state,refreshed,projectIds[0]);
        if(options.autonomous){entry.observedSignature=refreshed.signature;entry.observedProjectSignature=refreshed.projectSignature;options={...options,scope:refreshed.scope};input.authorizedScope=refreshed.scope;}
        input.snapshot=await this.snapshot(refreshedLive,history,prompt,{...options,collection:refreshed,workSessionId,group});
      }
      if(!result.answer.trim())throw new Error('Conductor returned an empty reply.');
      if(isolated && context.isolated)this.state.contextMemory[context.key]=clip(result.memory||this.state.contextMemory[context.key],2500);
      else if(!isolated)this.state.memory=clip(result.memory||this.state.memory,2500);
      if(options.autonomous && isolated && entry.observedProjectSignature)this.state.reviewedProjectSignatures[projectIds[0]]=entry.observedProjectSignature;
      this.state.reviewedObservationIds=[...new Set([...this.state.reviewedObservationIds,...(entry.observedObservationIds || [])])].slice(-256);
      if(entry.focusRevision===this.state.focus?.revision)this.state.reviewedFocusObservationIds=[...new Set([...(this.state.reviewedFocusObservationIds || []),...(entry.observedObservationIds || []).filter(id=>id.startsWith(`focus:${entry.focusRevision}:`))])].slice(-16);
      Object.assign(entry,{answer:result.answer,status:'complete'});
    }catch(error){Object.assign(entry,{status:'error',answer:error.message});}
    finally{this.running=false;this.child=null;this.currentMode=null;this.store.save();this.options.onUpdate?.(entry);}
    return entry;
  }
  addUsage(entry,usage) { if(usage && typeof usage === 'object') { entry.usage ||= {}; for(const [key,value] of Object.entries(usage)) if(Number.isFinite(value)) { entry.usage[key]=(entry.usage[key]||0)+value; this.state.usageTotals ||= {}; this.state.usageTotals[key]=(this.state.usageTotals[key]||0)+value; } } }
  cancel(){this.cancelled=true;if(this.child?.pid)try{process.kill(-this.child.pid,'SIGTERM');}catch{}}
}
