import test from 'node:test';
import assert from 'node:assert/strict';
import { Coordinator, MAX_INPUT_BYTES } from '../server/coordinator.mjs';
import { validateConductorContent } from '../server/conductor-access.mjs';
import { projectDispatchRoute, validateDispatchedAction } from '../server/conductor-dispatch.mjs';
import { conductorCommand } from '../server/conductor-runtime.mjs';

const reply=(actions=[])=>({answer:'Fixture result.',memory:'Owner memory.',assessments:[],actions,usage:{input_tokens:2,output_tokens:1}});
function fixture() {
  const state={projects:[{id:'p',name:'Example project',host:'local',cwd:'/fixture/p'},{id:'q',name:'Other project',host:'local',cwd:'/fixture/q',notes:'Q_PRIVATE'}],
    tasks:[{id:'tp',projectId:'p',status:'doing',notes:'P_ONLY'},{id:'tq',projectId:'q',status:'doing',notes:'Q_PRIVATE'}],
    sessions:[{id:'ap',kind:'managed',projectId:'p',contextProjectId:'p',historyId:'hp',status:'running'},{id:'aq',kind:'managed',projectId:'q',contextProjectId:'q',historyId:'hq',status:'running'}],
    workSessions:[{id:'w',title:'OWNER_PRIVATE',projects:[{id:'np',canonicalProjectId:'p'},{id:'nq',canonicalProjectId:'q'}]}],teams:[],messages:[],
    conductor:{memory:'GLOBAL_PRIVATE',contextMemory:{'project:p':'P_MEMORY','project:q':'Q_PRIVATE'},turns:[{id:'earlier-owner',mode:'manual',status:'complete',prompt:'OWNER_PRIVATE',answer:'Owner conversation',context:{key:'global'}}]}};
  const history={all:async()=>[{id:'hp',projectId:'p',title:'P history',updatedAt:'1'},{id:'hq',projectId:'q',title:'Q_PRIVATE',updatedAt:'1'}],transcript:async id=>({messages:[{role:'assistant',text:id==='hp'?'P_REPORT':'Q_PRIVATE'}]})};
  return {state,history,store:{state,save(){}},selection:{layer:'task',projectIds:['p'],taskIds:['tp'],agentIds:['ap'],workSessionIds:['w']}};
}

test('owner chat keeps global history, memory, inventory and runtime when a project, task and session are focused',async()=>{
  const f=fixture(),inputs=[];
  const c=new Coordinator(f.store,{defaultCwd:'/fixture',modelRunner:async input=>{inputs.push(input);return reply();}}).configure({history:f.history,liveReader:async()=>f.state.sessions});
  for(const scope of [f.selection,{...f.selection,layer:'project',projectIds:['q']}]) {
    const turn=await c.askOwner('What is running across my projects?','a-team',f.state.sessions,f.history,'w',false,'local',{scope});
    assert.equal(turn.context.key,'global');assert.equal(turn.runtime.cwd,'/fixture');assert.equal(turn.runtime.workSessionId,'w');
  }
  for(const input of inputs){assert.equal(input.authorizedScope,null);assert.match(input.conversationAccess.scope,/all direct Conductor exchanges/);assert.equal(input.snapshot.projects.length,2);assert.equal(input.snapshot.tasks.length,2);assert.equal(input.snapshot.terminals.length,2);assert.equal(input.snapshot.coverage.excludedHistory,0);assert.match(JSON.stringify(input.conversation),/OWNER_PRIVATE/);}
  assert.equal(inputs[0].memory,'GLOBAL_PRIVATE');assert.deepEqual(inputs[0].selection,f.selection);assert.equal(inputs[1].memory,'Owner memory.');
});

