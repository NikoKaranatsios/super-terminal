import test from 'node:test';
import assert from 'node:assert/strict';
import { Coordinator, collectWork, contextProvenance, MAX_INPUT_BYTES } from '../server/coordinator.mjs';

const at=new Date(1000000).toISOString();
const reply=(actions=[])=>({answer:'Reviewed the evidence.',memory:'Only this project.',assessments:[],actions,usage:{input_tokens:10,output_tokens:3}});
const history={all:async()=>[],transcript:async()=>{throw new Error('unexpected transcript read');}};
function fixture() {
  const state={projects:[{id:'p',name:'P'},{id:'q',name:'Q'}],tasks:[{id:'tp',projectId:'p',status:'doing',revision:1,agentId:'ap',notes:'P_ONLY'},{id:'tq',projectId:'q',status:'doing',revision:1,agentId:'aq',notes:'Q_ONLY'}],sessions:[{id:'ap',kind:'managed',projectId:'p',contextProjectId:'p',taskId:'tp',historyId:'hp',status:'running'},{id:'aq',kind:'managed',projectId:'q',contextProjectId:'q',taskId:'tq',historyId:'hq',status:'running'}],activity:[],messages:[]};
  return {state,live:state.sessions.map(s=>({...s}))};
}
const finish=(id,target)=>({id,kind:'finished',target,at,provider:'codex',host:'local'});
const scopeP={layer:'project',projectIds:['p'],taskIds:['tp'],agentIds:['ap'],workSessionIds:[]};

