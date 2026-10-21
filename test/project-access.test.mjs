import test from 'node:test';
import assert from 'node:assert/strict';
import {contextKey,peersAllowed,agentScopeContext,messageVisible,allowedProjectIds} from '../server/project-access.mjs';
import {validateConductorContent} from '../server/conductor-access.mjs';
import {resolveFocus} from '../server/user-focus.mjs';
import {initializeTasks,recordTaskEvent} from '../server/tasks.mjs';

function fixture() {
  const state = {projects:[{id:'p',name:'App',host:'local',cwd:'/fixture/a'},{id:'q',name:'App',host:'local',cwd:'/fixture/b'}],teams:[{id:'team',name:'Shared',projectId:'p'}],sessions:[{id:'a',projectId:'p',group:'App',scope:{workSessionId:'w'}},{id:'b',projectId:'q',group:'App',scope:{workSessionId:'w'}}],workSessions:[{id:'w',title:'PRIVATE OTHER PROJECT TITLE',projects:[{id:'nested-p',canonicalProjectId:'p',name:'App',goals:[{id:'g',title:'Own task',notes:'',status:'todo'}]},{id:'nested-q',canonicalProjectId:'q',name:'SECRET OTHER PROJECT',goals:[{id:'h',title:'Foreign task',notes:'private',status:'todo'}]}]}]};
  initializeTasks(state); return state;
}
test('names and shared working sessions never grant peers or context access',()=>{
  const s=fixture(),[a,b]=s.sessions;
  assert.equal(peersAllowed(s,a,b),false);
  assert.notEqual(contextKey(s,a),contextKey(s,b));
  const context=JSON.stringify(agentScopeContext(s,a));
  assert.match(context,/Own task/); assert.doesNotMatch(context,/SECRET|PRIVATE|Foreign/);
  assert.throws(()=>recordTaskEvent(s,a,{taskId:'h',notes:'Forbidden'}),/outside/);
  a.teamId=b.teamId='team';
  assert.equal(peersAllowed(s,a,b),true); assert.equal(contextKey(s,a),contextKey(s,b));
  assert.deepEqual([...allowedProjectIds(s,a)].sort(),['p','q']);
  assert.throws(()=>recordTaskEvent(s,a,{taskId:'h',notes:'Sharing does not assign tasks'}),/outside/);
});
test('mailbox delivery is bound to recipient assignment and current explicit team',()=>{
  const s=fixture(),[a,b]=s.sessions; a.teamId=b.teamId='team';
  const m={to:'a',from:'b',projectId:'p',teamId:'team',assignmentRevision:0};
  assert.equal(messageVisible(s,m,a),true);
  delete b.teamId; assert.equal(messageVisible(s,m,a),false);
  assert.equal(messageVisible(s,{...m,from:'you'},a),true);
  a.assignmentRevision=1; assert.equal(messageVisible(s,{...m,from:'you'},a),false);
  assert.equal(messageVisible(s,{to:'a',from:'you'},a),false,'legacy unstamped messages are owner-visible only');
});
test('Conductor rejects global and foreign prose before dispatch or persistence',()=>{
  const s=fixture();
  const action={type:'prompt_agent',target:'a',text:'Test'};
  assert.throws(()=>validateConductorContent(s,action,{context:{key:'global',isolated:false,projectIds:['p','q']}}),/privacy/);
  assert.throws(()=>validateConductorContent(s,action,{context:{key:'project:q',isolated:true,projectIds:['q']}}),/privacy/);
  assert.doesNotThrow(()=>validateConductorContent(s,action,{context:{key:'project:p',isolated:true,projectIds:['p']}}));
  assert.throws(()=>validateConductorContent(s,{type:'update_task',target:'g',text:'Foreign'},{context:{isolated:true,projectIds:['q']}}),/privacy/);
  for (const action of [{type:'update_task',target:'h',projectId:'p',text:'Secret'},{type:'update_task',target:'h',taskId:'g',text:'Secret'},{type:'update_project',target:'q',projectId:'p',text:'Secret'}]) assert.throws(()=>validateConductorContent(s,action,{context:{key:'project:p',isolated:true,projectIds:['p']}}),/privacy/);
  assert.doesNotThrow(()=>validateConductorContent(s,{type:'session_state',target:'a',state:'paused'},{}));
});
test('focus resolution infers project and rejects conflicting client hints',()=>{
  const s=fixture();
  assert.equal(resolveFocus(s,{agentId:'a'},s.sessions).projectId,'p');
  assert.throws(()=>resolveFocus(s,{agentId:'a',projectId:'q'},s.sessions),/outside/);
  assert.throws(()=>resolveFocus(s,{taskId:'h',projectId:'p'},s.sessions),/outside/);
  assert.equal(resolveFocus(s,{},s.sessions).projectId,null);
});