test('global drafts are discarded; a clean project action executes once through the unchanged privacy guard',async()=>{
  const f=fixture(),inputs=[],effects=[];
  const draft={type:'start_team',projectId:'p',name:'GLOBAL_PRIVATE',text:'Q_PRIVATE',members:[{provider:'codex',role:'GLOBAL_PRIVATE',task:'Q_PRIVATE'}]};
  const clean={type:'start_team',projectId:'p',name:'Example reviewers',text:'Review the example project',members:['Design','Integration','Core','Publication'].map(role=>({provider:'codex',role,task:'Review your assigned area.'}))};
  let ownerRounds=0;
  const c=new Coordinator(f.store,{defaultCwd:'/fixture',modelRunner:async(input,meta)=>{
    inputs.push(structuredClone(input));assert.ok(Buffer.byteLength(JSON.stringify(input))<=MAX_INPUT_BYTES);
    if(input.mode==='project-dispatch'){
      assert.equal(meta.runtime.access,'read-only');assert.equal(meta.runtime.skills,false);assert.equal(meta.runtime.mode,'project-dispatch');
      assert.doesNotMatch(JSON.stringify(input),/GLOBAL_PRIVATE|Q_PRIVATE|OWNER_PRIVATE/);
      assert.equal(input.memory,'P_MEMORY');assert.deepEqual(input.route,{type:'start_team',projectId:'p'});return reply([clean]);
    }
    return reply(++ownerRounds<3?[{...draft,name:draft.name+ownerRounds}]:[]);
  }}).configure({history:f.history,liveReader:async()=>f.state.sessions,actionHandler:async(action,metadata)=>{validateConductorContent(f.state,action,metadata);effects.push({action,metadata});return {teamId:'created',members:action.members.length};}});
  const turn=await c.askOwner('Create a team of four reviewers for the example project: Design, Integration, Core and Publication.','',f.state.sessions,f.history);
  assert.equal(turn.status,'complete');assert.equal(effects.length,1);assert.deepEqual(effects[0].action,clean);assert.equal(effects[0].metadata.context.key,'project:p');
  assert.equal(turn.actions[0].dispatch.status,'executed');assert.equal(turn.actions[1].status,'duplicate');assert.equal(turn.modelRounds,4);assert.deepEqual(turn.usage,{input_tokens:8,output_tokens:4});assert.equal(inputs.filter(i=>i.mode==='project-dispatch').length,1);
  assert.throws(()=>validateConductorContent(f.state,draft,{context:{key:'global'}}),/isolated project dispatch/);
});

test('activation of an existing team receives its saved roster only inside the destination project dispatch',async()=>{
  const f=fixture(),effects=[];let rounds=0;
  const roster=['Design','Integration','Core','Publication'].map(role=>({provider:'codex',role,task:`Review ${role}. Preserve existing work.`}));
  f.state.teams.push({id:'saved-team',name:'Saved team',projectId:'p',mission:'Review this project; do not publish.',roster},
    {id:'other-team',name:'Other team',projectId:'q',roster:[{provider:'codex',role:'Q_PRIVATE',task:'Q_PRIVATE'}]});
  const c=new Coordinator(f.store,{modelRunner:async input=>{
    if(input.mode==='project-dispatch'){
      assert.doesNotMatch(JSON.stringify(input),/Q_PRIVATE|GLOBAL_PRIVATE|OWNER_PRIVATE/);
      const team=input.snapshot.teams.find(t=>t.id==='saved-team');
      assert.deepEqual(team.roster,roster);assert.deepEqual(team.rosterCoverage,{total:4,shown:4});
      return reply([{type:'add_team_members',target:team.id,members:team.roster}]);
    }
    return reply(rounds++?[]:[{type:'add_team_members',target:'saved-team',members:[{provider:'codex',role:'GLOBAL_PRIVATE',task:'Q_PRIVATE'}]}]);
  }}).configure({history:f.history,liveReader:async()=>f.state.sessions,actionHandler:async(action,meta)=>{
    validateConductorContent(f.state,action,meta);effects.push(action);return {started:action.members.map(m=>({role:m.role}))};
  }});
  const turn=await c.askOwner('Activate the existing four-role team for the example project.','',f.state.sessions,f.history);
  assert.equal(turn.status,'complete');assert.equal(effects.length,1);assert.deepEqual(effects[0].members,roster);
});

test('independent project dispatches never consume each other or the global receipts',async()=>{
  const f=fixture(),effects=[];let rounds=0;
  const c=new Coordinator(f.store,{modelRunner:async input=>{
    if(input.mode==='project-dispatch'){
      const own=input.route.projectId;assert.ok(input.snapshot.tasks.every(t=>t.projectId===own));assert.deepEqual(input.actionResults,[]);
      if(own==='p')assert.doesNotMatch(JSON.stringify(input),/Q_PRIVATE/);else assert.doesNotMatch(JSON.stringify(input),/P_ONLY|P_MEMORY|P_REPORT/);
      return reply([{...input.route,text:'Check this project.'}]);
    }
    return reply(rounds++?[]:[{type:'prompt_agent',target:'ap'},{type:'prompt_agent',target:'aq'}]);
  }}).configure({history:f.history,liveReader:async()=>f.state.sessions,actionHandler:async(action,meta)=>{validateConductorContent(f.state,action,meta);effects.push(action.target);return {delivery:'queued'};}});
  const turn=await c.askOwner('Ask both project agents to check their own work.','',f.state.sessions,f.history);
  assert.equal(turn.status,'complete');assert.deepEqual(effects,['ap','aq']);assert.equal(turn.context.key,'global');
});

