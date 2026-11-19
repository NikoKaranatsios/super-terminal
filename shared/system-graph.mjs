import { workspaceRecords } from './workspace-records.mjs';

export const graphId = (kind, id) => `${kind}:${id}`;
const text = value => typeof value === 'string' ? value : '';
const summary = value => text(value).replace(/\s+/g, ' ').slice(0, 180);
const owner = id => ['coordinator','conductor'].includes(id) ? 'conductor' : id === 'you' ? 'owner' : graphId('agent',id);
export function latestTrace(turn) {
  const latest=new Map();
  for (const [index,event] of (turn?.trace || turn?.events || []).entries()) {
    if (event.structuredResponse || (event.name==='agent_message' && /^\s*\{/.test(event.text || '')) || /reasoning/.test(event.name || '')) continue;
    if (['thread.started','turn.started','turn.completed'].includes(event.type)) continue;
    latest.set(event.itemId ? `${event.round ?? ''}:${event.itemId}` : String(index),event);
  }
  return [...latest.values()].sort((a,b)=>(a.seq || 0)-(b.seq || 0));
}
export function activeConductor(state) {
  const conductor=state.coordinator || {},turn=(conductor.history || []).findLast(t=>t.status==='running');
  const events=latestTrace(turn),event=events.at(-1);
  const active=events.filter(e=>e.type==='item.started' || e.status==='in_progress').at(-1);
  return {turn,events,event,active,working:!!conductor.running,
    label:conductor.running ? conductor.phase || 'Working on a request' : conductor.loop?.state==='running' ? 'Listening for authorized work' : `Background ${conductor.loop?.state || 'unavailable'}`,
    detail:summary(active?.command || active?.text || event?.text || event?.command || turn?.prompt)};
}

/** Owner-view projection only. Never return this global graph to enrolled agents. */
export function systemGraph(input, environment='local') {
  const state=workspaceRecords(input,environment),b=state.background || {},c=state.coordinator || {},current=activeConductor(state);
  const nodes=[],edges=[],timeline=[];
  const add=(id,kind,title,status,description,details={},extra={})=>nodes.push({id,kind,title,status:status || 'unknown',summary:summary(description),details,...extra});
  const link=(from,to,label,type='relationship',extra={})=>edges.push({id:`${type}:${from}:${to}:${extra.id || label}`,from,to,label,type,...extra});
  add('service','service','Local control service',b.service?.state,b.service?.survivesQuit===false?'Coordination stops when the app quits':'Local desktop backend',b.service);
  add('conductor','conductor','Conductor',current.working?'working':c.loop?.state,current.label,{...c,turn:current.turn || c.history?.at(-1)}, {open:'conductor'});
  link('service','conductor','hosts');
  add('owner','owner','You','owner','Open any conversation directly',{}, {open:'conductor'});
  link('owner','conductor','owner conversation');
  const clients=(b.mcp?.clients || []).filter(client=>state.sessions.some(s=>s.id===client.agentId));
  add('mcp','service','MCP / agent bridge',b.mcp?.state,'Scoped tools · messages · task reports',{...b.mcp,clients});
  link('service','mcp','serves scoped tools');link('mcp','conductor','reports and mailbox');
  add('collection','service','Work collection',b.collection?.lastError?'error':b.collection?.running?'collecting':b.collection?.state,'Model-free collection and progress observations',b.collection);
  link('collection','conductor','observations');link('service','collection','runs');
  add('discovery','service',environment==='local'?'Local discovery':'SSH discovery',environment==='local'?(input.localDiscovery?.healthy===false?'unavailable':b.localDiscovery?.mode):(state.remote?.find(r=>r.host===environment)?.error?'unavailable':state.remote?.find(r=>r.host===environment)?.scanning?'scanning':b.remoteDiscovery?.state),'Process and saved-history discovery',environment==='local'?{...b.localDiscovery,...input.localDiscovery}:{...b.remoteDiscovery,...state.remote?.find(r=>r.host===environment)});
  link('service','discovery','discovers');
  add('notifications','service','Notifications',b.notifications?.enabled===undefined?'unknown':b.notifications.enabled?'enabled':'disabled','Conductor chooses notifications',b.notifications);link('conductor','notifications','notification choices');
  add('terminal','service','Terminal connections',b.terminal ? (b.terminal.attachments?'attached':'idle'):'unknown',`${b.terminal?.attachments ?? '?'} open terminal attachments`,b.terminal);link('service','terminal','streams output');
  add('browser','service','Agent browsers',b.browser ? (b.browser.contexts?'open':'idle'):'unknown',`${b.browser?.contexts ?? '?'} browser contexts`,b.browser);link('service','browser','isolated profiles');
  add('interface','service','Interface refresh',b.interface?'polling':'unknown','Graph updates from the same inventory as the terminal list',b.interface);link('service','interface','state snapshots');
  for (const project of state.projects.filter(p=>!p.mergedIntoProjectId)) {
    add(graphId('project',project.id),'project',project.name,project.status || 'active',project.cwd,project,{projectId:project.id,open:graphId('project',project.id)});
  }
  for (const work of state.workSessions) {
    const id=graphId('work',work.id);add(id,'work',work.title,work.status,work.notes,work);
    for (const p of work.projects || []) link(id,graphId('project',p.canonicalProjectId || p.projectId || p.id),'contains work');
    link('conductor',id,'tracks human session');
  }
  for (const team of state.teams) {
    const id=graphId('team',team.id);add(id,'team',team.name,team.status || 'configured',team.mission,team,{projectId:team.projectId,open:`messages:${team.id}`});
    link(graphId('project',team.projectId),id,'team');
    if(team.runtimeServices?.gateway&&team.runtimeServices.gateway.state!=='offline'){const gateway=graphId('gateway',team.id);add(gateway,'service',`${team.name} network gateway`,team.runtimeServices.gateway.state,'Allowed public destinations only; private addresses blocked',team.runtimeServices,{projectId:team.projectId,open:'teams'});link(id,gateway,'owns');}
  }
  for (const agent of state.sessions) {
    const id=graphId('agent',agent.id),tasks=state.tasks.filter(t=>t.agentId===agent.id || agent.taskId===t.id);
    const report=tasks.map(t=>t.lastReport).filter(Boolean).sort((a,b)=>String(a.at || a.createdAt || '').localeCompare(String(b.at || b.createdAt || ''))).at(-1);
    const contact=clients.find(client=>client.agentId===agent.id);
    const status=agent.sourceStale?'stale':agent.connectionLost?'disconnected':agent.kind==='enrolled'?'process unknown':agent.status;
    add(id,agent.runtime?'runtime':agent.provider==='shell'?'terminal':'agent',agent.title || agent.role || agent.provider,status,report?.summary || report?.notes || tasks.find(t=>t.status==='doing')?.title || agent.mission || 'No current task report',
      {agent,tasks,contact},{projectId:agent.projectId,sourceId:agent.id,open:agent.id,historyId:agent.historyId});
    link(agent.projectId?graphId('project',agent.projectId):'discovery',id,agent.projectId?'project':'observed');
    if (agent.teamId) link(graphId('team',agent.teamId),id,'member');
    if(agent.parentAgentId)link(graphId('agent',agent.parentAgentId),id,'requested helper','delegation');
    if(agent.execution?.kind==='container'){
      const runtime=graphId('sandbox',agent.id);add(runtime,'sandbox',`${agent.role||agent.title||agent.provider} runtime`,agent.execution.state,`Private checkout · ${agent.execution.networkMode||'restricted'} network`,{agent,execution:agent.execution},{projectId:agent.projectId,open:`runtime:${agent.id}`});link(runtime,id,'contains process');link(graphId('team',agent.teamId),runtime,'runtime grant');
    }
    if (agent.kind==='managed' || agent.kind==='enrolled') link(id,'mcp',contact?`${contact.command} · ${contact.active?'in flight':contact.lastStatus || 'observed'}`:'scoped access · no contact observed','transport',{status:contact?.active?'working':contact?.lastStatus});
    if (agent.scope?.workSessionId) link(graphId('work',agent.scope.workSessionId),id,'assigned');
    if ((state.browsers || []).includes(agent.id)) {
      const browser=graphId('browser',agent.id);add(browser,'browser',`${agent.title || agent.provider} browser`,'open','Isolated browser context',{agentId:agent.id},{projectId:agent.projectId});link(id,browser,'owns');link('browser',browser,'context');
    }
  }
  for (const task of state.tasks) {
    const id=graphId('task',task.id);add(id,'task',task.title,task.status,task.lastReport?.summary || task.lastReport?.notes || task.notes,task,{projectId:task.projectId,open:id});
    link(task.agentId?graphId('agent',task.agentId):graphId('project',task.projectId),id,task.agentId?'assigned task':'unassigned task');
    if (task.parentTaskId) link(graphId('task',task.parentTaskId),id,'subtask');
    for (const dependency of task.dependsOn || []) link(id,graphId('task',typeof dependency==='string'?dependency:dependency.id),'depends on','dependency');
    if (task.lastReport) timeline.push({id:`report:${task.id}`,nodeId:id,kind:'Task report',status:task.status,at:task.lastReport.at || task.lastReport.createdAt || task.updatedAt,text:task.lastReport.summary || task.lastReport.notes || task.notes});
  }
  const messagePairs=new Map();
  for (const message of state.messages) {
    const from=owner(message.from),to=owner(message.to),key=from+'\0'+to;
    const pair=messagePairs.get(key) || {from,to,count:0};pair.count++;pair.message=message;messagePairs.set(key,pair);
    timeline.push({id:`message:${message.id}`,nodeId:from==='owner'||from==='conductor'?to:from,kind:'Message',at:message.createdAt,status:message.delivery || (message.read?'fetched':'queued'),text:message.text,from,to});
  }
  for (const {from,to,count,message} of messagePairs.values()) link(from,to,`${count} message${count===1?'':'s'} · ${message.delivery || (message.read?'fetched':'queued')}`,'message',{status:message.delivery,messages:state.messages.filter(m=>owner(m.from)===from&&owner(m.to)===to)});
  const turns=c.history || [],turn=current.turn || turns.at(-1),actions=[];
  function collectActions(rows,parent='') {for (const [index,row] of (rows || []).entries()) {const key=parent+index;actions.push({row,key});collectActions(row.dispatch?.actions,key+'.');}}
  collectActions(turn?.actions);
  for (const {row,key} of actions.slice(-30)) {
    const id=graphId('action',`${turn.id || 'latest'}:${key}`),a=row.action || {};
    const actionStatus=row.result?.partial?'partial':row.result?.ok===false||row.result?.error?'failed':row.status;
    add(id,'action',a.type?.replaceAll('_',' ') || 'Conductor action',actionStatus,a.text || a.name || row.result?.error || row.result?.result,{...row,turnId:turn.id},{projectId:a.projectId});
    link('conductor',id,'action','action',{status:row.status});
    if (a.target) {const target=nodes.find(n=>n.sourceId===a.target || ['task','team','project','work'].some(kind=>n.id===graphId(kind,a.target)));if(target)link(id,target.id,'targets','action',{status:row.status});}
    timeline.push({id,nodeId:id,kind:'Action',status:row.status,at:row.finishedAt || row.startedAt || turn.createdAt,text:a.type?.replaceAll('_',' ')+' · '+(row.result?.error || row.result?.result || a.text || a.name || row.status)});
  }
  const events=latestTrace(turn);
  if (current.working && current.active) {
    add('operation','operation',current.active.name || 'Provider operation','working',current.active.command || current.active.text,current.active);
    link('conductor','operation','in progress','action',{status:'working'});
  }
  for (const [index,event] of events.entries()) timeline.push({id:`trace:${turn?.id}:${index}`,nodeId:'conductor',kind:event.name || event.kind || 'Provider event',status:event.status,at:event.at,text:event.text || event.command || event.output,trace:event});
  const known=new Set(nodes.map(n=>n.id));
  return {nodes,edges:edges.filter(e=>known.has(e.from)&&known.has(e.to)),timeline:timeline.sort((a,b)=>String(b.at || '').localeCompare(String(a.at || ''))).slice(0,80),environment,current,
    coverage:{messages:input.messageCoverage,conversations:c.historyCoverage,actionsOmitted:Math.max(0,actions.length-30),eventsOmitted:Math.max(0,timeline.length-80),traceOmitted:turn?.traceOmitted || 0},warnings:input.warnings || []};
}

const lanes={service:0,owner:0,conductor:1,operation:1,work:2,project:2,team:2,sandbox:3,agent:3,terminal:3,runtime:3,browser:3,task:4,action:5};
export function graphLayout(graph,{query='',kind='',projectId='',limit=400,includeEmpty=false}={}) {
  const words=query.toLowerCase().split(/\s+/).filter(Boolean);
  const connected=new Set(graph.edges.flatMap(e=>[e.from,e.to]));
  const hiddenEmpty=new Set(!includeEmpty&&!query&&!projectId&&!kind?graph.nodes.filter(n=>n.kind==='project'&&!connected.has(n.id)).map(n=>n.id):[]);
  const matches=graph.nodes.filter(n=>!hiddenEmpty.has(n.id)&&(!kind || n.kind===kind) && (!projectId || n.projectId===projectId || n.id===graphId('project',projectId)) && words.every(word=>`${n.title} ${n.summary} ${n.status} ${n.id}`.toLowerCase().includes(word)));
  const filtered=!!(query || kind || projectId),selected=matches.slice(0,limit),ids=new Set(selected.map(n=>n.id));
  // Keep root context during filtering, without pulling in unrelated projects.
  if(filtered)for(const id of ['service','conductor','mcp'])if(!ids.has(id)){const node=graph.nodes.find(n=>n.id===id);if(node){selected.unshift(node);ids.add(id);}}
  const columns=new Map();
  for(const node of selected){const lane=lanes[node.kind] ?? 5;if(!columns.has(lane))columns.set(lane,[]);columns.get(lane).push(node);}
  const sorted=[...columns].sort((a,b)=>a[0]-b[0]);
  const positioned=sorted.flatMap(([lane,rows],column)=>rows.map((node,index)=>({...node,x:28+column*286,y:48+index*118,lane})));
  return {nodes:positioned,edges:graph.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),width:Math.max(320,sorted.length*286+28),height:Math.max(240,...[...columns.values()].map(rows=>rows.length*118+60)),matched:matches.length,omitted:Math.max(0,matches.length-limit),emptyProjects:hiddenEmpty.size,filtered};
}
