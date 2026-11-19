import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {observedModel} from '../server/model-identity.mjs';
import {History,matchHistory} from '../server/history.mjs';
import {liveSessionRows,sessionsMarkup} from '../src/sessions-view.mjs';

test('model labels use provider identity, follow switches and ignore user/tool claims',()=>{
  assert.deepEqual(observedModel('codex',[{type:'turn_context',payload:{model:'model-one'},timestamp:'first'},{type:'response_item',payload:{role:'user',model:'invented'}},{type:'turn_context',payload:{model:'model-two'},timestamp:'second'}]),{model:'model-two',modelSource:'provider-output',modelObservedAt:'second'});
  assert.equal(observedModel('claude',[{type:'assistant',message:{model:'claude-fixture[1m]'}},{type:'assistant',message:{model:'<synthetic>'}},{type:'user',message:{model:'fake'}}]).model,'claude-fixture[1m]');
  assert.equal(observedModel('grok',[{role:'assistant',model_id:'grok-fixture'}]).model,'grok-fixture');
  assert.deepEqual(observedModel('codex',[null,42,{type:'session_meta',payload:{model_provider:'openai'}}]),{});
  assert.equal(matchHistory({provider:'codex',host:'local',cwd:'/example'},[{id:'other',provider:'codex',host:'local',cwd:'/example',model:'wrong'}]),null);
});

test('cached model metadata refreshes on file changes and disappears when unreadable',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'st-model-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'history.jsonl'),h=new History(),row={provider:'codex',file};
  fs.writeFileSync(file,JSON.stringify({type:'turn_context',payload:{model:'model-first'}})+'\n');assert.equal(h.model(row).model,'model-first');
  fs.appendFileSync(file,JSON.stringify({type:'turn_context',payload:{model:'model-second'}})+'\n');assert.equal(h.model(row).model,'model-second');
  fs.unlinkSync(file);assert.deepEqual(h.model(row),{});
});

test('remote metadata uses the same model evidence and supports old and current Codex indexes',()=>{
  const result=execFileSync('python3',['-c',`import ast, json, tempfile, pathlib, sqlite3
source=pathlib.Path('server/remote-reader.py').read_text(); tree=ast.parse(source)
scope={'repository_cache':{}}; exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef))],type_ignores=[]),'reader','exec'),scope)
assert scope['observed_model']('grok',[{'role':'assistant','model_id':'grok-fixture'}])['model']=='grok-fixture'
assert scope['observed_model']('claude',[{'type':'assistant','message':{'model':'<synthetic>'}}])=={}
for has_model in [False,True]:
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d); (root/'.codex').mkdir(); db=sqlite3.connect(root/'.codex/state_1.sqlite')
  db.execute('CREATE TABLE threads (id, cwd, title, updated_at, rollout_path, created_at, archived'+(', model' if has_model else '')+')')
  values=['id',d,'Fixture',1,None,1,0]+(['index-model'] if has_model else [])
  db.execute('INSERT INTO threads VALUES ('+','.join('?' for v in values)+')',values);db.commit();db.close()
  rows=scope['index'](d); assert len(rows)==1
  assert rows[0].get('model')==('index-model' if has_model else None)
print('ok')`],{encoding:'utf8'});assert.match(result,/ok/);
});

test('sessions inventory covers all environments, keeps uncertainty visible and hides historical processes',()=>{
  const state={projects:[{id:'p',name:'Project'}],tasks:[],history:[],sessions:[
    {id:'live',projectId:'p',kind:'tmux',host:'local',status:'running',provider:'codex',model:'model-one',title:'Work'},
    {id:'remote',projectId:'p',kind:'remote',host:'remote',status:'unknown',provider:'codex',title:'Check'},
    {id:'external',kind:'external',host:'local',status:'external',provider:'claude',title:'Outside'},
    {id:'service',runtime:true,kind:'external',host:'local',status:'external'},
    {id:'stopped',kind:'managed',host:'local',status:'stopped'}]};
  assert.equal(liveSessionRows(state).length,3);assert.equal(liveSessionRows(state,'local','model-one')[0].session.id,'live');
  assert.equal(liveSessionRows(state).find(r=>r.session.id==='remote').state,'Unverified');assert.equal(liveSessionRows(state).find(r=>r.session.id==='external').access,'View only');
  assert.match(sessionsMarkup(state),/2 live · 1 interactive · 1 unverified/);
});
