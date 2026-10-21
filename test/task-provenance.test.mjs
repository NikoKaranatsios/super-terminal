import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeTasks, createTask, updateTask, recordTaskEvent } from '../server/tasks.mjs';
import { allowedProjectIds, canReadProjectContent, agentScopeContext, messageVisible } from '../server/project-access.mjs';
import { contextProvenance } from '../server/coordinator.mjs';

function fixture() {
  const state = { projects: [{id:'a'}, {id:'b'}], teams: [{id:'shared', projectId:'a'}], sessions: [{id:'writer',projectId:'a',teamId:'shared'}, {id:'peer',projectId:'b',teamId:'shared'}], workSessions: [{id:'work',projects:[{id:'nested',canonicalProjectId:'a',name:'A',goals:[{id:'goal',title:'Review',status:'todo',notes:''}]}]}] };
  initializeTasks(state);
  return { state, writer:state.sessions[0], task:state.tasks[0] };
}

test('shared task report retains source restrictions after the reporting agents are removed', () => {
  const {state,writer,task} = fixture();
  recordTaskEvent(state,writer,{taskId:task.id,eventId:'shared-report',notes:'Shared B findings'});
  assert.deepEqual(task.contentProjectIds,['a','b']);
  assert.deepEqual(state.taskEvents[0].contentProjectIds,['a','b']);
  state.sessions=[];
  assert.equal(canReadProjectContent(state,{id:'fresh',projectId:'a'},task),false);
  const context = contextProvenance(state,[],{layer:'project',projectIds:['a'],taskIds:[task.id],agentIds:[]});
  assert.deepEqual(context.projectIds,['a','b']);
  assert.equal(context.isolated,false);
});

test('retained team sharing grants remain explicit and do not come from agent provenance', () => {
  const {state,writer,task} = fixture();
  task.contentProjectIds=['a','b'];
  state.sessions.pop();
  writer.contentProjectIds=['a','b'];
  assert.deepEqual([...allowedProjectIds(state,writer)],['a']);
  assert.equal(canReadProjectContent(state,writer,task),false);
  state.teams[0].sharedProjectIds=['a','b'];
  assert.equal(canReadProjectContent(state,writer,task),true);
  delete writer.teamId;
  assert.equal(canReadProjectContent(state,writer,task),false);
});

test('task reads, legacy goal context and reports reject unavailable retained sources', () => {
  const {state,writer,task} = fixture();
  recordTaskEvent(state,writer,{taskId:task.id,eventId:'report',notes:'Shared findings'});
  delete writer.teamId;
  writer.scope={workSessionId:'work',projectId:'nested'};
  const before=JSON.stringify(state);
  assert.throws(()=>recordTaskEvent(state,writer,{taskId:task.id,eventId:'blocked',notes:'Cannot overwrite to remove provenance'}),/outside your current grant/);
  assert.equal(JSON.stringify(state),before);
  assert.deepEqual(agentScopeContext(state,writer).projects[0].goals,[]);
  writer.teamId='shared';
  assert.equal(agentScopeContext(state,writer).projects[0].goals.length,1);
});

test('creation, parent and scope inheritance, migration and updates never drop sources', () => {
  const {state,writer,task} = fixture();
  updateTask(state,task.id,{notes:'Shared source'},{contentProjectIds:['b']});
  const child=createTask(state,{projectId:'a',title:'Child',scope:task.scope,parentTaskId:task.id});
  const scoped=createTask(state,{projectId:'a',title:'Scoped',scope:task.scope});
  assert.deepEqual(child.contentProjectIds,['a','b']);
  assert.deepEqual(scoped.contentProjectIds,['a','b']);
  updateTask(state,task.id,{notes:'Replacement notes',contentProjectIds:[]});
  assert.deepEqual(task.contentProjectIds,['a','b']);
  const before=JSON.stringify(state); initializeTasks(state);
  assert.equal(JSON.stringify(state),before);
  writer.taskId=child.id; writer.scope=child.scope;
  const created=recordTaskEvent(state,writer,{operation:'create',clientKey:'created',title:'Created child'}).task;
  assert.deepEqual(created.contentProjectIds,['a','b']);
  assert.deepEqual(recordTaskEvent(state,writer,{operation:'create',clientKey:'created',title:'Created child'}).task.contentProjectIds,['a','b']);
});

test('carried legacy goal provenance survives missing old task records and reverse migration order', () => {
  const {state,task} = fixture();
  task.contentProjectIds=['a','b'];
  state.workSessions.unshift({id:'carry',projects:[{id:'carried',canonicalProjectId:'a',goals:[{id:'new-goal',title:'Carried',status:'todo',notes:'Shared summary',carriedFromGoalId:task.id}]}]});
  initializeTasks(state);
  assert.deepEqual(state.tasks.find(t=>t.id==='new-goal').contentProjectIds,['a','b']);
  const goal=state.workSessions[0].projects[0].goals[0];
  state.tasks=[]; state.workSessions=[state.workSessions[0]];
  initializeTasks(state);
  assert.deepEqual(state.tasks[0].contentProjectIds,['a','b']);
  assert.deepEqual(goal.contentProjectIds,['a','b']);
});

test('mailbox source grants and malformed provenance fail closed', () => {
  const {state,writer,task}=fixture();
  const message={to:writer.id,from:'you',projectId:'a',teamId:'shared',assignmentRevision:0,sourceProjectIds:['a','b']};
  assert.equal(messageVisible(state,message,writer),true);
  state.sessions.pop();
  assert.equal(messageVisible(state,message,writer),false);
  assert.equal(canReadProjectContent(state,writer,{projectId:'a',contentProjectIds:'b'}),false);
  const before=JSON.stringify(state);
  assert.throws(()=>updateTask(state,task.id,{contentProjectIds:'b'}),/provenance/);
  assert.equal(JSON.stringify(state),before);
});
