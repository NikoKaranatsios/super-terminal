import test from 'node:test';
import assert from 'node:assert/strict';
import {sandboxPolicy,configureTeamRuntime,runtimeSummary} from '../server/sandbox-policy.mjs';
import {requestHelper,reconcileHelperRequests} from '../server/delegation.mjs';
import {publicAddress,destination} from '../runtime/egress.mjs';
import {SandboxRuntime,dockerCommand} from '../server/sandbox-runtime.mjs';
import {performAction} from '../server/conductor-actions.mjs';
import {validateState} from '../server/state-schema.mjs';
import {systemGraph} from '../shared/system-graph.mjs';

function fixture(){
  const team={id:'team',projectId:'p',host:'local',cwd:'/fixture',runtime:sandboxPolicy({delegation:true,maxAgents:3,maxLaunches:4}),runtimeRevision:1};
  const parent={id:'parent',kind:'managed',status:'running',projectId:'p',contextProjectId:'p',contentProjectIds:['p'],teamId:'team',host:'local',provider:'codex',taskId:'task',attemptId:'attempt',assignmentRevision:0,execution:{kind:'container',policyRevision:1}};
  const store={state:{sessions:[parent],teams:[team],projects:[{id:'p',host:'local'}],tasks:[{id:'task',projectId:'p',title:'Fixture task',notes:'',status:'doing',revision:1,evidence:[],activity:[]}],hosts:[],lifecycle:{}},save(){}};
  const context={liveSessions:async()=>store.state.sessions,createSession:async body=>{const s={...body,id:'child-'+store.state.sessions.length,status:'running',execution:{kind:'container',policyRevision:1}};store.state.sessions.push(s);team.runtimeLaunches=(team.runtimeLaunches||0)+1;return s;}};
  const input={command:'delegate',requestId:'request',role:'Reviewer',task:'Check the assigned fixture',attemptId:'attempt',assignmentRevision:0};
  return {team,parent,store,context,input};
}
test('runtime policy rejects permission broadening and malformed limits',()=>{
  for(const patch of [{privileged:true},{mounts:['/']},{domains:['*']},{domains:['127.0.0.1']},{domains:['host.docker.internal']},{memoryMb:Infinity},{maxAgents:7},{maxDepth:3},{image:'image; touch /tmp/no'},{mode:'host',delegation:true}])assert.throws(()=>sandboxPolicy(patch));
  const f=fixture();assert.throws(()=>configureTeamRuntime(f.store.state,f.team,{maxAgents:6}),/Stop/);f.parent.status='stopped';assert.equal(configureTeamRuntime(f.store.state,f.team,{maxAgents:6}).maxAgents,6);assert.equal(f.team.runtimeRevision,2);
  assert.throws(()=>validateState({...f.store.state,teams:[{...f.team,runtime:{maxAgents:99}}]}),/maxAgents/);
  for(const runtimeLaunches of [-1,1.5,'3'])assert.throws(()=>validateState({...f.store.state,teams:[{...f.team,runtimeLaunches}]}),/runtimeLaunches/);
  f.team.runtimeServices={gateway:{state:'running'}};assert.throws(()=>configureTeamRuntime(f.store.state,f.team,{maxAgents:3}),/Release/);
});
test('helpers inherit scope and concurrent retries launch exactly once',async()=>{
  const f=fixture();const results=await Promise.all([requestHelper(f.store,f.parent,f.input,f.context),requestHelper(f.store,f.parent,f.input,f.context)]);
  assert.equal(f.store.state.sessions.length,2);assert.equal(results[0].childAgentId,results[1].childAgentId);assert.equal(results[1].duplicate,true);
  const child=f.store.state.sessions[1];assert.equal(child.parentAgentId,'parent');assert.equal(child.parentTaskId,'task');assert.equal(child.projectId,'p');assert.equal(child.teamId,'team');assert.equal(child.cwd,'/fixture');assert.equal(child.delegationDepth,1);
  await assert.rejects(requestHelper(f.store,f.parent,{...f.input,task:'Different work'},f.context),/different work/);
});
test('agent requests cannot enable delegation, escape assignment or bypass inherited depth',async()=>{
  for(const mutation of [f=>f.team.runtime.delegation=false,f=>f.parent.contextIsolation='restart-required',f=>f.parent.enrollmentRevokedAt='revoked',f=>f.parent.delegationDepth=1,f=>f.parent.execution.policyRevision=0,f=>f.parent.status='paused',f=>f.input.projectId='another',f=>f.input.assignmentRevision=2,f=>f.parent.contentProjectIds=['foreign']]){
    const f=fixture();mutation(f);await assert.rejects(requestHelper(f.store,f.parent,f.input,f.context));assert.equal(f.store.state.sessions.length,1);
  }
});
test('capacity, lifetime launch allowance and stale in-flight assignments are enforced',async()=>{
  let f=fixture();f.team.runtime.maxAgents=1;await assert.rejects(requestHelper(f.store,f.parent,f.input,f.context),/concurrent-agent/);
  f=fixture();f.team.runtimeLaunches=4;await assert.rejects(requestHelper(f.store,f.parent,f.input,f.context),/allowance/);
  f=fixture();f.context.liveSessions=async()=>{f.parent.assignmentRevision++;return f.store.state.sessions;};await assert.rejects(requestHelper(f.store,f.parent,f.input,f.context),/changed/);
});
test('failed and interrupted helper launches never replay blindly',async()=>{
  const f=fixture();let launches=0;f.context.createSession=async()=>{launches++;throw new Error('Synthetic unavailable image');};
  const first=await requestHelper(f.store,f.parent,f.input,f.context);assert.equal(first.status,'failed');assert.match(first.error,/unavailable/);
  assert.equal((await requestHelper(f.store,f.parent,f.input,f.context)).duplicate,true);assert.equal(launches,1);
  f.team.delegations[0].status='launching';reconcileHelperRequests(f.store.state);assert.equal(f.team.delegations[0].status,'uncertain');
  assert.equal((await requestHelper(f.store,f.parent,f.input,f.context)).status,'uncertain');assert.equal(launches,1);
});
test('autonomous Conductor cannot increase runtime permissions',async()=>{
  const f=fixture();await assert.rejects(performAction({type:'configure_team_runtime',target:'team',text:'{"delegation":true}'},{store:f.store,autonomous:true}),/direct owner/);
});
test('egress validates exact public destinations and pins DNS without private fallbacks',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','224.0.0.1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('1.1.1.1'),true);const allowed=new Set(['example.org']);let queried=0;
  await assert.rejects(destination('evil.example.org',443,allowed,async()=>{queried++;return [];}),/allowance/);assert.equal(queried,0);
  await assert.rejects(destination('example.org',22,allowed),/allowance/);
  await assert.rejects(destination('example.org',443,allowed,async()=>[{address:'1.1.1.1'},{address:'127.0.0.1'}]),/Private/);
  assert.equal(await destination('example.org',443,allowed,async()=>[{address:'1.1.1.1'}]),'1.1.1.1');
});
test('runtime controls refuse foreign resources and preserve partial outcomes',async()=>{
  const f=fixture();f.parent.execution={kind:'container',container:'foreign'};f.parent.agentToken='fixture-only';
  const runtime=new SandboxRuntime({store:f.store,dataDir:'/synthetic',root:process.cwd(),command:async()=>JSON.stringify([{Config:{Labels:{'super-terminal.owner':'not-this-store'}},State:{Running:true}}])});
  const result=await runtime.control(f.parent,'stopped');assert.equal(result.ok,false);assert.equal(result.state,'unknown');assert.match(result.results[0].error,/ownership/);assert.equal(f.parent.agentToken,undefined);
  assert.equal(runtimeSummary(f.team,f.store.state.sessions).active,1,'An unconfirmed stop must still reserve capacity');
  assert.throws(()=>configureTeamRuntime(f.store.state,f.team,{maxAgents:6}),/Stop/);
  f.team.runtime.maxAgents=1;await assert.rejects(runtime.launch({...f.parent,id:'fresh',enrollmentRevokedAt:undefined},f.team,'fixture'),/concurrent-agent/);
  assert.throws(()=>dockerCommand('-bad',[]));
});
test('owner graph shows runtime ownership and helper lineage within its environment',()=>{
  const f=fixture();f.parent.execution={kind:'container',state:'running',workspace:'/workspace/repo',networkMode:'offline'};f.store.state.sessions.push({...f.parent,id:'child',parentAgentId:'parent'});
  const graph=systemGraph(f.store.state);assert.ok(graph.nodes.some(n=>n.kind==='sandbox'&&n.open==='runtime:parent'));assert.ok(graph.edges.some(e=>e.from==='agent:parent'&&e.to==='agent:child'&&e.type==='delegation'));
  assert.equal(systemGraph(f.store.state,'another').nodes.some(n=>n.kind==='sandbox'),false);
});
