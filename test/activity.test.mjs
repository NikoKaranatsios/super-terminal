import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityMonitor, completion } from '../server/activity.mjs';
import { watchActivity } from '../desktop/notifications.cjs';
const at=new Date().toISOString();

test('only explicit successful turn completion triggers, never commentary or tool output',()=>{
  assert.equal(completion('codex',[{type:'response_item',timestamp:at,payload:{type:'message',role:'assistant',phase:'commentary'}}]),null);
  assert.equal(completion('claude',[{type:'assistant',timestamp:at,message:{stop_reason:'tool_use'}}]),null);
  assert.equal(completion('grok',[{type:'turn_ended',ts:at,outcome:'cancelled'}]),null);
  assert.equal(completion('codex',[{type:'event_msg',timestamp:at,payload:{type:'task_complete',turn_id:'one'}}]).key,'one');
  assert.equal(completion('claude',[{type:'assistant',timestamp:at,uuid:'two',message:{stop_reason:'end_turn'}}]).key,'two');
  assert.equal(completion('grok',[{type:'turn_ended',ts:at,outcome:'completed'}]).at,at);
});
test('old history and each SSH baseline are silent; new completions notify once',()=>{
  const store={state:{},save(){}};const m=new ActivityMonitor(store);m.started=Date.parse(at)-100;
  const row={id:'remote:codex:1',host:'remote',provider:'codex',title:'Task',completion:{key:'old',at}};
  m.histories('remote',[row]);assert.equal(store.state.activity.length,0);
  m.histories('remote',[{...row,completion:{key:'new',at}}]);m.histories('remote',[{...row,completion:{key:'new',at}}]);
  assert.equal(store.state.activity.length,1);assert.equal(store.state.activity[0].target,row.id);
  m.histories('other',[{...row,id:'other:codex:1'}]);assert.equal(store.state.activity.length,1);
});
test('appended local log completions are detected without modifying provider files',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'st-completion-')),file=path.join(dir,'session.jsonl');
  try {
    fs.writeFileSync(file,'');const store={state:{},save(){}};const m=new ActivityMonitor(store),row={id:'c:1',host:'local',provider:'codex',file};
    m.histories('local',[row]);
    const line=JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'task_complete',turn_id:'turn-1'}})+'\n';fs.appendFileSync(file,line);
    m.histories('local',[row]);m.histories('local',[row]);assert.equal(store.state.activity.length,1);assert.equal(fs.readFileSync(file,'utf8'),line);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('SSH loss is not exit, paused agents remain live, actual exits alert once',()=>{
  const store={state:{},save(){}};const m=new ActivityMonitor(store),s={id:'a',host:'server',provider:'claude',status:'running'};
  m.processes('server',[s]);m.processes('server',[],false);m.processes('server',[s]);assert.equal(store.state.activity.length,0);
  m.processes('server',[{...s,status:'paused'}]);assert.equal(store.state.activity.length,0);
  m.processes('server',[]);m.processes('server',[]);assert.equal(store.state.activity.length,1);assert.equal(store.state.activity[0].kind,'exited');
  m.processes('server',[s]);m.processes('server',[]);assert.equal(store.state.activity.length,2);
  m.processes('server',[{...s,startedAt:at}]);m.processes('server',[{...s,startedAt:new Date(Date.parse(at)+400).toISOString()}]);assert.equal(store.state.activity.length,2);
});
test('native watcher skips historical events, deduplicates and honors notification preference',async()=>{
  let events=[{id:'old'}],enabled=true;const delivered=[];
  const watcher=watchActivity({origin:'http://127.0.0.1',interval:100000,deliver:e=>delivered.push(e.id),fetcher:async url=>url.endsWith('/')?{text:async()=>'<meta name="super-terminal-token" content="test">'}:{ok:true,json:async()=>({events,enabled})}});
  await new Promise(r=>setImmediate(r));
  events.push({id:'raw-completion',kind:'finished'});await watcher.poll();assert.deepEqual(delivered,[]);
  events.push({id:'new',kind:'conductor',notify:true});await watcher.poll();await watcher.poll();assert.deepEqual(delivered,['new']);
  enabled=false;events.push({id:'muted'});await watcher.poll();enabled=true;await watcher.poll();assert.deepEqual(delivered,['new']);
  watcher.stop();
});
test('Conductor notification choices persist and duplicate choices do not repeat',()=>{
  const store={state:{},save(){}};const monitor=new ActivityMonitor(store);
  const choice={title:'Review needed',text:'A test failed.',target:'conductor'};
  assert.equal(monitor.notify(choice).notify,true);
  assert.equal(monitor.notify(choice).duplicate,true);
  assert.equal(store.state.activity.length,1);
  assert.throws(()=>monitor.notify({...choice,text:''}));
});
