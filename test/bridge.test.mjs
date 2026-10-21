import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);

async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-helper-'));
  let unavailable=false,revision=0;const requests=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);requests.push(body);
    assert.equal(req.headers['x-super-terminal-agent'],'fixture-token');
    res.setHeader('Content-Type','application/json');
    if(unavailable){res.writeHead(503);return res.end('{"error":"unavailable"}');}
    if(body.command==='context')return res.end(JSON.stringify({agentId:'agent',attemptId:'attempt',assignmentRevision:revision,taskId:'task'}));
    if(body.command==='tasks')return res.end('{"tasks":[]}');
    if(body.assignmentRevision!==revision){res.writeHead(400);return res.end('{"error":"assignment changed"}');}
    res.end(JSON.stringify({task:{id:'task',title:'Synthetic task',status:body.status||'todo',revision:1},event:{id:body.eventId},duplicate:false}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const configPath=path.join(dir,'agent.json');
  fs.writeFileSync(configPath,JSON.stringify({id:'agent',token:'fixture-token',url:`http://127.0.0.1:${server.address().port}`,hostHeader:`127.0.0.1:${server.address().port}`,attemptId:'attempt',assignmentRevision:0,taskId:'task'}),{mode:0o600});
  const run=async(...args)=>{
    try {const r=await exec('python3',['server/bridge.py',...args],{env:{...process.env,SUPER_TERMINAL_AGENT_CONFIG:configPath}});return {code:0,value:JSON.parse(r.stdout),stderr:r.stderr};}
    catch(error){return {code:error.code,stderr:error.stderr,value:error.stdout?JSON.parse(error.stdout):null};}
  };
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  return {run,requests,configPath,journal:()=>JSON.parse(fs.readFileSync(path.join(dir,'agent.outbox.json'),'utf8')),unavailable:value=>{unavailable=value;},revision:value=>{revision=value;}};
}
test('helper durably retries exact task events, sequences, identity and stable client keys',async t=>{
  const f=await fixture(t);f.unavailable(true);
  const queued=await f.run('task','create','--title','Synthetic task','--client-key','stable');
  assert.equal(queued.code,1);assert.equal(JSON.parse(queued.stderr).queued,true);
  const pending=f.journal().pending[0].payload;
  assert.equal(pending.command,'task');assert.equal(pending.operation,'create');assert.equal(pending.sequence,1);assert.equal(pending.assignmentRevision,0);assert.equal(pending.attemptId,'attempt');
  assert.equal(fs.statSync(path.join(path.dirname(f.configPath),'agent.outbox.json')).mode&0o777,0o600);
  f.unavailable(false);const flushed=await f.run('task','flush');assert.equal(flushed.value.flushed,1);
  assert.deepEqual(f.requests[0],f.requests[1]);assert.equal(f.journal().pending.length,0);
  const duplicate=await f.run('task','create','--title','Synthetic task','--client-key','stable');assert.equal(duplicate.value.duplicate,true);assert.equal(f.requests.length,2);
  const conflict=await f.run('task','create','--title','Different','--client-key','stable');assert.equal(conflict.code,1);assert.match(conflict.stderr,/different content/);
  const report=await f.run('task','report','--status','done','--notes','Verified','--evidence','Synthetic checks passed');assert.equal(report.code,0);
  assert.equal(f.requests.at(-1).sequence,2);assert.equal(f.requests.at(-1).taskId,'task');assert.deepEqual(f.requests.at(-1).evidence,['Synthetic checks passed']);
});
test('context refresh never rebinds queued events to a new assignment, and obsolete events can be explicitly discarded',async t=>{
  const f=await fixture(t);f.unavailable(true);await f.run('report','--status','doing','--event-id','original');
  f.unavailable(false);f.revision(1);assert.equal((await f.run('context')).code,0);
  assert.equal(JSON.parse(fs.readFileSync(f.configPath,'utf8')).assignmentRevision,1);
  assert.equal((await f.run('task','flush')).code,1);assert.equal(f.requests.at(-1).assignmentRevision,0);assert.equal(f.journal().pending.length,1);
  const pending=await f.run('task','pending');assert.equal(pending.value.pending[0].eventId,'original');
  const discarded=await f.run('task','discard','--event-id','original');assert.equal(discarded.value.discarded,'original');
  assert.equal((await f.run('progress','--goal','task','--status','blocked','--notes','Needs input')).code,0);
  assert.equal(f.requests.at(-1).assignmentRevision,1);assert.equal(f.requests.at(-1).sequence,2);
  assert.deepEqual((await f.run('task','list')).value,{tasks:[]});
});
test('simultaneous report invocations retain unique monotonically increasing sequences',async t=>{
  const f=await fixture(t);
  const results=await Promise.all(Array.from({length:6},(_,i)=>f.run('report','--task','task','--status','doing','--event-id',`event-${i}`,'--notes',`step ${i}`)));
  assert.ok(results.every(r=>r.code===0));assert.deepEqual(f.requests.map(r=>r.sequence),[1,2,3,4,5,6]);assert.equal(f.journal().receipts.length,6);
});