test('provider completion changes collection while a process stays running and never marks its task done',()=>{
  const {state,live}=fixture();const before=collectWork(state,live);
  state.activity.push(finish('finished-p','hp'));
  const after=collectWork(state,live);assert.notEqual(after.signature,before.signature);
  const observation=after.observations[0];assert.equal(observation.kind,'provider_turn_complete');assert.equal(observation.agentId,'ap');assert.equal(observation.taskId,'tp');assert.equal(observation.taskDone,false);assert.equal(observation.verification,'unverified');assert.equal(state.tasks[0].status,'doing');
  state.taskEvents=[{id:'reported',taskId:'tp',agentId:'ap',status:'done',summary:'Tests reported passing',createdAt:at}];
  assert.equal(collectWork(state,live).observations.find(o=>o.id==='report:reported').verification,'actor_reported');
});
test('external observation/focus is read-only and never expands managed scope',()=>{
  const state={tasks:[],projects:[],activity:[finish('external-end','hx')]};const live=[{id:'x',kind:'external',historyId:'hx',projectId:'unrelated',status:'external'}];
  assert.equal(collectWork(state,live).observations.length,0);
  const data=collectWork(state,live,{focus:{agentIds:['x'],historyIds:['hx'],summary:'Current work'}});
  assert.equal(data.eligible,true);assert.equal(data.hasWork,false);assert.deepEqual(data.scope.agentIds,[]);assert.deepEqual(data.scope.projectIds,[]);
  assert.ok(data.observations.every(o=>o.access==='read_only'));assert.equal(data.observedAgents[0].id,'x');
});
test('automatic project rounds are partitioned and drain changed projects without paid idle polling',async()=>{
  const {state,live}=fixture();state.conductor={memory:'GLOBAL_PRIVATE',turns:[{id:'old',status:'complete',prompt:'GLOBAL_PRIVATE',answer:'GLOBAL_PRIVATE'}]};
  state.messages.push({id:'cross',from:'you',to:'ap',text:'GLOBAL_PRIVATE'});
  const inputs=[];const c=new Coordinator({state,save(){}},{now:()=>1000000,modelRunner:async input=>{inputs.push(input);return reply();}}).configure({history,liveReader:async()=>live});
  let data=await c.collect();assert.equal(inputs.length,0);assert.equal(data.projectRounds.length,2);
  await c.decide(data);data=await c.collect();assert.equal(data.projectRounds.length,1);await c.decide(data);data=await c.collect();assert.equal(data.projectRounds.length,0);assert.equal(data.pendingReview,false);
  assert.equal(inputs.length,2);for(const input of inputs){const own=input.context.projectIds[0];assert.equal(input.context.isolated,true);assert.equal(input.snapshot.tasks.length,1);assert.ok(!JSON.stringify(input).includes('GLOBAL_PRIVATE'));assert.ok(!JSON.stringify(input).includes(own==='p'?'Q_ONLY':'P_ONLY'));}
  state.activity.push(finish('p-end','hp'));data=await c.collect();assert.equal(data.projectRounds.length,1);assert.deepEqual(data.projectRounds[0].scope.projectIds,['p']);await c.decide(data);assert.equal((await c.collect()).projectRounds.length,0);
});
test('focused external work is picked up once then follows completion events without idle model calls',async()=>{
  const state={tasks:[],projects:[],activity:[]};const live=[{id:'x',kind:'external',historyId:'hx',status:'external'}];let calls=0,time=1000000;
  const c=new Coordinator({state,save(){}},{now:()=>time,modelRunner:async input=>{calls++;assert.equal(input.authorizedScope.agentIds.length,0);return reply();},loopOptions:{setTimer:()=>1,clearTimer(){}}}).configure({history,liveReader:async()=>live});
  c.setFocus({agentIds:['x']});c.startLoop();await c.loop.tick();assert.equal(calls,1);
  time+=3600000;await c.loop.tick();assert.equal(calls,1);
  state.activity.push({...finish('next','hx'),at:new Date(time).toISOString()});await c.loop.tick();assert.equal(calls,2);
  time+=3600000;await c.loop.tick();assert.equal(calls,2);c.stopLoop();
});
test('completion excerpt lookup is bounded, cached and untrusted; a model failure leaves the observation pending',async()=>{
  const {state,live}=fixture();let reads=0;const c=new Coordinator({state,save(){}},{now:()=>1000000,modelRunner:async()=>{throw new Error('mock unavailable');}}).configure({history,liveReader:async()=>live,progressReader:async({observations})=>{reads++;assert.ok(observations.length<=3);return [...observations.map(o=>({observationId:o.id,summary:'untrusted '.repeat(2000)})),{observationId:'invented',summary:'NEVER INCLUDE'}];}});
  for(let n=0;n<10;n++)state.activity.push(finish(`end-${n}`,'hp'));
  const data=await c.collect();assert.equal(reads,0);const result=await c.decide(data);assert.equal(result.status,'error');assert.ok((await c.collect()).pendingReview);
  const snapshot=await c.snapshot(live,history,'review',{scope:scopeP,context:{projectScoped:true,isolated:true}});
  assert.ok(reads<=2);assert.ok(snapshot.observations.every(o=>!o.excerpt || o.excerpt.summary.length<=1200));assert.ok(snapshot.observations.every(o=>!o.excerpt || o.excerpt.trusted===false));assert.ok(!JSON.stringify(snapshot).includes('NEVER INCLUDE'));
});
test('project input excludes global focus prose, session titles, prior global turns and foreign history results',async()=>{
  const {state,live}=fixture();state.workSessions=[{id:'ws',title:'GLOBAL_PRIVATE',notes:'GLOBAL_PRIVATE',status:'active',projects:[{id:'np',canonicalProjectId:'p',name:'P',goals:[]},{id:'nq',canonicalProjectId:'q',name:'Q_ONLY',goals:[]}]}];
  const inputs=[];let handled=0;
  const c=new Coordinator({state,save(){}},{now:()=>1000000,modelRunner:async input=>{inputs.push(input);return reply(inputs.length===1?[{type:'read_conversation',target:'hq'}]:[]);}}).configure({history,liveReader:async()=>live,actionHandler:async()=>{handled++;return {text:'FOREIGN_PRIVATE'};}});
  c.setFocus({projectId:'p',agentIds:['ap','aq'],historyIds:['hp','hq'],summary:'GLOBAL_PRIVATE'});
  const result=await c.ask('Review this project','',live,history,'ws',false,'local',{scope:{...scopeP,workSessionIds:['ws']}});
  assert.equal(result.status,'complete');assert.equal(handled,0);
  for(const input of inputs){const json=JSON.stringify(input);assert.ok(!json.includes('GLOBAL_PRIVATE'));assert.ok(!json.includes('Q_ONLY'));assert.ok(!json.includes('FOREIGN_PRIVATE'));assert.ok(Buffer.byteLength(json)<=MAX_INPUT_BYTES);}
});
test('reassignment and explicit shared teams retain all source projects in dispatch provenance',()=>{
  const {state,live}=fixture();live[0].contextProjectId='q';let context=contextProvenance(state,live,scopeP);
  assert.equal(context.isolated,false);assert.deepEqual(context.projectIds,['p','q']);assert.equal(context.unknownSources,false);
  live[0].contextProjectId='p';live[0].teamId='shared';state.sessions[0].teamId='shared';state.sessions[1].teamId='shared';context=contextProvenance(state,live,scopeP);
  assert.equal(context.isolated,false);assert.equal(context.teamId,'shared');assert.deepEqual(context.projectIds,['p','q']);
  delete live[0].projectId;delete live[0].contextProjectId;assert.equal(contextProvenance(state,live,scopeP).unknownSources,true);
});
test('completion arriving during a model round remains pending for the next review',async()=>{
  const {state,live}=fixture();const c=new Coordinator({state,save(){}},{now:()=>1000000,modelRunner:async()=>{state.activity.push(finish('during-model','hp'));return reply();}}).configure({history,liveReader:async()=>live});
  const data=await c.collect();await c.decide(data);const next=await c.collect();assert.ok(next.pendingObservationIds.includes('activity:during-model'));assert.ok(next.projectRounds.some(part=>part.scope.projectIds[0]==='p'));
});
test('session focus cannot import sibling reports, team missions or tainted earlier project conversation',async()=>{
  const {state,live}=fixture();state.tasks[0].scope={workSessionId:'ws',projectId:'np'};state.tasks[1].scope={workSessionId:'ws',projectId:'nq'};
  state.workSessions=[{id:'ws',status:'active',title:'OWNER_ONLY',notes:'OWNER_ONLY',projects:[{id:'np',canonicalProjectId:'p',name:'P',goals:[]},{id:'nq',canonicalProjectId:'q',name:'Q',goals:[]}]}];
  state.teams=[{id:'qteam',projectId:'q',name:'Q_PRIVATE',mission:'Q_PRIVATE',scope:{workSessionId:'ws',projectId:'nq'}}];
  state.taskEvents=[{id:'qreport',taskId:'tq',agentId:'aq',status:'doing',summary:'Q_PRIVATE',createdAt:at}];
  state.conductor={turns:[{id:'tainted',status:'complete',context:{key:'project:p',isolated:false,projectScoped:true,projectIds:['p','q'],unknownSources:false},prompt:'Q_PRIVATE',answer:'Q_PRIVATE'}]};
  const inputs=[];const c=new Coordinator({state,save(){}},{now:()=>1000000,modelRunner:async input=>{inputs.push(input);return reply();}}).configure({history,liveReader:async()=>live});
  c.setFocus({projectId:'p',workSessionId:'ws',summary:'OWNER_ONLY'});
  await c.ask('Review P','',live,history,'ws',false,'local',{scope:{...scopeP,workSessionIds:['ws']}});
  assert.ok(!JSON.stringify(inputs[0]).includes('Q_PRIVATE'));assert.ok(!JSON.stringify(inputs[0]).includes('OWNER_ONLY'));assert.equal(inputs[0].snapshot.observations.some(o=>o.id==='report:qreport'),false);
});
test('replay receipts remain partitioned and prior mixed results retain their provenance',async()=>{
  const {state,live}=fixture();const action={type:'prompt_agent',target:'ap',text:'Check own task'};let handled=0,round=0;
  const c=new Coordinator({state,save(){}},{now:()=>1000000,modelRunner:async()=>reply(round++%2===0?[action]:[])}).configure({history,liveReader:async()=>live,actionHandler:async()=>{handled++;return {text:'SAME_PROJECT_RECEIPT'};}});
  await c.ask('Continue','',live,history,'',false,'local',{autonomous:true,scope:scopeP});assert.equal(handled,1);
  const receipt=Object.values(state.conductor.actionReceipts)[0];receipt.sourceContext.projectIds=['p','q'];receipt.sourceContext.isolated=false;receipt.result={text:'SHARED_RECEIPT'};
  const result=await c.ask('Continue','',live,history,'',false,'local',{autonomous:true,scope:scopeP});assert.equal(handled,1);assert.equal(result.context.isolated,false);assert.deepEqual(result.context.projectIds,['p','q']);
  assert.equal(state.conductor.contextMemory['project:p'],'Only this project.');
});
test('mixed managed/external focus subjects are reviewed separately and revisiting a focus refreshes its context',async()=>{
  const {state,live}=fixture();live.push({id:'outside',kind:'external',historyId:'outside-history',status:'external'});
  const c=new Coordinator({state,save(){}},{now:()=>1000000,modelRunner:async()=>reply()}).configure({history,liveReader:async()=>live});
  c.setFocus({projectId:'p',agentIds:['ap','outside']});const original=c.status().focus.revision;
  let data=await c.collect();await c.decide(data);data=await c.collect();assert.ok(data.pendingObservationIds.some(id=>id.endsWith(':outside')));
  c.setFocus({agentIds:['aq']});c.setFocus({projectId:'p',agentIds:['ap','outside']});assert.notEqual(c.status().focus.revision,original);assert.ok((await c.collect()).pendingObservationIds.some(id=>id.endsWith(':ap')));
  const stable=c.status().focus.revision;c.setFocus({projectId:'p',agentIds:['outside','ap']});assert.equal(c.status().focus.revision,stable);
});
test('visible shared team mission retains historical project provenance without a visible member',async()=>{
  const {state,live}=fixture();state.teams=[{id:'shared',projectId:'p',name:'Shared review',mission:'Shared historical Q context',sharedProjectIds:['p','q'],contentProjectIds:['p','q']}];
  const provenance=contextProvenance(state,live,scopeP);assert.equal(provenance.isolated,false);assert.deepEqual(provenance.projectIds,['p','q']);assert.equal(provenance.unknownSources,false);
  const inputs=[];const c=new Coordinator({state,save(){}},{modelRunner:async input=>{inputs.push(input);return reply();}}).configure({history,liveReader:async()=>live});
  await c.ask('Review','',live,history,'',false,'local',{scope:scopeP});assert.equal(inputs[0].snapshot.teams[0].mission,'Shared historical Q context');assert.deepEqual(inputs[0].context.projectIds,['p','q']);assert.equal(state.conductor.contextMemory['project:p'],undefined);
});
test('agent consumed content persists in provenance after team membership and live metadata disappear',async()=>{
  const {state,live}=fixture();state.sessions[0].contentProjectIds=['p','q'];
  // The cached live row has no team or consumed-source metadata yet.
  assert.equal(live[0].contentProjectIds,undefined);assert.equal(live[0].teamId,undefined);
  let provenance=contextProvenance(state,live,scopeP);assert.deepEqual(provenance.projectIds,['p','q']);assert.equal(provenance.isolated,false);assert.equal(provenance.unknownSources,false);
  state.sessions[0].contextIsolation=true;provenance=contextProvenance(state,live,scopeP);assert.equal(provenance.unknownSources,true);
  delete state.sessions[0].contextIsolation;
  const seen=[];const c=new Coordinator({state,save(){}},{modelRunner:async input=>{seen.push(input);return reply();}}).configure({history,liveReader:async()=>live});
  await c.ask('Review','',live,history,'',false,'local',{scope:scopeP});assert.deepEqual(seen[0].context.projectIds,['p','q']);assert.equal(state.conductor.contextMemory['project:p'],undefined);
});
test('incoming message keeps its original source projects after the sender leaves its shared team',async()=>{
  const {state,live}=fixture();state.messages=[{id:'retained-shared-report',from:'ap',to:'coordinator',text:'Q_SHARED_SENTINEL',sourceProjectIds:['p','q'],group:'OLD_SHARED_TEAM'}];
  const provenance=contextProvenance(state,live,scopeP);assert.equal(provenance.isolated,false);assert.deepEqual(provenance.projectIds,['p','q']);assert.equal(provenance.teamId,null);
  const inputs=[];let metadata;
  const c=new Coordinator({state,save(){}},{modelRunner:async input=>{inputs.push(input);return reply(inputs.length===1?[{type:'prompt_agent',target:'ap',text:'Follow up'}]:[]);}}).configure({history,liveReader:async()=>live,actionHandler:async(_action,meta)=>{metadata=structuredClone(meta);return {error:'Sharing is not currently permitted'};}});
  const result=await c.ask('Review','',live,history,'',false,'local',{scope:scopeP});assert.equal(result.status,'complete');assert.match(JSON.stringify(inputs[0].snapshot.messages),/Q_SHARED_SENTINEL/);assert.deepEqual(metadata.context.projectIds,['p','q']);assert.equal(metadata.context.isolated,false);assert.equal(state.conductor.contextMemory['project:p'],undefined);
  assert.ok(!JSON.stringify(inputs[0]).includes('OLD_SHARED_TEAM'));
});
