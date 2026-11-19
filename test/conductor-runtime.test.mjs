import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Coordinator } from '../server/coordinator.mjs';
import { conductorCommand, conductorDirectory, conductorFailure, disabledMcpArgs, readCodexCatalog, validateConductorSettings } from '../server/conductor-runtime.mjs';

const history={all:async()=>[]};
const reply={answer:'Fixture completed.',memory:'',assessments:[],actions:[]};
test('session settings persist independently, validate atomically, and need no working session',async()=>{
  const store={state:{workSessions:[{id:'a',status:'active',projects:[]},{id:'b',status:'paused',projects:[]}]},save(){}};
  const c=new Coordinator(store,{modelRunner:async()=>reply});
  c.updateSettings({model:'fixture-global',access:'workspace'});
  c.updateSettings({model:'fixture-a',reasoningEffort:'high',skills:false},'a');
  c.updateSettings({model:'fixture-b',access:'read-only'},'b');
  assert.throws(()=>c.updateSettings({model:'invalid model',access:'full'},'b'),/valid model/);
  assert.throws(()=>c.updateSettings({model:'fixture-missing'},'missing'),/not found/);
  assert.throws(()=>validateConductorSettings({skills:'true'}),/enabled or disabled/);
  assert.throws(()=>validateConductorSettings({access:'invalid'}),/file access/);
  assert.throws(()=>validateConductorSettings({reasoningEffort:'invalid'}),/reasoning/);
  assert.throws(()=>validateConductorSettings({arbitrary:true}),/Unknown/);
  const reloaded=new Coordinator({state:JSON.parse(JSON.stringify(store.state)),save(){}},{modelRunner:async()=>reply});
  assert.equal(reloaded.settings('a').model,'fixture-a');assert.equal(reloaded.settings('b').access,'read-only');
  const direct=await reloaded.ask('Write the requested file','',[],history);
  assert.equal(direct.status,'complete');assert.equal(direct.runtime.model,'fixture-global');assert.equal(direct.runtime.access,'workspace');
  const scoped=await reloaded.ask('Review','',[],history,'',false,'local',{settingsSessionId:'b'});
  assert.equal(scoped.runtime.model,'fixture-b');assert.equal(scoped.runtime.workSessionId,'b');
});

test('model and capabilities stay fixed for every round, and changes apply to the next message',async()=>{
  let calls=0;const captured=[];
  const store={state:{workSessions:[{id:'session',status:'active',projects:[]}]},save(){}};
  const c=new Coordinator(store,{catalogReader:async()=>({defaultModel:'fixture-native',defaultReasoningEffort:'high'}),modelRunner:async(input,{runtime})=>{
    captured.push({...runtime});assert.deepEqual(input.runtime,runtime);
    if(++calls===1){c.updateSettings({model:'fixture-next',access:'read-only'},'session');return {...reply,actions:[{type:'notify',text:'Fixture'}]};}
    return reply;
  }}).configure({liveReader:async()=>[],actionHandler:async()=>({ok:true})});
  const first=await c.ask('Work','',[],history,'session');
  assert.equal(first.status,'complete');assert.equal(captured.length,2);
  for(const runtime of captured){assert.equal(runtime.model,'fixture-native');assert.equal(runtime.access,'full');assert.equal(runtime.skills,true);}
  const second=await c.ask('Review','',[],history,'session');
  assert.equal(second.runtime.model,'fixture-next');assert.equal(second.runtime.access,'read-only');
  const background=await c.ask('Continue','',[],history,'session',false,'local',{autonomous:true});
  assert.equal(background.runtime.model,'fixture-next');assert.equal(background.runtime.skills,false);assert.equal(background.runtime.access,'read-only');
});

