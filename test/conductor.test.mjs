import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { performAction } from '../server/conductor-actions.mjs';
import { applyAssessments } from '../server/coordinator.mjs';
import { matchHistory } from '../server/history.mjs';
import { run } from '../server/core.mjs';

const context = () => ({store:{state:{sessions:[],teams:[],projects:[],messages:[]},save(){}},liveSessions:async()=>[],allowedHosts:[],history:{},removeBridge:async()=>{},createSession:async()=>{throw new Error('unexpected launch');}});
test('Conductor classifications cannot invent conversation IDs or validity states',()=>{
  const state={assessments:{}};
  applyAssessments(state,[{id:'a',status:'open',summary:'Finish tests'},{id:'missing',status:'completed'},{id:'b',status:'invented'}],[{id:'a',updatedAt:'now'},{id:'b',updatedAt:'then'}]);
  assert.deepEqual(Object.keys(state.assessments),['a']); assert.equal(state.assessments.a.version,'now');
});
test('external history requires an ID, open file, or unique matching start time',()=>{
  const a={provider:'codex',host:'local',cwd:'/work',startedAt:'2026-10-20T10:00:00Z'};
  const rows=[{id:'a',sessionId:'uuid',provider:'codex',host:'local',cwd:'/work',createdAt:'2026-10-20T10:00:03Z',file:'/history/a'}];
  assert.equal(matchHistory(a,rows),'a');
  assert.equal(matchHistory({...a,startedAt:null},rows),null);
  assert.equal(matchHistory({...a,runtime:true},rows),null);
  assert.equal(matchHistory({...a,resumeId:'uuid',startedAt:null},rows),'a');
  assert.equal(matchHistory(a,[...rows,{...rows[0],id:'b'}]),null);
  assert.equal(matchHistory({...a,host:'remote'},rows),null);
});
test('Conductor can create projects and teams, reporting partial launch failure',async()=>{
  const c=context();const project=await performAction({type:'create_project',name:'Example',cwd:process.cwd(),text:'First line\nSecond line'},c);
  const launches=[];
  c.createSession=async args=>{launches.push(args);if(args.provider==='missing')throw new Error('Not installed');return {id:'one',title:args.title};};
  const result=await performAction({type:'start_team',name:'Review',text:'Review\nwithout edits',projectId:project.project.id,members:[{provider:'codex',role:'Lead',task:'Inspect'},{provider:'missing',role:'Check',task:'Verify'}]},c);
  assert.equal(result.started.length,1);assert.equal(result.errors.length,1);assert.equal(launches[0].projectId,project.project.id);assert.equal(launches[0].group,'Review');
  await assert.rejects(performAction({type:'start_agent',host:'not-enabled'},c),/not enabled/);
  await assert.rejects(performAction({type:'start_team',name:'Large',text:'mission',members:Array(7).fill({})},c),/1–6/);
});
test('cleanup keeps live terminals, provider histories and unrelated state',async()=>{
  const c=context();c.store.state.sessions=[{id:'live'},{id:'stopped'}];c.store.state.conductor={memory:'keep'};
  c.liveSessions=async()=>[{id:'live',kind:'managed',status:'running',host:'local'},{id:'stopped',kind:'managed',status:'stopped',host:'local'}];
  await performAction({type:'cleanup'},c);assert.deepEqual(c.store.state.sessions,[{id:'live'}]);assert.equal(c.store.state.conductor.memory,'keep');
});
test('external process controls pause, resume and stop only the selected PID',async()=>{
  const child=spawn('/bin/sleep',['60']);await once(child,'spawn');
  const started=(await run('ps',['-p',String(child.pid),'-o','lstart='],{env:{...process.env,LC_ALL:'C'}})).stdout.trim();
  const c=context(); const row={id:'test',kind:'external',pid:child.pid,provider:'sleep',host:'local',title:'test sleep',status:'external',startedAt:new Date(started).toISOString()};
  c.liveSessions=async()=>[row];
  try {
    assert.equal((await performAction({type:'session_state',target:'test',state:'paused'},c)).ok,true);
    assert.match((await run('ps',['-p',String(child.pid),'-o','stat='])).stdout,/T/);
    row.status='paused';await performAction({type:'session_state',target:'test',state:'running'},c);
    assert.doesNotMatch((await run('ps',['-p',String(child.pid),'-o','stat='])).stdout,/T/);
    row.runtime=true;await assert.rejects(performAction({type:'session_state',target:'test',state:'stopped'},c),/shared provider service/);row.runtime=false;
    row.provider='codex';const rejected=await performAction({type:'session_state',target:'test',state:'stopped'},c);assert.equal(rejected.ok,false);assert.match(rejected.results[0].error,/identity changed/);row.provider='sleep';
    const exited=once(child,'exit');await performAction({type:'session_state',target:'test',state:'stopped'},c);await exited;
    assert.equal(c.store.state.lifecycle.test,'stopped');
  } finally {try{process.kill(child.pid,'SIGCONT');child.kill();}catch{}}
});
test('working sessions start, track goals, wrap and carry unfinished work',async()=>{
  const c=context();c.history={all:async()=>[]};
  const first=await performAction({type:'start_work_session',name:'Morning',text:'App: Fix startup\nApp: Review logs'},c);
  const goal=first.session.projects[0].goals[0];
  await performAction({type:'goal_progress',target:goal.id,state:'done',text:'Startup checked'},c);
  await performAction({type:'work_session_state',target:first.session.id,state:'wrapped',text:'Continue logs next time'},c);
  assert.equal(first.session.status,'wrapped');assert.match(first.session.summary,/Continue logs/);
  const next=await performAction({type:'start_work_session',name:'Afternoon',text:'',target:first.session.id},c);
  assert.equal(next.session.projects[0].goals.length,1);
  assert.equal(next.session.projects[0].goals[0].title,'Review logs');
});
test('task actions share completion validation and session pause does not signal agents',async()=>{
  const c=context();c.history={all:async()=>[]};
  const working=await performAction({type:'start_work_session',name:'Review',text:'App: Existing'},c);
  const project=working.session.projects[0];
  const created=await performAction({type:'create_goal',name:'New check',workSessionId:working.session.id,projectId:project.canonicalProjectId},c);
  assert.equal(project.goals.at(-1).id,created.task.id);
  await assert.rejects(performAction({type:'update_task',target:created.task.id,state:'done'},c),/evidence/);
  await performAction({type:'update_task',target:created.task.id,state:'blocked',text:'Need fixture'},c);
  assert.equal(project.goals.at(-1).status,'blocked');
  await performAction({type:'work_session_state',target:working.session.id,state:'paused'},c);
  assert.equal(working.session.status,'paused');assert.deepEqual(c.store.state.lifecycle,undefined);
});
test('partial team retries and concurrent requests launch missing roles only',async()=>{
  const c=context();c.liveSessions=async()=>c.store.state.sessions;
  let failed=true, launches=0;
  c.createSession=async args=>{
    launches++;
    if(args.role==='Check' && failed)throw new Error('Fixture unavailable');
    const row={...args,id:args.role,status:'running'};c.store.state.sessions.push(row);return row;
  };
  const members=[{role:'Lead',provider:'codex'},{role:'Check',provider:'codex'}];
  const result=await performAction({type:'start_team',name:'Review',text:'Review fixture',cwd:process.cwd(),members},c);
  assert.equal(result.errors.length,1);failed=false;
  const outcomes=await Promise.all([1,2].map(()=>performAction({type:'add_team_members',target:result.teamId,members},c)));
  assert.equal(launches,3);assert.equal(c.store.state.sessions.length,2);
  assert.equal(outcomes[1].existing.length,2);
  const before=c.store.state.teams.length;
  await assert.rejects(performAction({type:'start_team',name:'Invalid',text:'Mission',cwd:process.cwd(),members:[{role:'Same'},{role:'Same'}]},c),/distinct/);
  assert.equal(c.store.state.teams.length,before);
});
test('prompt and notifications use bounded hooks without claiming CLI execution',async()=>{
  const c=context();c.store.state.sessions.push({id:'agent',group:'group'});
  c.sendMessage=()=>({id:'queued'});
  const result=await performAction({type:'prompt_agent',target:'agent',text:'Continue authorized work'},c);
  assert.equal(result.delivery,'queued');assert.match(result.result,/not yet been accepted/);
  c.notify=async payload=>({notified:true,...payload});
  assert.equal((await performAction({type:'notify',name:'Review',text:'Needs your input'},c)).notified,true);
});
