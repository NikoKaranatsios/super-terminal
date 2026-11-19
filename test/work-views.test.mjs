import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWork, agentTitle, agentContext, canControl, mergeOutput, overviewMarkup, taskMarkup, teamsMarkup, statusLabel } from '../src/work-views.mjs';

const fixture = () => ({
  projects:[{id:'project',name:'Example project',host:'local',cwd:'/example'}],
  workSessions:[{id:'work',title:'Example work',status:'paused',projects:[{id:'legacy-project',canonicalProjectId:'project',name:'Example project',goals:[{id:'task',title:'Legacy title',status:'todo'}]}]}],
  tasks:[{id:'task',projectId:'project',title:'Check the output',status:'doing',scope:{workSessionId:'work',projectId:'legacy-project',goalId:'task'},evidence:[]}],
  sessions:[],history:[],teams:[]
});

test('canonical tasks take precedence over legacy goals and session pause never changes task progress',()=>{
  const state=fixture(), projects=projectWork(state,'work');
  assert.equal(projects.length,1);assert.equal(projects[0].tasks.length,1);
  assert.equal(projects[0].tasks[0].title,'Check the output');assert.equal(projects[0].tasks[0].status,'doing');
  assert.equal(projectWork(state,'other').length,0);
  state.tasks=[];assert.equal(projectWork(state)[0].tasks.length,0);
  delete state.tasks;assert.equal(projectWork(state)[0].tasks[0].title,'Legacy title');
});
test('task and agent identities stay separate from process and history state',()=>{
  const state=fixture(), agent={id:'agent',kind:'managed',status:'running',provider:'codex',scope:{goalId:'task'},title:'codex · Untitled'};
  assert.equal(agentTitle(agent,state),'Check the output');assert.equal(canControl(agent),true);
  assert.equal(canControl({...agent,connectionLost:true}),false);
  assert.equal(canControl({...agent,runtime:true}),false);
  assert.equal(canControl({...agent,kind:'external'}),false);
  assert.equal(statusLabel({status:'exited'}),'Unknown');
});
test('work markup escapes task data and passes canonical project scope to chat',()=>{
  const state=fixture();state.tasks[0].title='<img src=x onerror=alert(1)>';state.tasks[0].evidence=['<script>unsafe</script>'];
  const overview=overviewMarkup(state), detail=taskMarkup(state,'task');
  assert.ok(!overview.includes('<img'));assert.ok(overview.includes('&lt;img'));
  assert.ok(!detail.includes('<script>'));assert.ok(detail.includes('&lt;script&gt;'));
  assert.ok(detail.includes('&quot;projectId&quot;:&quot;project&quot;'));
  assert.ok(!detail.includes('&quot;projectId&quot;:&quot;legacy-project&quot;'));
});
test('output pages preserve repeated legitimate output, stable order, earlier pages and refreshed tails',()=>{
  const a={id:'codex:10:0',text:'repeat'},b={id:'codex:20:0',text:'repeat'},c={id:'codex:20:1',text:'tool'},d={id:'codex:30:0',text:'latest'};
  assert.deepEqual(mergeOutput([b,c],[a],true),[a,b,c]);
  assert.deepEqual(mergeOutput([a,b,c],[b,c,d]),[a,b,c,d]);
  assert.deepEqual(mergeOutput([a,b,c],[{...c,text:'updated'}]),[a,b,{...c,text:'updated'}]);
  const old=[{text:'first'},{text:'second'}];
  assert.deepEqual(mergeOutput(old,[{text:'second'},{text:'third'}]),[...old,{text:'third'}]);
  assert.deepEqual(mergeOutput(old,[{text:'older'}],true),[{text:'older'},...old]);
});
test('team discussions send canonical project identity while retaining working-session context',()=>{
  const state=fixture();state.teams=[{id:'team',name:'Example team',projectId:'project',scope:{workSessionId:'work',projectId:'legacy-project',goalId:'task'}}];
  const markup=teamsMarkup(state);
  assert.ok(markup.includes('&quot;projectId&quot;:&quot;project&quot;'));
  assert.ok(markup.includes('&quot;workSessionId&quot;:&quot;work&quot;'));
  assert.ok(!markup.includes('&quot;projectId&quot;:&quot;legacy-project&quot;'));
  assert.ok(!markup.includes('&quot;goalId&quot;'));
});
test('team names and group labels do not imply explicit team membership',()=>{
  const state=fixture();state.teams=[{id:'team',name:'Example team'}];
  const labelOnly={id:'label',title:'Same label only',group:'Example team',provider:'codex',status:'running'},member={id:'member',title:'Explicit member',teamId:'team',provider:'codex',status:'running'};
  state.sessions=[labelOnly,member];
  assert.ok(!agentContext(labelOnly,state).includes('Example team'));
  assert.ok(agentContext(member,state).includes('Example team'));
  const markup=teamsMarkup(state);assert.ok(markup.includes('Explicit member'));assert.ok(!markup.includes('Same label only'));
});