test('manual CLI keeps native config and skills, while background rounds retain restricted execution',()=>{
  const runtime={mode:'manual',model:'fixture-model',reasoningEffort:'high',access:'full',skills:true,cwd:'/fixture'};
  const command=conductorCommand(runtime,'/output.json');
  assert.equal(command.cwd,'/fixture');assert.equal(command.args[command.args.indexOf('--sandbox')+1],'danger-full-access');
  assert.equal(command.args[command.args.indexOf('-m')+1],'fixture-model');
  assert.ok(command.args.includes('approval_policy="never"'));assert.ok(command.args.some(a=>a.startsWith('developer_instructions=')));
  assert.ok(!command.args.includes('--ignore-user-config'));assert.ok(!command.args.includes('--ignore-rules'));
  const isolated=conductorCommand(runtime,'/output.json','[mcp_servers.penpot]\nurl = "https://example.test/mcp"\n');
  assert.ok(isolated.args.includes('mcp_servers.penpot.enabled=false'));
  assert.deepEqual(disabledMcpArgs('[mcp_servers.node_repl]\n[mcp_servers.node_repl.env]\n'),['-c','mcp_servers.node_repl.enabled=false']);
  assert.match(conductorFailure('ERROR rmcp::transport::worker: Transport channel closed'),/configured MCP server failed/);
  assert.equal(conductorFailure('ordinary failure'),'ordinary failure');
  const pairs=args=>args.flatMap((v,i)=>['--enable','--disable'].includes(v)?[`${v}:${args[i+1]}`]:[]);
  assert.ok(pairs(command.args).includes('--disable:skip_host_skill_discovery'));
  assert.ok(!pairs(command.args).includes('--disable:plugins'));assert.ok(pairs(command.args).includes('--enable:unified_exec'));
  const workspace=conductorCommand({...runtime,access:'workspace',skills:false},'/output.json').args;
  assert.equal(workspace[workspace.indexOf('--sandbox')+1],'workspace-write');assert.ok(pairs(workspace).includes('--enable:skip_host_skill_discovery'));
  for(const mode of ['autonomous','briefing']){
    const args=conductorCommand({...runtime,mode},'/output.json').args;
    assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.ok(args.includes('--ignore-user-config'));
    assert.ok(pairs(args).includes('--disable:unified_exec'));assert.ok(pairs(args).includes('--disable:plugins'));
  }
  const state={projects:[{id:'local',host:'local',cwd:'/local-project'},{id:'remote',host:'remote',cwd:'/remote-project'}]};
  assert.equal(conductorDirectory(state,{projectIds:['local']},'/fallback'),'/local-project');
  assert.equal(conductorDirectory(state,{projectIds:['remote']},'/fallback'),'/fallback');
});

test('catalog uses provider discovery without model turns or leaking private configuration',async()=>{
  const methods=[];let killed=false;
  const spawnProcess=(_bin,args)=>{
    assert.deepEqual(args,['app-server']);
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{killed=true;};
    child.stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n')){
      const request=JSON.parse(line);methods.push(request.method);if(!request.id)continue;
      const result=request.method==='config/read'?{config:{model:'fixture-native',model_reasoning_effort:'high',secret:'must not return'}}:request.method==='model/list'?{data:[{model:'fixture-native',displayName:'Fixture',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]}:request.method==='skills/list'?{data:[{skills:[{enabled:true,name:'fixture-review',path:'/fixture/SKILL.md',description:'Review fixture'},{enabled:false,name:'disabled',path:'/disabled'}],errors:[]}]}:{};
      queueMicrotask(()=>child.stdout.write(JSON.stringify({id:request.id,result})+'\n'));
    }});return child;
  };
  const catalog=await readCodexCatalog('/fixture',{spawnProcess,bin:'fixture'});
  assert.equal(catalog.defaultModel,'fixture-native');assert.equal(catalog.skills.length,1);assert.deepEqual(catalog.models[0].efforts,['high']);
  assert.ok(!JSON.stringify(catalog).includes('must not return'));assert.ok(killed);
  assert.deepEqual(methods,['initialize','initialized','config/read','model/list','skills/list']);
});
