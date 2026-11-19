import test from 'node:test';
import assert from 'node:assert/strict';
import {persistRemoteIndex,restoreRemoteIndexes} from '../server/remote-index.mjs';
import {validateState} from '../server/state-schema.mjs';

test('remote index survives a serialized restart as stale metadata without transcripts or live rows',()=>{
  const state={sessions:[],hosts:[]};persistRemoteIndex(state,'fixture-host',[{id:'remote:fixture',host:'fixture-host',sessionId:'fixture',provider:'codex',cwd:'/fixture',title:'Example',text:'Never retain this body',agentToken:'Never retain credential',completion:{key:'not-live'},messages:['private']}],123);
  validateState(state);assert.doesNotMatch(JSON.stringify(state),/Never retain|private|completion/);
  const cache=restoreRemoteIndexes(JSON.parse(JSON.stringify(state)),['fixture-host']);const restored=cache.get('fixture-host');assert.equal(restored.history[0].sourceStale,true);assert.deepEqual(restored.sessions,[]);assert.deepEqual(restored.processes,[]);assert.equal(restored.healthy,false);assert.equal(restored.indexedAt,0);
  assert.equal(restoreRemoteIndexes(state,[]).size,0,'disabled destinations are not restored');
});
