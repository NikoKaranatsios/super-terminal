import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import backend from '../desktop/backend.cjs';
import supervisor from '../desktop/service-owner.cjs';
import identity from '../shared/build-identity.cjs';

test('service build identity includes remote helpers, action schemas and model instructions',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'st-build-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'fixture',dependencies:{}}));fs.mkdirSync(path.join(root,'server'));
  for(const name of ['bridge.py','conductor-schema.json','coordinator-instructions.md']){
    const before=identity.buildIdentity(root);fs.writeFileSync(path.join(root,'server',name),'changed runtime');assert.notEqual(identity.buildIdentity(root),before,name+' changes must forbid stale service reuse');
  }
  fs.mkdirSync(path.join(root,'runtime'));
  for(const name of ['Dockerfile','seccomp.json','runner.mjs']){const before=identity.buildIdentity(root);fs.writeFileSync(path.join(root,'runtime',name),'changed runtime');assert.notEqual(identity.buildIdentity(root),before,name+' must invalidate service reuse');}
});

test('backend reuse requires exact build, protocol and data identity and never takes ownership',async()=>{
  let health={product:'super-terminal',protocol:2,buildId:'fixture-build',dataKey:createHash('sha256').update(path.resolve('/fixture-data')).digest('hex')};
  const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(health));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await backend.probeBackend(origin,'/fixture-data','fixture-build')).buildId,'fixture-build');
    for(const patch of [{buildId:'older-build'},{protocol:1},{dataKey:'another-directory'},{product:'another-service'}]){
      const previous=health;health={...health,...patch};await assert.rejects(()=>backend.probeBackend(origin,'/fixture-data','fixture-build'),/another service or an older/);health=previous;
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('owned crash recovery reconnects, caps repeated crashes, and shutdown never stops reused services',async()=>{
  const starts=[],stops=[];let recovered=0,failures=0;
  const owner=supervisor.superviseBackend({},{maxRestarts:2,start:async options=>{starts.push(options);return{origin:'http://fixture',owned:true,stop:async()=>stops.push(starts.length)};},onRecovered:()=>recovered++,onFailure:()=>failures++});
  await owner.start();await owner.recover();assert.equal(recovered,1);assert.equal(starts.length,2);
  await owner.recover();await owner.recover();assert.equal(starts.length,3);assert.equal(failures,1);
  await owner.stop();assert.deepEqual(stops,[3]);await owner.recover();assert.equal(starts.length,3);
  const reused=supervisor.superviseBackend({},{start:async()=>({owned:false,origin:'http://fixture',stop:async()=>{}}),onRecovered:()=>assert.fail('cannot recover unowned service')});
  await reused.start();await reused.recover();assert.equal(reused.owned,false);await reused.stop();
});
test('quitting during owned recovery shuts down the replacement after it becomes ready',async()=>{
  let release,starts=0,stops=0;
  const owner=supervisor.superviseBackend({},{start:async()=>{if(++starts===2)await new Promise(resolve=>release=resolve);return{owned:true,origin:'http://fixture',stop:async()=>stops++};}});
  await owner.start();const recovering=owner.recover(),stopping=owner.stop();release();await Promise.all([recovering,stopping]);assert.equal(stops,2);
});
