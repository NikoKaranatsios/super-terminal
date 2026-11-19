import test from 'node:test';
import assert from 'node:assert/strict';
import { systemGraph, graphLayout, activeConductor, latestTrace } from '../shared/system-graph.mjs';
import { AgentActivity, conductorContact } from '../server/agent-activity.mjs';

const fixture=()=>({
  projects:[{id:'p',name:'Example',host:'local'},{id:'remote',name:'Remote private name',host:'remote'}],
  sessions:[{id:'a',kind:'managed',title:'Implementer',provider:'codex',host:'local',projectId:'p',teamId:'team',status:'running',initialPrompt:{text:'Original assignment'},mission:'Updated mission'},
    {id:'enrolled',kind:'enrolled',provider:'claude',host:'local',projectId:'p',status:'external'},
    {id:'background',kind:'external',runtime:true,provider:'codex',host:'local',status:'external'},
    {id:'remote-agent',kind:'managed',provider:'codex',host:'remote',projectId:'remote',status:'running'}],
  tasks:[{id:'task',projectId:'p',title:'Verify changes',agentId:'a',status:'blocked',lastReport:{summary:'Waiting for evidence',verification:'actor_reported'}},{id:'remote-task',projectId:'remote',title:'Remote private task',status:'doing'}],
  teams:[{id:'team',name:'Review team',projectId:'p',host:'local'}],workSessions:[],browsers:['a'],localDiscovery:{healthy:false,warnings:['Reader unavailable']},
  messages:[{id:'m1',from:'conductor',to:'a',text:'Check the tests',delivery:'queued'},{id:'m2',from:'a',to:'coordinator',text:'Tests running',delivery:'queued'},{id:'m3',from:'remote-agent',to:'coordinator',text:'Remote private message',delivery:'queued'}],
  messageCoverage:{total:300,shown:100,omitted:200},
  background:{service:{state:'running'},mcp:{state:'available',clients:[{agentId:'a',command:'report',active:0,lastStatus:'responded'},{agentId:'remote-agent',command:'send'}]},collection:{state:'running'},browser:{contexts:1}},
  coordinator:{running:true,phase:'Working on your request',loop:{state:'paused'},history:[{id:'turn',status:'running',prompt:'Check work',mode:'manual',trace:[
    {type:'item.started',itemId:'command',round:0,name:'command_execution',command:'npm test',seq:1},
    {type:'item.completed',itemId:'command',round:0,name:'command_execution',command:'npm test',status:'completed',seq:2},
    {type:'item.started',itemId:'command',round:1,name:'command_execution',command:'npm run build',seq:3},
    {type:'item.completed',name:'agent_message',text:'{"answer":"structured data"}',seq:4}],
    actions:[{action:{type:'message_agent',target:'a',text:'Please review'},status:'started'},{action:{type:'session_state',target:'a'},status:'executed',result:{partial:true,results:[{ok:false}]}}]}]}
});

test('owner graph connects the observed system without conflating state or leaking another environment',()=>{
  const graph=systemGraph(fixture()),byId=new Map(graph.nodes.map(n=>[n.id,n]));
  for(const id of ['conductor','mcp','service','collection','discovery','notifications','interface','terminal','browser','agent:a','agent:background','browser:a','task:task','team:team'])assert.ok(byId.has(id),id);
  assert.equal(byId.get('agent:a').status,'running');assert.equal(byId.get('task:task').status,'blocked');assert.equal(byId.get('agent:enrolled').status,'process unknown');assert.equal(byId.get('conductor').status,'working');assert.equal(byId.get('discovery').status,'unavailable');
  assert.equal(byId.get('agent:a').details.agent.initialPrompt.text,'Original assignment');assert.equal(byId.get('agent:enrolled').details.agent.initialPrompt,undefined);
  assert.ok(graph.edges.some(e=>e.from==='conductor'&&e.to==='agent:a'&&e.type==='message'&&e.status==='queued'));
  assert.ok(graph.edges.some(e=>e.from==='agent:a'&&e.to==='conductor'&&e.type==='message'));
  assert.ok(graph.edges.some(e=>e.from==='agent:a'&&e.to==='mcp'));
  assert.equal(byId.get('action:turn:0').status,'started');assert.equal(byId.get('action:turn:1').status,'partial');
  assert.equal(graph.coverage.messages.omitted,200);
  assert.doesNotMatch(JSON.stringify(graph),/Remote private|remote-agent|remote-task/);
  assert.ok(graph.edges.every(e=>byId.has(e.from)&&byId.has(e.to)));
});
test('visible operation coalesces events per round and never treats a structured response as progress',()=>{
  const state=fixture(),current=activeConductor(state);
  assert.equal(current.active.command,'npm run build');assert.equal(current.events.length,2);
  assert.equal(current.detail,'npm run build');assert.equal(latestTrace(state.coordinator.history[0]).at(-1).seq,3);
  state.coordinator.running=false;state.coordinator.history[0].status='complete';
  assert.equal(systemGraph(state).nodes.some(n=>n.id==='operation'),false);
  assert.equal(activeConductor(state).label,'Background paused');
});
test('graph layout discloses limits, filters disconnected nodes, and retains root context',()=>{
  const state=fixture();state.tasks.push(...Array.from({length:800},(_,i)=>({id:'extra-'+i,projectId:'p',title:'Task '+i,status:'todo'})));
  const graph=systemGraph(state),layout=graphLayout(graph);
  assert.equal(layout.nodes.length,400);assert.equal(layout.omitted,graph.nodes.length-400);
  const filtered=graphLayout(graph,{query:'Implementer',kind:'agent'});
  assert.equal(filtered.matched,1);assert.equal(filtered.omitted,0);assert.equal(filtered.filtered,true);
  assert.deepEqual(new Set(filtered.nodes.map(n=>n.id)),new Set(['agent:a','service','conductor','mcp']));
  assert.ok(filtered.edges.every(e=>filtered.nodes.some(n=>n.id===e.from)&&filtered.nodes.some(n=>n.id===e.to)));
  assert.equal(graphLayout(graph,{query:'no matching node'}).matched,0);
});
test('transport observations retain only safe metadata, count overlapping calls, and settle exactly once',()=>{
  let now=0;const activity=new AgentActivity(()=>now);
  const first=activity.begin('a',{command:'report',transport:'mcp',token:'PRIVATE',message:'PRIVATE'}),second=activity.begin('a',{command:'context'});
  assert.equal(activity.snapshot(new Set(['a']))[0].active,2);now=1000;first(200);first(0);second(500);
  const row=activity.snapshot(new Set(['a']))[0];assert.equal(row.active,0);assert.equal(row.lastStatus,'failed');assert.equal(row.requests,2);assert.equal(row.lastFinishedAt,'1970-01-01T00:00:01.000Z');assert.doesNotMatch(JSON.stringify(row),/PRIVATE/);
  assert.deepEqual(activity.snapshot(new Set(['b'])),[]);
});
test('terminal Conductor status gives only own sent messages and no owner context',()=>{
  const state=fixture(),contact=conductorContact(state.coordinator,state,state.sessions[0]);
  assert.equal(contact.loop,'paused');assert.equal(contact.replying,true);assert.deepEqual(contact.messages.map(m=>m.id),['m2']);assert.doesNotMatch(JSON.stringify(contact),/Remote private|Check work|Original assignment/);
  assert.match(contact.workflow,/does not start an owner chat/);
});
