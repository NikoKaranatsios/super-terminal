import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { platformCall, localUrl, validateConfig } from '../server/mcp-client.mjs';
import { collectWork } from '../server/coordinator.mjs';
import { validateAutonomousAction } from '../server/conductor-policy.mjs';
import { enrollmentPresence } from '../server/agent-identity.mjs';
import { controlAgent } from '../server/lifecycle.mjs';
import { agentCapabilities } from '../src/agent-view.mjs';
import { canControl, processLabel } from '../src/work-views.mjs';
import { createStore } from '../server/core.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const closed=child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(r=>child.once('close',r));

test('local MCP enrollment, workflows, durable delivery, scoped graph and revocation', {timeout:90000}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'st-mcp-'));
  const p=path.join(dir,'project'),q=path.join(dir,'other');fs.mkdirSync(p);fs.mkdirSync(q);
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({sessions:[],hosts:[],projects:[{id:'p',name:'Fixture',host:'local',cwd:p,status:'active'},{id:'q',name:'Other',host:'local',cwd:q,status:'active'}]}));
  const listener=http.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const base=`http://127.0.0.1:${port}`,clients=[];
  let child,auth,logs='';
  const start=async()=>{
    child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),SUPER_TERMINAL_DATA:dir,SUPER_TERMINAL_TEST:'1',SUPER_TERMINAL_SOCKET:'st-mcp-'+path.basename(dir),CODEX_HOME:path.join(dir,'codex'),CLAUDE_CONFIG_DIR:path.join(dir,'claude'),GROK_HOME:path.join(dir,'grok')},stdio:['ignore','ignore','pipe']});
    child.stderr.on('data',d=>logs+=d);
    for(let i=0;i<100;i++){try{const page=await (await fetch(base,{signal:AbortSignal.timeout(1000)})).text();auth=page.match(/name="super-terminal-token" content="([^"]+)"/)?.[1];if(auth)return;}catch{}await delay(50);}
    throw new Error('Fixture service did not start: '+logs);
  };
  const stop=async()=>{child.kill('SIGTERM');await closed(child);};
  const owner=async(route,method='GET',body,expected=200)=>{
    const response=await fetch(base+'/api'+route,{method,headers:{'x-super-terminal':auth,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
  };
  const enroll=(name,extra={})=>owner('/enrollments','POST',{projectId:'p',provider:'codex',name,clientKey:name,...extra});
  const connect=async config=>{
    const client=new Client({name:'fixture',version:'1.0.0'});
    const transport=new StdioClientTransport({command:process.execPath,args:['server/mcp.mjs'],env:{...process.env,SUPER_TERMINAL_AGENT_CONFIG:config},stderr:'pipe'});
    let errors='';transport.stderr?.on('data',d=>errors+=d);
    clients.push(client);await client.connect(transport);return client;
  };
  const call=async(client,name,args={},expectError=false)=>{
    const response=await client.callTool({name,arguments:args});assert.equal(!!response.isError,expectError,JSON.stringify(response));return JSON.parse(response.content.find(c=>c.type==='text').text);
  };
  t.after(async()=>{await Promise.allSettled(clients.map(c=>c.close()));if(child&&child.exitCode===null&&child.signalCode===null)await stop();fs.rmSync(dir,{recursive:true,force:true});});
  await start();
  let a,b,outsider,client,task;
  await t.test('owner explicitly enrolls once with private credentials and no process adoption',async()=>{
    a=await enroll('first');b=await enroll('second');outsider=await enroll('foreign',{projectId:'q'});
    assert.equal(a.agent.kind,'enrolled');assert.equal(a.agent.agentToken,undefined);assert.equal(a.agent.enrollmentKey,undefined);
    assert.equal((await enroll('first')).agent.id,a.agent.id);
    assert.equal(fs.statSync(a.configPath).mode&0o777,0o600);
    await owner('/enrollments','POST',{projectId:'p',name:'different',clientKey:'first'},400);
    await owner('/enrollments','POST',{projectId:'p',name:'remote',clientKey:'remote',host:'elsewhere'},400);
    await owner('/enrollments','POST',{projectId:'p',name:'escape',clientKey:'escape',cwd:q},400);
    const credential=JSON.parse(fs.readFileSync(a.configPath));
    assert.equal((await fetch(base+'/api/enrollments',{headers:{'x-super-terminal-agent':credential.token}})).status,403);
    await owner('/sessions/'+a.agent.id+'/control','POST',{state:'stopped'},400);
    const inventory=(await owner('/state')).sessions.find(s=>s.id===a.agent.id);
    assert.equal(inventory.processState,'unknown');assert.equal(inventory.freshness,'never');assert.equal(inventory.capabilities.mailbox,true);assert.equal(inventory.capabilities.terminalInput,false);
    assert.equal(inventory.historyId,null);
  });
  await t.test('real stdio handshake lists tools, prompts and resources without model calls',async()=>{
    client=await connect(a.configPath);
    const tools=(await client.listTools()).tools;assert.equal(tools.length,16);assert.ok(tools.some(t=>t.name==='st_request_helper'));
    await call(client,'st_request_helper',{requestId:'not-authorized',role:'Reviewer',task:'Inspect the fixture'},true);
    assert.deepEqual((await client.listPrompts()).prompts.map(p=>p.name).sort(),['st-blocker','st-checkpoint','st-handoff','st-start']);
    const prompt=await client.getPrompt({name:'st-start'});assert.match(prompt.messages[0].content.text,/st_context/);
    const resource=await client.readResource({uri:'st://workflows'});assert.match(resource.contents[0].text,/st-handoff/);
    const context=await call(client,'st_context');assert.equal(context.projectId,'p');
    const conductor=await call(client,'st_conductor');assert.equal(conductor.id,'coordinator');assert.equal(conductor.replying,false);assert.deepEqual(conductor.messages,[]);assert.equal(conductor.history,undefined);
    const telemetry=(await owner('/state')).background.mcp;
    assert.equal(telemetry.state,'available');assert.equal(telemetry.clients.find(row=>row.agentId===a.agent.id).command,'conductor');
    assert.equal(telemetry.clients.find(row=>row.agentId===a.agent.id).transport,'mcp');assert.equal(telemetry.clients.find(row=>row.agentId===a.agent.id).active,0);
    assert.ok(!JSON.stringify(telemetry).includes(JSON.parse(fs.readFileSync(a.configPath)).token));
    assert.equal((await call(client,'st_heartbeat')).processState,'unknown');
    assert.equal((await call(client,'st_peers')).peers.length,0,'Same project does not grant peer communication');
  });
  await t.test('durable task creation and structured reports preserve ownership and evidence',async()=>{
    const created=await call(client,'st_create_task',{title:'Synthetic acceptance',clientKey:'task-1'});task=created.task;
    assert.equal((await call(client,'st_create_task',{title:'Synthetic acceptance',clientKey:'task-1'})).task.id,task.id);
    await call(client,'st_report',{taskId:task.id,eventId:'no-evidence',status:'done',summary:'Finished',expectedRevision:task.revision},true);
    const reported=await call(client,'st_report',{taskId:task.id,eventId:'blocked-1',status:'blocked',summary:'Waiting on fixture',blocker:'Fixture input missing',nextStep:'Provide fixture input',expectedRevision:task.revision});
    task=reported.task;
    const tasks=await call(client,'st_tasks');assert.equal(tasks.tasks[0].lastReport.blocker,'Fixture input missing');
    const graph=await call(client,'st_graph');assert.ok(graph.edges.some(e=>e.from===a.agent.id&&e.to===task.id&&e.type==='assigned'));assert.ok(!JSON.stringify(graph).includes(outsider.agent.id));
    const done=await call(client,'st_report',{taskId:task.id,eventId:'done-1',status:'done',summary:'Fixture passed',evidence:['Synthetic acceptance verified'],expectedRevision:task.revision,nextStep:'No remaining work'});task=done.task;
    assert.equal(task.status,'done');
    const persisted=createStore(dir).state;
    assert.equal(persisted.tasks.find(t=>t.id===task.id).evidence[0].kind,'reported');
    const data=collectWork(persisted,persisted.sessions);
    assert.ok(data.scope.agentIds.includes(a.agent.id));assert.ok(data.observations.some(o=>o.kind==='task_report'&&o.verification==='actor_reported'));
    assert.equal(validateAutonomousAction(persisted,{type:'message_agent',target:a.agent.id},data.scope),true);
    assert.throws(()=>validateAutonomousAction(persisted,{type:'session_state',target:a.agent.id,state:'stopped'},data.scope));
  });
  await t.test('explicit team permits messaging; unacknowledged reads survive and acks do not complete tasks',async()=>{
    await call(client,'st_send',{to:b.agent.id,message:'Denied without team',eventId:'denied'},true);
    await call(client,'st_discard',{eventId:'denied'});
    const team=await owner('/teams','POST',{name:'Fixture team',mission:'Verify scoped coordination',projectId:'p',cwd:p,host:'local'});
    await owner('/sessions/'+a.agent.id,'PATCH',{teamId:team.id});await owner('/sessions/'+b.agent.id,'PATCH',{teamId:team.id});
    await call(client,'st_context');
    assert.deepEqual((await call(client,'st_peers')).peers.map(p=>p.id),[b.agent.id]);
    const sent=await call(client,'st_send',{to:b.agent.id,message:'Verified handoff',eventId:'message-1'});
    const again=await call(client,'st_send',{to:b.agent.id,message:'Verified handoff',eventId:'message-1'});assert.equal(sent.id,again.id);
    const inbox=await platformCall(b.configPath,{command:'inbox',includeUnacknowledged:true});assert.ok(inbox.messages.some(m=>m.id===sent.id));
    assert.ok((await platformCall(b.configPath,{command:'inbox',includeUnacknowledged:true})).messages.some(m=>m.id===sent.id));
    const ack=await platformCall(b.configPath,{command:'ack',messageId:sent.id});assert.equal(ack.delivery,'acknowledged');
    assert.equal((await platformCall(b.configPath,{command:'ack',messageId:sent.id})).delivery,'acknowledged');
    assert.ok(!(await platformCall(b.configPath,{command:'inbox',includeUnacknowledged:true})).messages.some(m=>m.id===sent.id));
    await call(client,'st_send',{to:outsider.agent.id,message:'Forbidden cross-project',eventId:'foreign'},true);await call(client,'st_discard',{eventId:'foreign'});
  });
  await t.test('offline operations survive adapter and service restarts with exact retry identities',async()=>{
    await stop();
    const pending=await call(client,'st_send',{to:'coordinator',message:'Offline handoff',eventId:'offline-1'},true);assert.equal(pending.queued,true);
    await client.close();client=await connect(a.configPath);
    assert.equal((await call(client,'st_pending')).pending.length,1);
    await start();const flush=await call(client,'st_flush');assert.equal(flush.pending,0);assert.equal(flush.flushed,1);
    assert.equal((await call(client,'st_send',{to:'coordinator',message:'Offline handoff',eventId:'offline-1'})).duplicate,true);
    assert.equal((await owner('/messages')).filter(m=>m.eventId==='offline-1').length,1);
    // Lost acknowledgment after server commit: replay the persisted payload directly.
    const journal=JSON.parse(fs.readFileSync(a.configPath.replace('.json','.outbox.json'))),payload=journal.receipts.find(r=>r.payload.eventId==='offline-1').payload;
    const config=JSON.parse(fs.readFileSync(a.configPath));
    const response=await fetch(base+'/api/agent',{method:'POST',headers:{'x-super-terminal-agent':config.token,'content-type':'application/json'},body:JSON.stringify(payload)});
    assert.equal((await response.json()).duplicate,true);
  });
  await t.test('assignment changes reject old queued events; revocation persists without process control',async()=>{
    await stop();await call(client,'st_send',{to:'coordinator',message:'Old assignment',eventId:'old-assignment'},true);await start();
    await owner('/sessions/'+a.agent.id,'PATCH',{group:'Renamed grouping',teamId:a.agent.teamId});
    // Leaving a team suspends the prior conversation's platform context.
    await call(client,'st_context',{},true);await call(client,'st_flush',{},true);
    assert.equal((await call(client,'st_pending')).pending[0].eventId,'old-assignment');
    const config=JSON.parse(fs.readFileSync(a.configPath));
    const revoked=await owner('/enrollments/'+a.agent.id,'DELETE');assert.equal(revoked.processControlled,false);assert.equal(revoked.processState,'unknown');assert.equal(fs.existsSync(a.configPath),false);
    await owner('/enrollments/'+a.agent.id,'DELETE');
    await stop();await start();
    const response=await fetch(base+'/api/agent',{method:'POST',headers:{'x-super-terminal-agent':config.token,'content-type':'application/json'},body:'{"command":"context"}'});assert.equal(response.status,403);
    assert.equal((await owner('/enrollments')).agents.find(s=>s.id===a.agent.id).enrollment,'revoked');
  });
});

test('contact freshness, local-only transport, and enrolled UI never imply process ownership',async()=>{
  for(const url of ['https://127.0.0.1:4317','http://example.com','http://127.0.0.1:4317/path','http://user@localhost:4317'])assert.throws(()=>localUrl(url));
  assert.equal(localUrl('http://127.0.0.1:4317'),'http://127.0.0.1:4317');
  const agent={id:'fixture',kind:'enrolled',status:'external',lastContactAt:new Date(1000).toISOString()};
  assert.equal(enrollmentPresence(agent,1000).freshness,'recent');assert.equal(enrollmentPresence(agent,123000).freshness,'stale');
  assert.equal(enrollmentPresence(agent).processState,'unknown');assert.equal(canControl(agent),false);assert.equal(agentCapabilities(agent).mailbox,true);assert.match(processLabel(agent),/process unknown/);
  await assert.rejects(controlAgent(agent,'stopped',{store:{state:{},save(){throw new Error('Must not write');}}}),/does not control/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'st-mcp-config-'));try{const file=path.join(dir,'credential.json');fs.writeFileSync(file,'{}',{mode:0o644});assert.throws(()=>validateConfig(file),/private/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
