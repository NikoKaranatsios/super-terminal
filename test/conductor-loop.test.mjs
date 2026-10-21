import test from 'node:test';
import assert from 'node:assert/strict';
import { ConductorLoop } from '../server/conductor-loop.mjs';
import { Coordinator, boundInput, collectWork, publicProviderEvent, MAX_INPUT_BYTES } from '../server/coordinator.mjs';

const reply = (actions = [], usage = { input_tokens:10, output_tokens:2 }) => ({ answer:'Observed result.', memory:'', assessments:[], actions, usage });
const history = { all:async()=>[], transcript:async()=>{throw new Error('unexpected transcript read');} };
function harness(overrides = {}) {
  let time=1000000,calls=0,collected=0;
  const state={state:'running',rounds:0};
  const data={signature:'a',eligible:true,hasWork:true,active:true};
  const loop=new ConductorLoop(state,{collect:async()=>{collected++;return data;},decide:async()=>{calls++;return {status:'complete'};},now:()=>time,setTimer:()=>({unref(){}}),clearTimer(){},...overrides});
  loop.start();
  return {loop,state,data,advance:n=>{time+=n;},calls:()=>calls,collected:()=>collected};
}
test('collection is free, empty/completed scopes do not call a model, changed/active rounds are bounded',async()=>{
  const h=harness();h.data.eligible=false;h.data.hasWork=false;
  await h.loop.tick();h.advance(1e8);await h.loop.tick();assert.equal(h.calls(),0);
  h.data.eligible=true;await h.loop.tick();assert.equal(h.calls(),0);
  h.data.signature='work';h.data.hasWork=true;await h.loop.tick();assert.equal(h.calls(),1);
  h.advance(5000);h.data.signature='changed';await h.loop.tick();assert.equal(h.calls(),1);
  h.advance(25000);await h.loop.tick();assert.equal(h.calls(),2);
  h.advance(119999);await h.loop.tick();assert.equal(h.calls(),2);
  h.advance(1);await h.loop.tick();assert.equal(h.calls(),3);
  h.data.signature='done';h.data.hasWork=false;h.advance(30000);await h.loop.tick();assert.equal(h.calls(),4);
  h.advance(1e8);await h.loop.tick();assert.equal(h.calls(),4);assert.equal(h.state.nextRoundAt,null);
});
test('pause, restart intent, in-flight exclusion and stale completion cannot restart a stopped loop',async()=>{
  let resolve,rounds=0;
  const h=harness({decide:()=>{rounds++;return new Promise(r=>{resolve=r;});}});
  const pending=h.loop.tick();await Promise.resolve();await h.loop.tick();assert.equal(rounds,1);
  h.loop.control('paused');resolve({status:'complete'});await pending;
  assert.equal(h.state.lastSignature,undefined);assert.equal(h.state.nextRoundAt,null);
  await h.loop.tick();assert.equal(rounds,1);
  h.loop.control('running');h.loop.stop();assert.equal(h.state.state,'running');assert.equal(h.loop.enabled,false);
  assert.throws(()=>h.loop.control('invalid'),/running, paused/);
});
test('errors back off and a busy manual reply does not start an autonomous model',async()=>{
  let calls=0,busy=true;
  const h=harness({busy:()=>busy,decide:async()=>{calls++;throw new Error('synthetic unavailable');}});
  await h.loop.tick();assert.equal(calls,0);busy=false;await h.loop.tick();assert.equal(calls,1);assert.equal(h.state.failures,1);
  h.advance(29999);await h.loop.tick();assert.equal(calls,1);
  h.advance(1);await h.loop.tick();assert.equal(calls,2);assert.equal(h.state.failures,2);
  h.advance(30000);await h.loop.tick();assert.equal(calls,2);assert.match(h.state.lastError,/unavailable/);
});
test('collector excludes paused/wrapped work, archived projects, stopped task work and external agents',async()=>{
  const state={projects:[{id:'p'},{id:'archived',status:'archived'}],workSessions:[{id:'active',status:'active',projects:[{id:'nested',canonicalProjectId:'p',goals:[]}]},{id:'paused',status:'paused',projects:[]}],tasks:[
    {id:'task',projectId:'p',agentId:'agent',status:'doing',scope:{workSessionId:'active'}},
    {id:'paused-task',projectId:'p',status:'doing',scope:{workSessionId:'paused'}},
    {id:'archived-task',projectId:'archived',status:'doing'},
    {id:'stopped',projectId:'p',status:'stopped'}]};
  const live=[{id:'agent',kind:'managed',status:'running'},{id:'paused-agent',projectId:'p',kind:'managed',scope:{workSessionId:'paused'}},{id:'external',kind:'external',projectId:'p'}];
  const data=collectWork(state,live);assert.deepEqual(data.scope.taskIds,['task']);assert.deepEqual(data.scope.agentIds,['agent']);assert.deepEqual(data.scope.projectIds,['p']);
  const coordinator=new Coordinator({state,save(){}});
  const snapshot=await coordinator.snapshot(live,{all(){throw new Error('must not scan history');}},'',{autonomous:true,scope:data.scope});
  assert.deepEqual(snapshot.tasks.map(t=>t.id),['task']);assert.deepEqual(snapshot.terminals.map(t=>t.id),['agent']);assert.equal(snapshot.tasks[0].agentId,'agent');
  state.tasks=state.tasks.filter(t=>t.id==='stopped');assert.equal(collectWork(state,live).hasWork,false);
});
test('bounded inputs report omissions and reject oversized requests instead of silently growing',()=>{
  const input={userMessage:'review',snapshot:{coverage:{},tasks:Array.from({length:400},(_,id)=>({id,notes:'x'.repeat(1200)})),historyIndex:Array.from({length:80},()=>({title:'y'.repeat(600)}))},conversation:[]};
  const limited=boundInput(input);assert.ok(Buffer.byteLength(JSON.stringify(limited))<=MAX_INPUT_BYTES);assert.ok(limited.omitted.tasks);assert.equal(input.snapshot.tasks.length,400);
  assert.throws(()=>boundInput({userMessage:'x'.repeat(MAX_INPUT_BYTES+1)}),/exceeds/);
});
test('multiple model rounds accumulate usage, receive bounded evidence and ledger repeated actions once',async()=>{
  const action={type:'create_task',name:'Review',projectId:'p'};let handled=0,model=0;
  const store={state:{tasks:[{id:'t',projectId:'p',status:'doing'}]},save(){}};
  const c=new Coordinator(store,{modelRunner:async(input,{onEvent})=>{assert.ok(Buffer.byteLength(JSON.stringify(input))<=MAX_INPUT_BYTES);onEvent({type:'item.completed',item:{id:'i',type:'agent_message',text:'Visible update'}});return reply(++model<3?[action]:[]);}});
  const scope=collectWork(store.state).scope;
  c.configure({history,liveReader:async()=>[],actionHandler:async(_a,meta)=>{handled++;assert.equal(meta.autonomous,true);assert.deepEqual(meta.scope,scope);return {id:'created'};}});
  const result=await c.ask('Continue','',[],history,'',false,'local',{autonomous:true,scope});
  assert.equal(result.status,'complete');assert.equal(handled,1);assert.equal(result.actions[1].status,'duplicate');assert.equal(result.modelRounds,3);assert.deepEqual(result.usage,{input_tokens:30,output_tokens:6});assert.equal(result.trace.length,3);
  model=0;await c.ask('Continue','',[],history,'',false,'local',{autonomous:true,scope});assert.equal(handled,1);
});
test('briefings cannot mutate, cancelled rounds cannot perform returned actions, failed usage is retained',async()=>{
  let handled=0;const c=new Coordinator({state:{},save(){}},{modelRunner:async()=>reply([{type:'start_agent',name:'x'}])});
  c.configure({history,liveReader:async()=>[],actionHandler:async()=>{handled++;}});
  const briefing=await c.ask('Brief me','',[],history,'',true);assert.equal(handled,0);assert.equal(briefing.actions[0].status,'failed');
  c.options.modelRunner=async()=>{c.cancel();return reply([{type:'start_agent'}]);};
  const cancelled=await c.ask('Start','',[],history);assert.equal(cancelled.status,'error');assert.equal(handled,0);
  c.options.modelRunner=async()=>{throw Object.assign(new Error('failed'),{usage:{input_tokens:17}});};
  const failed=await c.ask('Review','',[],history);assert.equal(failed.modelRounds,1);assert.deepEqual(failed.usage,{input_tokens:17});
});
test('public trace retains provider messages/tool events but excludes hidden reasoning and bounds output',()=>{
  assert.equal(publicProviderEvent({type:'item.completed',item:{type:'reasoning',text:'private'}}),null);
  assert.equal(publicProviderEvent({type:'unknown',encrypted_content:'private'}),null);
  const event=publicProviderEvent({type:'item.completed',item:{id:'cmd',type:'command_execution',command:'synthetic',aggregated_output:'ok',exit_code:0},encrypted_content:'private'});
  assert.equal(event.output,'ok');assert.equal(event.exitCode,0);assert.equal(event.encrypted_content,undefined);
  const c=new Coordinator({state:{},save(){}});const entry={trace:[]};
  for(let i=0;i<600;i++)c.addTrace(entry,{type:'item.completed',item:{type:'agent_message',text:'x'.repeat(16000)}});
  assert.ok(entry.traceBytes<=131072);assert.ok(entry.traceOmitted>0);
});
test('actions already observed by the decision do not trigger a follow-up model cascade',async()=>{
  let calls=0;
  const h=harness({decide:async()=>{calls++;h.data.signature='own-change';return {status:'complete',observedSignature:'own-change'};}});
  await h.loop.tick();assert.equal(h.state.lastSignature,'own-change');
  h.advance(30000);await h.loop.tick();assert.equal(calls,1);
  h.data.signature='agent-report';await h.loop.tick();assert.equal(calls,2);
});
test('manual task scope stays narrow and model-observed signature does not swallow concurrent reports',async()=>{
  const state={tasks:[{id:'a',projectId:'p',status:'doing',revision:1},{id:'b',projectId:'p',status:'doing',revision:1}]};
  const c=new Coordinator({state,save(){}},{modelRunner:async()=>{state.tasks[0].revision++;return reply();}});
  c.configure({history,liveReader:async()=>[]});
  const narrow=await c.snapshot([],history,'review',{scope:{taskIds:['a'],projectIds:['p'],agentIds:[],workSessionIds:[]}});
  assert.deepEqual(narrow.tasks.map(t=>t.id),['a']);
  const before=collectWork(state).signature;const result=await c.ask('Continue','',[],history,'',false,'local',{autonomous:true,scope:collectWork(state).scope});
  assert.equal(result.observedSignature,before);assert.notEqual(result.observedSignature,collectWork(state).signature);
});
test('task and project snapshots keep parent metadata without sibling goals, unrelated teams or other project work',async()=>{
  const tasks=[
    {id:'selected',projectId:'p',title:'Selected task',status:'doing',scope:{workSessionId:'work',projectId:'nested-p',goalId:'selected'}},
    {id:'child',parentTaskId:'selected',projectId:'p',title:'Selected child',status:'todo',scope:{workSessionId:'work',projectId:'nested-p',goalId:'selected'}},
    {id:'sibling',projectId:'p',title:'Sibling private goal',status:'todo',scope:{workSessionId:'work',projectId:'nested-p',goalId:'sibling'}},
    {id:'other',projectId:'q',title:'Other project private goal',status:'todo',scope:{workSessionId:'work',projectId:'nested-q',goalId:'other'}}
  ];
  const state={tasks,projects:[{id:'p',name:'Parent project',notes:'Sibling project notes'},{id:'q',name:'Other project'}],workSessions:[{id:'work',title:'Parent session',status:'active',notes:'Cross-project session notes',projects:[{id:'nested-p',canonicalProjectId:'p',name:'Parent project',goals:tasks.filter(t=>t.projectId==='p')},{id:'nested-q',canonicalProjectId:'q',name:'Other project',goals:[tasks[3]]}]}],teams:[{id:'selected-team',name:'Selected team',projectId:'p'},{id:'sibling-team',name:'Sibling private team',projectId:'p'},{id:'other-team',name:'Other private team',projectId:'q',scope:{workSessionId:'work',projectId:'nested-q'}}]};
  const live=[{id:'selected-agent',taskId:'selected',projectId:'p',teamId:'selected-team'},{id:'sibling-agent',taskId:'sibling',projectId:'p',teamId:'sibling-team'},{id:'other-agent',taskId:'other',projectId:'q',teamId:'other-team'}];
  const c=new Coordinator({state,save(){}});
  const scoped=await c.snapshot(live,history,'Discuss selected task',{scope:{layer:'task',taskIds:['selected','child'],projectIds:['p'],agentIds:['selected-agent'],workSessionIds:['work']}});
  assert.deepEqual(scoped.tasks.map(t=>t.id),['selected','child']);assert.deepEqual(scoped.terminals.map(a=>a.id),['selected-agent']);
  assert.deepEqual(scoped.workSessions[0].projects.map(p=>p.id),['nested-p']);assert.deepEqual(scoped.workSessions[0].projects[0].goals.map(t=>t.id),['selected','child']);
  assert.deepEqual(scoped.teams.map(t=>t.id),['selected-team']);assert.equal(scoped.workSessions[0].title,'Parent session');assert.equal(scoped.projects[0].name,'Parent project');
  assert.equal(scoped.workSessions[0].notes,undefined);assert.equal(scoped.projects[0].notes,undefined);
  assert.ok(!JSON.stringify(scoped).includes('Sibling'));assert.ok(!JSON.stringify(scoped).includes('Other private'));
  const project=await c.snapshot(live,history,'Discuss project',{scope:{layer:'project',taskIds:['selected','child','sibling'],projectIds:['p'],agentIds:['selected-agent','sibling-agent'],workSessionIds:['work']}});
  assert.deepEqual(project.workSessions[0].projects.map(p=>p.id),['nested-p']);assert.deepEqual(project.teams.map(t=>t.id),['selected-team','sibling-team']);assert.ok(!JSON.stringify(project).includes('Other project private'));
  const parent=await c.snapshot(live,history,'Discuss task without explicit session',{scope:{layer:'task',taskIds:['selected'],projectIds:['p'],agentIds:['selected-agent'],workSessionIds:[]}});
  assert.equal(parent.workSessions[0].id,'work');assert.deepEqual(parent.workSessions[0].projects[0].goals.map(t=>t.id),['selected']);
  const ungranted=await c.snapshot(live,history,'No autonomous scope',{autonomous:true});assert.equal(ungranted.tasks.length,0);assert.equal(ungranted.terminals.length,0);assert.equal(ungranted.workSessions.length,0);
});