test('missing input, destination changes and cancellation cause no agent effects',async()=>{
  for(const outcome of ['no-action','other-target','cancel','changed-context']) {
    const f=fixture();let rounds=0,effects=0;
    const c=new Coordinator(f.store,{modelRunner:async input=>{
      if(input.mode!=='project-dispatch')return reply(rounds++?[]:[{type:'prompt_agent',target:'ap'}]);
      if(outcome==='no-action')return {...reply(),answer:'The direct request does not authorize an agent prompt.'};
      if(outcome==='cancel')c.cancel();
      if(outcome==='changed-context')f.state.sessions[0].contextIsolation=true;
      return reply([{type:'prompt_agent',target:outcome==='other-target'?'aq':'ap',text:'Check work.'}]);
    }}).configure({history:f.history,liveReader:async()=>f.state.sessions,actionHandler:async(action,meta)=>{validateConductorContent(f.state,action,meta);effects++;return {};}});
    const turn=await c.askOwner('Check the project.','',f.state.sessions,f.history);
    assert.equal(effects,0,outcome);assert.equal(turn.actions[0].status,outcome==='no-action'?'not_run':'failed');
  }
});

test('routing resolves record identities, rejects conflicts, and does not carry generated prose or broaden assignments',()=>{
  const {state,selection}=fixture();
  const route=projectDispatchRoute(state,{type:'prompt_agent',target:'ap',name:'PRIVATE',text:'PRIVATE',members:[{role:'PRIVATE'}]},selection);
  assert.deepEqual(route,{type:'prompt_agent',projectId:'p',target:'ap'});
  assert.throws(()=>projectDispatchRoute(state,{type:'prompt_agent',target:'ap',projectId:'q'},selection),/unambiguous/);
  assert.throws(()=>projectDispatchRoute(state,{type:'start_team'},null),/unambiguous/);
  assert.throws(()=>projectDispatchRoute(state,{type:'update_task',target:'tp',taskId:'tq'},selection),/conflicting/);
  assert.throws(()=>validateDispatchedAction(state,{type:'prompt_agent',target:'aq'},route),/unambiguous|destination/);
  assert.throws(()=>validateDispatchedAction(state,{type:'session_state',target:'ap'},route),/operation/);
  assert.throws(()=>validateDispatchedAction(state,{type:'prompt_agent',target:'ap',taskId:'tp'},route),/assignment/);
  const command=conductorCommand({mode:'project-dispatch',cwd:'/fixture',access:'full',skills:true},'/fixture/reply.json');
  assert.ok(command.args.includes('--ignore-user-config'));assert.ok(command.args.includes('shell_tool'));assert.ok(command.args.includes('read-only'));assert.ok(command.args.includes('plugins'));
});

test('same-project creation is grouped without dropping requested tasks or exceeding the four-action round budget',async()=>{
  const f=fixture(),effects=[];let rounds=0,dispatches=0;
  const c=new Coordinator(f.store,{modelRunner:async input=>{
    if(input.mode==='project-dispatch'){
      dispatches++;assert.equal(input.maxActions,4);
      return reply(['One','Two','Three','Four'].map(name=>({type:'create_task',projectId:'p',name})));
    }
    if(rounds++===0)return reply([{type:'create_task',projectId:'p',name:'First draft'},{type:'create_task',projectId:'p',name:'Second draft'},{type:'prompt_agent',target:'ap'}]);
    return reply();
  }}).configure({history:f.history,liveReader:async()=>f.state.sessions,actionHandler:async(action,meta)=>{validateConductorContent(f.state,action,meta);effects.push(action.name);return {taskId:action.name};}});
  const turn=await c.askOwner('Create four tasks named One, Two, Three and Four for the example project.','',f.state.sessions,f.history);
  assert.deepEqual(effects,['One','Two','Three','Four']);assert.equal(dispatches,1);assert.equal(turn.actions[1].status,'not_run');assert.equal(turn.actions[2].status,'not_run');assert.equal(turn.actions[0].dispatch.actions.length,4);
});

