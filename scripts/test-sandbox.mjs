import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SandboxRuntime,execute} from '../server/sandbox-runtime.mjs';
import {sandboxPolicy} from '../server/sandbox-policy.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'st-sandbox-test-')),repo=path.join(directory,'repo');fs.mkdirSync(repo);
const state={sessions:[],teams:[],lifecycle:{}},store={state,save(){fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(state),{mode:0o600});}};
const root=fileURLToPath(new URL('..',import.meta.url)),checks=[];
let runtime=new SandboxRuntime({store,dataDir:directory,root,call:async(session,payload)=>({agentId:session.id,command:payload.command,private:'only-this-agent'})});
const team={id:randomUUID(),host:'local',projectId:'fixture',cwd:repo,runtime:sandboxPolicy({network:'restricted',domains:['example.com'],maxAgents:2,maxLaunches:3}),runtimeRevision:1};state.teams.push(team);
const session=()=>({id:randomUUID(),kind:'managed',provider:'shell',host:'local',projectId:'fixture',teamId:team.id,cwd:repo,assignmentRevision:0,attemptId:randomUUID(),agentToken:randomUUID(),title:'Synthetic sandbox check'});
const first=session(),second=session();
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
  await execute('git',['init',repo]);fs.writeFileSync(path.join(repo,'example.txt'),'committed source\n');
  for(const args of [['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Synthetic source']])await execute('git',['-C',repo,...args]);
  fs.writeFileSync(path.join(repo,'example.txt'),'uncommitted host work\n');
  await check('Container launch and committed source isolation',async()=>{await runtime.launch(first,team,'Synthetic verification shell.');assert.equal((await runtime.docker('local',['exec',first.execution.container,'cat','example.txt'])).trim(),'committed source');assert.equal(fs.readFileSync(path.join(repo,'example.txt'),'utf8'),'uncommitted host work\n');});
  await check('Non-root user, read-only system and volume-only mounts',async()=>{assert.equal((await runtime.docker('local',['exec',first.execution.container,'id','-u'])).trim(),'1000');await assert.rejects(runtime.docker('local',['exec',first.execution.container,'touch','/opt/st/host-write']));const row=await runtime.inspectOwned('local','container',first.execution.container);assert.equal(row.HostConfig.ReadonlyRootfs,true);assert.ok(row.Mounts.every(m=>m.Type==='volume'&&m.Destination==='/workspace'));assert.ok(row.HostConfig.CapDrop.includes('ALL'));});
  await check('Direct external network denied',async()=>{const result=await runtime.docker('local',['exec',first.execution.container,'node','-e',"const net=require('net');const s=net.connect(443,'1.1.1.1',()=>process.exit(1));s.setTimeout(1200,()=>process.exit(0));s.on('error',()=>process.exit(0));"]);assert.equal(result,'');});
  await check('Restricted gateway permits allowed sites and denies others',async()=>{const result=await runtime.docker('local',['exec',first.execution.container,'curl','--fail','--silent','--max-time','20','https://example.com']);assert.match(result,/Example Domain/);await assert.rejects(runtime.docker('local',['exec',first.execution.container,'curl','--fail','--silent','--max-time','5','https://example.org']));await assert.rejects(runtime.docker('local',['exec',first.execution.container,'curl','--fail','--silent','--max-time','5','--proxy','http://gateway:8080','http://169.254.169.254/']));});
  await check('Scoped bridge without a mounted host credential',async()=>{const raw=await runtime.docker('local',['exec',first.execution.container,'python3','/opt/st/bridge.py','context'],{timeout:20000});assert.equal(JSON.parse(raw).agentId,first.id);const config=JSON.parse(await runtime.docker('local',['exec',first.execution.container,'cat','/workspace/bridge/config.json']));assert.equal(config.token,undefined);});
  await check('Browser runs in runtime and reaches its local preview',async()=>{await runtime.docker('local',['exec','-d',first.execution.container,'node','-e',"require('http').createServer((q,r)=>r.end('<title>Isolated preview</title><h1>Sandbox preview</h1><button>Review</button>')).listen(3000,'0.0.0.0')"]);const page=await runtime.browser(first,{action:'open',url:'http://127.0.0.1:3000'});assert.equal(page.title,'Isolated preview');const image=await runtime.browser(first,{action:'screenshot'});assert.ok(Buffer.from(image.image,'base64').length>1000);});
  await check('Separate agent workspaces and homes',async()=>{await runtime.launch(second,team,'Independent synthetic shell.');await runtime.docker('local',['exec',first.execution.container,'sh','-c','printf private > /workspace/home/first-only']);await assert.rejects(runtime.docker('local',['exec',second.execution.container,'cat','/workspace/home/first-only']));assert.notEqual(first.execution.volume,second.execution.volume);});
  await check('Agent limits survive controller restart',async()=>{await assert.rejects(runtime.launch(session(),team,'Over capacity'),/concurrent/);runtime.close();runtime=new SandboxRuntime({store,dataDir:directory,root,call:async(s,p)=>({agentId:s.id,command:p.command})});const inventory=await runtime.snapshots();assert.equal(inventory.get(first.id).status,'running');assert.equal(JSON.parse(await runtime.docker('local',['exec',first.execution.container,'python3','/opt/st/bridge.py','context'])).agentId,first.id);});
  await check('Pause and resume control only the intended runtime',async()=>{assert.equal((await runtime.control(first,'paused')).ok,true);assert.equal((await runtime.inspectOwned('local','container',first.execution.container)).State.Paused,true);assert.equal((await runtime.inspectOwned('local','container',second.execution.container)).State.Paused,false);assert.equal((await runtime.control(first,'running')).ok,true);});
  await check('Export retains uncommitted work and does not modify the agent index',async()=>{await runtime.docker('local',['exec',first.execution.container,'sh','-c','printf changed > example.txt; printf new > added.txt']);const before=await runtime.docker('local',['exec',first.execution.container,'git','status','--porcelain']);const patch=await runtime.exportChanges(first);assert.match(patch,/added.txt/);assert.match(patch,/changed/);assert.equal(await runtime.docker('local',['exec',first.execution.container,'git','status','--porcelain']),before);});
  await check('Explicit stop retains recoverable workspace',async()=>{assert.equal((await runtime.control(first,'stopped')).ok,true);assert.equal(first.agentToken,undefined);await runtime.inspectOwned('local','volume',first.execution.volume);assert.match(await runtime.exportChanges(first),/added.txt/);});
  console.log(JSON.stringify({status:'passed',checks:checks.length}));
}finally{
  runtime.close();
  for(const type of ['container','network','volume']){
    const args=type==='container'?['ps','-aq']:type==='network'?['network','ls','-q']:['volume','ls','-q'];
    const owned=(await runtime.docker('local',[...args,'--filter',`label=super-terminal.owner=${runtime.owner}`]).catch(()=>'' )).trim().split('\n').filter(Boolean);
    for(const id of owned)try{await runtime.inspectOwned('local',type,id);await runtime.docker('local',[type,'rm',...(type==='container'?['--force']:[]),id]);}catch(error){console.error('Test-owned cleanup: '+error.message);}
  }
  fs.rmSync(directory,{recursive:true,force:true});
}
