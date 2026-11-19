import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConductorContent } from '../server/conductor-access.mjs';
import { validateOwnerCreation } from '../server/owner-intent.mjs';
import { performAction } from '../server/conductor-actions.mjs';
import { updateProjectRecord } from '../server/project-records.mjs';
const metadata={ownerIntent:true,ownerWorkSessionId:'work',context:{key:'owner-intent:fixture',projectIds:[]}};
test('only the clean owner parser can create; destination identities cannot expand scope',()=>{
  assert.throws(()=>validateConductorContent({}, {type:'create_project'}, {context:{key:'global'}}),/fresh direct-owner/);
  assert.doesNotThrow(()=>validateConductorContent({}, {type:'create_project',name:'Owner'},metadata));
  assert.throws(()=>validateOwnerCreation({type:'start_agent'}),/only create/);
  assert.throws(()=>validateOwnerCreation({type:'start_work_session',target:'other'},'work'),/selected/);
  assert.throws(()=>validateOwnerCreation({type:'create_project',projectId:'other'}),/import/);
  assert.throws(()=>validateOwnerCreation({type:'add_work_project',workSessionId:'other'},'work'),/Choose/);
});
test('clean creation does not consult history, topic edits share canonical location and keep running processes',async()=>{
  const state={sessions:[],projects:[],workSessions:[],tasks:[]},c={store:{state,save(){}},ownerIntent:true,allowedHosts:['fixture-host'],history:{all(){throw Error('must not read global histories');}},liveSessions:async()=>[]};
  const {session}=await performAction({type:'start_work_session',name:'Owner work',text:'App: Inspect',host:'fixture-host',cwd:'/remote/owner'},c);
  const {project}=await performAction({type:'add_work_project',workSessionId:session.id,name:'Second',host:'fixture-host',cwd:'/remote/second'},c);
  assert.equal(session.projects.length,2);assert.equal(session.projects[0].host,'fixture-host');
  state.sessions.push({id:'running',projectId:project.canonicalProjectId,cwd:'/old/directory'});
  updateProjectRecord(state,project.canonicalProjectId,{name:'Renamed',cwd:'/remote/new'},c.allowedHosts);
  assert.equal(project.name,'Renamed');assert.equal(project.cwd,'/remote/new');assert.equal(state.sessions[0].cwd,'/old/directory');
  const before=structuredClone(state);assert.throws(()=>updateProjectRecord(state,project.canonicalProjectId,{host:'local'},c.allowedHosts),/directory/);assert.deepEqual(state,before);
});
test('explicit bulk control reports every target and wrap retains unverified conflicting evidence',async()=>{
  const state={sessions:[],projects:[],workSessions:[],tasks:[],messages:[]};const rows=[{id:'a',scope:{workSessionId:'w'},title:'One',status:'running'},{id:'b',scope:{workSessionId:'w'},title:'Two',status:'unknown'},{id:'c',scope:{workSessionId:'else'}}];
  const c={store:{state,save(){}},history:{all:async()=>[]},liveSessions:async()=>rows,controlAgent:async a=>{if(a.id==='b')throw Error('unavailable');return {ok:true};}};
  state.workSessions.push({id:'w',title:'Review',status:'active',projects:[]});state.sessions=rows;
  const result=await performAction({type:'bulk_session_state',workSessionId:'w',state:'paused'},c);assert.equal(result.partial,true);assert.deepEqual(result.results.map(r=>[r.id,r.ok]),[['a',true],['b',false]]);
  assert.equal(state.workSessions[0].status,'active');
  await assert.rejects(performAction({type:'bulk_session_state',workSessionId:'w',state:'stopped'},{...c,autonomous:true}),/direct user/);
  state.messages.push({from:'a',to:'conductor',text:'Tests are still failing.'});
  const wrapped=await performAction({type:'work_session_state',target:'w',state:'wrapped'},c);
  assert.match(wrapped.session.summary,/Tests are still failing/);assert.match(wrapped.session.summary,/not rerun tests/);assert.match(wrapped.session.summary,/unknown/);
});