test('partial project dispatch failures retain every actual receipt and do not imply all requested effects succeeded',async()=>{
  const f=fixture();let rounds=0;
  const c=new Coordinator(f.store,{modelRunner:async input=>input.mode==='project-dispatch'?reply(['One','Two'].map(name=>({type:'create_task',projectId:'p',name}))):reply(rounds++?[]:[{type:'create_task',projectId:'p'}])}).configure({history:f.history,liveReader:async()=>f.state.sessions,actionHandler:async action=>{if(action.name==='Two')throw new Error('Fixture refused second task.');return {taskId:'one'};}});
  const turn=await c.askOwner('Create tasks One and Two for the example project.','',f.state.sessions,f.history);
  assert.equal(turn.actions[0].status,'failed');assert.equal(turn.actions[0].result.partial,true);assert.deepEqual(turn.actions[0].dispatch.actions.map(a=>a.status),['executed','failed']);assert.match(turn.actions[0].result.error,/refused/);
});

test('interrupted project dispatch is uncertain after restart and cannot be replayed with changed global prose',async()=>{
  const f=fixture();let rounds=0,saved,effects=0;
  const draft={type:'prompt_agent',target:'ap',text:'Global draft'};
  const c=new Coordinator(f.store,{modelRunner:async input=>input.mode==='project-dispatch'?reply([{type:'prompt_agent',target:'ap',text:'Check this project.'}]):reply(rounds++?[]:[draft])}).configure({history:f.history,liveReader:async()=>f.state.sessions,actionHandler:async()=>{saved=structuredClone(f.state);effects++;return {delivery:'queued'};}});
  await c.askOwner('Ask the example project agent to check its work.','',f.state.sessions,f.history);
  const restarted=new Coordinator({state:saved,save(){}},{modelRunner:async()=>reply([{...draft,text:'Different global draft'}])}).configure({history:f.history,liveReader:async()=>saved.sessions,actionHandler:async()=>{effects++;return {};}});
  const receipt=Object.values(saved.conductor.actionReceipts)[0];assert.equal(receipt.status,'uncertain');assert.equal(receipt.dispatch.actions[0].status,'uncertain');
  const turn=await restarted.askOwner('Ask the example project agent to check its work.','',saved.sessions,f.history);
  assert.equal(effects,1);assert.equal(turn.actions[0].status,'duplicate');assert.match(turn.actions[0].result.error,/stopped before the action outcome/);
});

test('each environment has its own Conductor conversation and can address any project in that environment',async()=>{
  const f=fixture();
  f.state.projects.push({id:'remote-project',name:'Remote project',host:'remote-example',cwd:'/remote',notes:'REMOTE_PRIVATE'});
  f.state.sessions.push({id:'remote-agent',kind:'managed',projectId:'remote-project',contextProjectId:'remote-project',host:'remote-example',status:'running'});
  const inputs=[];
  const c=new Coordinator(f.store,{defaultCwd:'/fixture',modelRunner:async input=>{inputs.push(input);return reply();}}).configure({history:f.history,liveReader:async()=>f.state.sessions});
  const local=await c.askOwner('What is open?','',f.state.sessions,f.history,'',false,'local',{scope:f.selection});
  const remote=await c.askOwner('What is open on the remote workspace?','',f.state.sessions,f.history,'',false,'remote-example');
  assert.equal(local.environment,'local');assert.equal(remote.environment,'remote-example');
  assert.equal(c.status('local').history.some(turn=>turn.id===remote.id),false);
  assert.equal(c.status('remote-example').history.some(turn=>turn.id===local.id),false);
  assert.equal(inputs[0].environmentWorkspace.projects.some(project=>project.id==='q'),true);
  assert.equal(inputs[0].environmentWorkspace.projects.some(project=>project.id==='remote-project'),false);
  assert.equal(inputs[0].snapshot.projects.some(project=>project.id==='remote-project'),false);
  assert.equal(inputs[1].snapshot.terminals.some(agent=>agent.id==='remote-agent'),true);
  assert.equal(inputs[1].snapshot.terminals.some(agent=>agent.id==='ap'),false);
  assert.doesNotMatch(JSON.stringify(inputs[0]),/REMOTE_PRIVATE/);
});
