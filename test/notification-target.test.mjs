import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {notificationTarget} from '../src/notification-target.mjs';
import {deliverNotification} from '../desktop/notification-delivery.cjs';
test('notification routing prefers live work, authoritative saved output or Activity, never a dangling terminal',()=>{
  const state={sessions:[{id:'live',status:'running'},{id:'ended',status:'stopped',historyId:'saved'}],history:[{id:'saved'}],tasks:[{id:'task'}]};
  assert.equal(notificationTarget(state,{target:'conductor'}).id,'conductor');
  assert.equal(notificationTarget(state,{target:'live'}).id,'live');
  assert.equal(notificationTarget(state,{target:'ended'}).id,'saved');
  assert.equal(notificationTarget(state,{target:'missing',historyId:'saved'}).id,'saved');
  assert.equal(notificationTarget(state,{target:'task:task'}).id,'task:task');
  assert.equal(notificationTarget(state,{target:'missing'}).unavailable,true);
  assert.equal(notificationTarget(state,{target:'task:missing'}).id,'activity');
});
test('native delivery distinguishes show, failure, unsupported and unconfirmed submission',async()=>{
  let behavior='show';
  class Notification extends EventEmitter {static isSupported(){return behavior!=='unsupported';}show(){if(behavior==='show')this.emit('show');else if(behavior==='failed')this.emit('failed',{},'Denied');}}
  for(const [mode,status] of [['show','shown'],['failed','failed'],['unsupported','unavailable'],['silent','submitted']]){behavior=mode;const result=await deliverNotification({Notification,options:{},timeoutMs:5});assert.equal(result.status,status);assert.ok(result.message);}
});
