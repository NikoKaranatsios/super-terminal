import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/core.mjs';
import { migrateState,diagnostics } from '../server/state-schema.mjs';

function storedFiles(root) {
  return Object.fromEntries(fs.readdirSync(root,{recursive:true}).sort().filter(file=>fs.statSync(path.join(root,file)).isFile()).map(file=>[file,fs.readFileSync(path.join(root,file),'utf8')]));
}

test('a legacy store recreated after migration cannot silently hide newer conversations',t=>{
  for(const contents of [JSON.stringify({sessions:[],hosts:[],conductor:{turns:[{id:'recent',prompt:'New request',answer:'New response'}]}}),'unreadable legacy state']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-conflict-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({sessions:[],hosts:[],teams:[{id:'saved-team',name:'Saved team',roster:[{role:'Core',provider:'codex',task:'Fixture task'}]}]}));
    createStore(dir);
    assert.equal(createStore(dir).state.teams[0].roster[0].role,'Core','ordinary migration and reopen retain the saved roster');
    fs.writeFileSync(path.join(dir,'state.json'),contents);
    const before=storedFiles(dir);
    assert.throws(()=>createStore(dir),error=>{
      assert.match(error.message,/legacy state.*Markdown workspace/i);
      assert.match(error.message,/reconcile/i);
      assert.match(error.message,/left untouched/);
      assert.doesNotMatch(error.message,/New request|New response|unreadable legacy state/);
      return true;
    });
    assert.deepEqual(storedFiles(dir),before,'both stores and the migration backup remain byte-for-byte intact');
  }
});

test('workspace saves refuse legacy state that appears after opening',t=>{
  for(const initial of ['unsaved','saved','migrated']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-conflict-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    if(initial==='migrated')fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({sessions:[],hosts:[]}));
    const store=createStore(dir);
    if(initial==='saved')store.save();
    store.state.projects=[{id:'new-project',name:'Pending project'}];
    fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({sessions:[],hosts:[],conductor:{turns:[{id:'recent',prompt:'Retain this conversation'}]}}));
    const before=storedFiles(dir);
    assert.throws(()=>store.save(),/legacy state.*Markdown workspace/i);
    assert.deepEqual(storedFiles(dir),before,`${initial} store must not write before resolving the conflict`);
  }
});

test('legacy migration is repeat-safe and preserves histories, extension fields and references',()=>{
  const legacy={sessions:[{id:'agent',scope:{workSessionId:'work',projectId:'project'}}],hosts:[],workSessions:[{id:'work',projects:[{id:'project',goals:[{id:'goal',notes:'Keep handoff'}]}]}],conductor:{turns:[{prompt:'Private prompt',answer:'Private answer'}]},extension:{preserved:true}};
  const next=migrateState(legacy);assert.deepEqual(migrateState(next),next);assert.deepEqual({...next,stateVersion:undefined},{...legacy,stateVersion:undefined});assert.equal(legacy.stateVersion,undefined);
});
test('minimal legacy state without a projects array migrates and reopens without losing the conversation',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-legacy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source={sessions:[],hosts:[],conductor:{turns:[{id:'fixture',prompt:'Keep this request',answer:'Retain this answer'}]}};
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(source));
  createStore(dir);
  const reopened=createStore(dir);assert.deepEqual(reopened.state.projects,[]);assert.equal(reopened.state.conductor.turns[0].prompt,'Keep this request');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'state.migrated.json'))),source);
});
test('malformed nested data and future versions fail specifically without overwriting files',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-state-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const patch of [{workSessions:[{projects:'broken'}]},{conductor:{turns:[{trace:{}}]}},{preferences:{fontSize:'big'}},{stateVersion:99}]){
    const source=JSON.stringify({sessions:[],hosts:[],...patch});fs.writeFileSync(path.join(dir,'state.json'),source);
    assert.throws(()=>createStore(dir),/original file was left untouched/);assert.equal(fs.readFileSync(path.join(dir,'state.json'),'utf8'),source);
  }
});
test('invalid saves and failed replacement leave the previous state and recovery data intact',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-state-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const original=createStore(dir);original.save();const runtime=path.join(dir,'runtime','runtime.json');const before=fs.readFileSync(runtime,'utf8');
  original.state.messages={};assert.throws(()=>original.save(),/state.messages must be an array/);assert.equal(fs.readFileSync(runtime,'utf8'),before);
  const io=new Proxy(fs,{get(target,key){return key==='renameSync'?()=>{throw new Error('Fixture replacement failed');}:target[key];}});
  const store=createStore(dir,{io});store.state.sessions.push({id:'new',agentToken:'secret-token'});assert.throws(()=>store.save(),/Pending file:/);
  assert.equal(fs.readFileSync(runtime,'utf8'),before);
  const pending=fs.readdirSync(dir).find(file=>file.startsWith('.pending-'));
  const staged=fs.readdirSync(path.join(dir,pending)).map(name=>fs.readFileSync(path.join(dir,pending,name),'utf8'));
  assert.ok(staged.some(body=>body.includes('"id": "new"')));
  assert.equal(staged.filter(body=>body.includes('secret-token')).every(body=>body.trim().startsWith('{')), true);
  const markdown=fs.readdirSync(dir,{recursive:true}).filter(file=>String(file).endsWith('.md')).map(file=>fs.readFileSync(path.join(dir,file),'utf8')).join('\n');
  assert.doesNotMatch(markdown,/secret-token/);
});
test('diagnostics expose counts and categories, excluding credentials, paths and conversation bodies',()=>{
  const state={stateVersion:1,sessions:[{id:'private-id',token:'private-token',cwd:'/private/path'}],messages:[{text:'private-body'}],conductor:{turns:[{prompt:'private-prompt'}],loop:{state:'paused'}}};
  const result=diagnostics(state,{version:'fixture',protocol:2,resources:{terminalAttachments:2,secret:'private-secret'},sources:[{kind:'remote',host:'private-host',error:'private-error',healthy:false,stale:true}]});
  assert.doesNotMatch(JSON.stringify(result),/private-/);assert.equal(result.counts.sessions,1);assert.equal(result.sources[0].stale,true);
});
