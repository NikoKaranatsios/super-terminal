import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { providerProcessArguments,claudeProcessSession } from '../server/provider-process.mjs';
const original='11111111-1111-1111-1111-111111111111',fork='22222222-2222-2222-2222-222222222222';
test('provider services are distinct from agents and fork IDs take precedence over resumed originals',()=>{
  assert.equal(providerProcessArguments('claude','claude daemon --origin cli','??').runtime,true);
  assert.equal(providerProcessArguments('claude','claude --bg-pty-host -- claude --resume '+original,'??').runtime,true);
  assert.equal(providerProcessArguments('claude','claude --fork-session --resume '+original+' --session-id='+fork,'ttys001').resumeId,fork);
  assert.equal(providerProcessArguments('claude','claude --fork-session --resume '+original,'ttys001').resumeId,null);
  assert.deepEqual(providerProcessArguments('claude','claude --resume '+original,'ttys001'),{runtime:false,resumeId:original});
  assert.equal(providerProcessArguments('codex','codex exec work','??').runtime,false);
});
test('Claude registry linkage requires exact PID, process start, directory and provider identity',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'st-provider-process-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'sessions'));
  const metadata={pid:42,pidDomain:'darwin',sessionId:original,cwd:'/fixture',procStart:'Tue Jan 06 08:30:00 2026',name:'Review fixture tests',nameSource:'auto'};
  const write=value=>fs.writeFileSync(path.join(root,'sessions','42.json'),JSON.stringify(value));write(metadata);
  const process={pid:42,cwd:'/fixture',startedAt:'2026-01-06T08:30:00.000Z'};
  assert.deepEqual(claudeProcessSession(process,root),{sessionId:original,title:'Review fixture tests'});
  for(const patch of [{pid:43},{pidDomain:'other'},{cwd:'/foreign'},{procStart:'Tue Jan 06 08:31:00 2026'},{sessionId:'bad'}]){write({...metadata,...patch});assert.equal(claudeProcessSession(process,root),null);}
  write({...metadata,nameSource:'derived'});assert.equal(claudeProcessSession(process,root).title,null);
});
