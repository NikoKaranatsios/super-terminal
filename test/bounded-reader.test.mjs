import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BoundedReader,IsolatedHistory} from '../server/bounded-reader.mjs';
import {scanTmux,externalTerminals} from '../server/discovery.mjs';

test('a stalled synchronous reader times out while the parent stays responsive and the next worker recovers',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-reader-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'fixture.mjs');fs.writeFileSync(file,"process.on('message',m=>{if(m.operation==='stall')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);else process.send({id:m.id,result:'ready'});});");
  const reader=new BoundedReader({file,timeout:300});t.after(()=>reader.close());
  let responsive=false;setTimeout(()=>responsive=true,25);
  await assert.rejects(reader.call('stall'),/timed out/);assert.equal(responsive,true);
  assert.equal(await reader.call('healthy'),'ready');
});
test('failed index keeps cached metadata explicitly stale and transcript errors remain visible',async()=>{
  let fail=false;const local=new IsolatedHistory({call:async()=>{if(fail)throw new Error('Fixture unavailable');return {rows:[{id:'fixture',title:'Saved metadata'}],warnings:[]};}});
  await local.all(true);fail=true;const rows=await local.all(true);assert.equal(rows[0].sourceStale,true);assert.deepEqual(local.warnings,['Fixture unavailable']);await assert.rejects(local.transcript('fixture'),/unavailable/);
});
test('tmux healthy empty results differ from permission/transport failure; process-list errors are not healthy empty scans',async()=>{
  assert.equal((await scanTmux('fixture',async()=>({stdout:''}))).healthy,true);
  assert.equal((await scanTmux('fixture',async()=>{throw Object.assign(new Error('No server'),{stderr:'no server running on fixture'});})).healthy,true);
  const failed=await scanTmux('fixture',async()=>{throw Object.assign(new Error('Access denied'),{stderr:'permission denied'});});assert.equal(failed.healthy,false);assert.match(failed.warnings[0],/Access denied/);
  await assert.rejects(externalTerminals([],{strict:true,runner:async()=>{throw new Error('Fixture ps failure');}}),/Fixture ps failure/);
});
