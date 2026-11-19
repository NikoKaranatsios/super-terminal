import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateProjectRecord, consolidateProjectRecord } from '../server/project-records.mjs';
import { classifyProjects } from '../server/project-classification.mjs';
import { sidebarInventory } from '../src/sidebar-model.mjs';
import { projectWork, agentTitle } from '../src/work-views.mjs';

test('path reconciliation and empty-project consolidation preserve old histories and block automatic duplicates',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'st-reconciliation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const current=path.join(root,'current'),documents=path.join(root,'documents'),old=path.join(root,'old');
  for(const dir of [current,documents]){fs.mkdirSync(path.join(dir,'.git','objects'),{recursive:true});fs.writeFileSync(path.join(dir,'.git','HEAD'),'ref: refs/heads/main\n');}
  const state={projects:[{id:'p',name:'App',host:'local',cwd:current},{id:'old',name:'app',host:'local',cwd:old}],sessions:[],tasks:[],teams:[],workSessions:[],assignments:{}};
  updateProjectRecord(state,'old',{cwd:documents});consolidateProjectRecord(state,'old','p');
  const rows=[old,documents,current].map((cwd,i)=>({id:'h'+i,kind:'history',provider:'codex',host:'local',cwd}));
  const classified=classifyProjects(state,{history:rows},{discover:true});
  assert.deepEqual(classified.history.map(r=>r.projectId),['p','p','p']);assert.equal(classified.createdProjects.length,0);assert.equal(projectWork(state).length,1);
  assert.ok(fs.existsSync(path.join(documents,'.git')));assert.equal(state.projects[1].cwd,documents);assert.equal(state.projects[1].historyRoots[0].cwd,old);
  assert.deepEqual(consolidateProjectRecord(state,'old','p').target.id,'p');
});
test('consolidation never silently transfers an agent, task, team or working-session topic',()=>{
  for(const extra of [{sessions:[{projectId:'q'}]},{tasks:[{projectId:'q'}]},{teams:[{projectId:'q'}]},{workSessions:[{projects:[{canonicalProjectId:'q'}]}]}]){
    const state={projects:[{id:'p',host:'local'},{id:'q',host:'local'}],...extra},before=structuredClone(state);
    assert.throws(()=>consolidateProjectRecord(state,'q','p'),/Reconcile/);assert.deepEqual(state,before);
  }
});
test('sidebar separates shells and services and titles never reduce to terminal device names',()=>{
  const state={projects:[{id:'p',name:'Example'}],tasks:[{projectId:'p',status:'doing'}],history:[],sessions:[
    {id:'a',host:'local',projectId:'p',provider:'claude',title:'claude · ttys001',status:'external',kind:'external'},
    {id:'shell',host:'local',provider:'shell',title:'zsh · ttys002',status:'external'},
    {id:'service',host:'local',provider:'codex',runtime:true,title:'codex · ??',status:'external'}]};
  const result=sidebarInventory(state,'local');assert.equal(result.groups[0].agents.length,1);assert.equal(result.groups[0].tasks.length,1);assert.equal(result.shells.length,1);assert.equal(result.services.length,1);
  assert.equal(agentTitle(state.sessions[0],state),'claude · Example');assert.equal(agentTitle(state.sessions[2],state),'codex service');
  assert.equal(sidebarInventory(state,'local','example').shells.length,0);assert.equal(sidebarInventory(state,'local','example').groups.length,1);
});
