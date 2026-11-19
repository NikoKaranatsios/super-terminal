import test from 'node:test';
import assert from 'node:assert/strict';
import {reconnectRemote} from '../server/remote-reconnect.mjs';
const session={id:'fixture-reconnect',kind:'managed',host:'fixture-host',tmuxName:'fixture-owned',remoteUser:'fixture-owner',agentToken:'fixture-token'};
test('remote reconnect verifies existing work and replaces only its lost transport without launching a provider',async()=>{
  const calls=[];const result=await reconnectRemote(session,{hosts:['fixture-host'],root:'/fixture',port:1234,runner:async(bin,args)=>{calls.push([bin,...args]);return{stdout:'100 1 zsh'};},mux:async args=>{calls.push(args);return {stdout:args[0]==='display-message'?'zsh\t100':''};},bridge:async()=>({sshArgs:['-R','127.0.0.1:34567:127.0.0.1:1234']})});
  assert.equal(result.ok,true);assert.match(calls[0].at(-1),/has-session/);assert.equal(calls.at(-1)[0],'respawn-pane');assert.match(calls.at(-1).at(-1),/attach-session/);assert.doesNotMatch(calls.at(-1).at(-1),/codex|claude|grok|tmux new-session/);
});
test('remote reconnect restores an absent local transport but refuses an uninspectable existing wrapper',async()=>{
  const calls=[];const options={hosts:['fixture-host'],root:'/fixture',port:1234,runner:async()=>({stdout:''}),bridge:async()=>({sshArgs:[]}),mux:async args=>{calls.push(args);if(args[0]==='display-message')throw Error("can't find session");return {stdout:''};}};
  assert.equal((await reconnectRemote(session,options)).ok,true);assert.equal(calls.at(-1)[0],'new-session');
  await assert.rejects(reconnectRemote(session,{...options,mux:async()=>({stdout:'zsh\t100'})}),/Cannot inspect/);
});
test('remote absence, revoked enrollment and healthy SSH never launch another provider or tunnel',async()=>{
  await assert.rejects(reconnectRemote({...session,enrollmentRevokedAt:'revoked'},{hosts:['fixture-host']}),/enrollment ended/);
  let bridges=0;await assert.rejects(reconnectRemote(session,{hosts:['fixture-host'],runner:async()=>{throw new Error('Missing remote session');},bridge:async()=>bridges++}),/Missing remote session/);assert.equal(bridges,0);
  const result=await reconnectRemote(session,{hosts:['fixture-host'],runner:async()=>({}),mux:async()=>({stdout:'ssh'}),bridge:async()=>bridges++});assert.match(result.result,/still connected/);assert.equal(bridges,0);
});
