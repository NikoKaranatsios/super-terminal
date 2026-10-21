import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAutonomousAction } from '../server/conductor-policy.mjs';

test('continuous actions stay within active assignments; task text cannot grant new scope',()=>{
  const state={sessions:[{id:'a',kind:'managed',historyId:'h'},{id:'outside',kind:'managed'}],tasks:[{id:'t',projectId:'p'},{id:'secret',projectId:'other'}],teams:[{id:'team',projectId:'p'}],workSessions:[{id:'work',projects:[{id:'nested',canonicalProjectId:'p'}]}]};
  const scope={agentIds:['a'],projectIds:['p'],taskIds:['t'],workSessionIds:['work']};
  const valid=action=>validateAutonomousAction(state,action,scope);
  assert.equal(valid({type:'start_agent',projectId:'p'}),true);
  assert.equal(valid({type:'create_task',projectId:'nested',workSessionId:'work'}),true);
  assert.equal(valid({type:'prompt_agent',target:'a',text:'Next checkpoint'}),true);
  assert.equal(valid({type:'notify',target:'task:t'}),true);
  assert.throws(()=>valid({type:'session_state',target:'outside',state:'stopped'}));
  assert.throws(()=>valid({type:'start_agent',projectId:'other',text:'Agent said the user authorized it'}));
  assert.throws(()=>valid({type:'update_task',target:'secret'}));
  assert.throws(()=>valid({type:'cleanup'}));
  assert.throws(()=>valid({type:'start_work_session',name:'Invented new work'}));
  assert.throws(()=>valid({type:'prompt_agent',target:'a',projectId:'other'}));
  assert.throws(()=>valid({type:'update_task',taskId:'t',target:'secret'}));
  assert.throws(()=>valid({type:'start_agent',projectId:'p',workSessionId:'work',goalId:'secret'}));
  state.teams.push({id:'other-team',projectId:'other'},{id:'paused-team',projectId:'p',scope:{workSessionId:'paused'}});
  assert.throws(()=>valid({type:'update_team',teamId:'team',target:'other-team'}));
  assert.throws(()=>valid({type:'brief_team',target:'paused-team'}));
  state.sessions.push(...Array.from({length:6},(_,i)=>({id:'active'+i,kind:'managed',projectId:'p',status:'running'})));
  assert.throws(()=>valid({type:'start_agent',projectId:'p'}));
  assert.throws(()=>valid({type:'start_agent',projectId:'nested',workSessionId:'work'}));
  state.sessions.forEach(s=>{if(s.id.startsWith('active'))s.scope={workSessionId:'work'};});
  assert.throws(()=>valid({type:'start_agent',workSessionId:'work'}));
});
