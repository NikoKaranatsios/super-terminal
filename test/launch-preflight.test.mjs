import test from 'node:test';
import assert from 'node:assert/strict';
import {launchPreflight,launchState} from '../server/launch-preflight.mjs';
import {rollbackLaunch} from '../server/lifecycle.mjs';

test('launch preflight checks dependencies and selected account before creating resources',async()=>{
  const session={provider:'codex',host:'local',cwd:'/fixture'};
  await assert.rejects(launchPreflight(session,{find:()=>null,directory:()=>{}}),/tmux is required/);
  await assert.rejects(launchPreflight(session,{find:name=>name==='codex'?null:'/fixture/'+name,directory:()=>{}}),/codex is not installed/);
  await assert.rejects(launchPreflight(session,{find:()=>'/fixture',directory:()=>{throw new Error('Missing folder');}}),/Missing folder/);
  let command;await launchPreflight({...session,host:'fixture-host',remoteUser:'fixture-owner'},{find:()=>'/fixture',runner:async(bin,args)=>{command=args.at(-1);return{};}});
  assert.match(command,/sudo -n -u 'fixture-owner'/);assert.match(command,/python3/);assert.match(command,/tmux/);
});
test('transport, CLI and recovery shell are distinguished without claiming task acceptance',()=>{
  const session={host:'local',provider:'codex',createdAt:new Date(0).toISOString()};
  assert.equal(launchState(session,{command:'codex'}),'cli-running');assert.equal(launchState(session,{command:'zsh'}),'recovery-shell');assert.equal(launchState(session,{command:'node'}),'transport-ready');assert.equal(launchState(session,{command:'codex',sourceStale:true}),'unknown');
});
test('failed launch rollback revokes credentials, preserves partial records, and never touches provider files',async()=>{
  const session={id:'fixture-agent',kind:'managed',host:'local',tmuxName:'fixture-owned',status:'running',agentToken:'fixture-token'};
  const store={state:{sessions:[],tasks:[]},save(){}};const calls=[];
  const context={store,tmuxRun:async args=>{calls.push(args);if(args[0]==='kill-session')throw new Error('Fixture failed cleanup');},removeBridge:async target=>calls.push(['credentials',target.id])};
  const result=await rollbackLaunch(session,context);assert.equal(result.partial,true);assert.equal(session.agentToken,undefined);assert.equal(store.state.sessions[0].status,'unknown');assert.deepEqual(calls.at(-1),['credentials','fixture-agent']);
});
