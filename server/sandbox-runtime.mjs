import {occupiesRuntimeSlot} from '../shared/runtime-state.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import readline from 'node:readline';
import {env,quote,validHost} from './core.mjs';
import {sandboxPolicy} from './sandbox-policy.mjs';

export function dockerCommand(host,args){return host==='local'?{bin:'docker',args}:{bin:'ssh',args:['-o','BatchMode=yes','-o','ConnectTimeout=8',validHost(host),['docker',...args].map(quote).join(' ')]};}
export function execute(bin,args,{input,timeout=45000,binary=false,maxBytes=8*1024*1024}={}){
  return new Promise((resolve,reject)=>{const child=spawn(bin,args,{env,stdio:['pipe','pipe','pipe']}),out=[],err=[];let size=0,problem;
    const timer=setTimeout(()=>{problem=new Error('Runtime command timed out; inspect its actual state before retrying.');child.kill('SIGKILL');},timeout);
    for(const [stream,items] of [[child.stdout,out],[child.stderr,err]])stream.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){problem=new Error('Runtime output exceeded its limit.');child.kill('SIGKILL');}else items.push(chunk);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.stdin.on('error',()=>{});
    child.on('close',code=>{clearTimeout(timer);const stdout=Buffer.concat(out),stderr=Buffer.concat(err).toString();if(problem)reject(problem);else if(code!==0)reject(new Error(stderr.trim().slice(-1800)||`Runtime command exited ${code}.`));else resolve(binary?stdout:stdout.toString());});child.stdin.end(input);
  });
}
export class SandboxRuntime {
  constructor({store,dataDir,root,allowedHosts=[],call,command=execute}={}){Object.assign(this,{store,dataDir,root,allowedHosts,call,command});this.owner=createHash('sha256').update(path.resolve(dataDir)).digest('hex').slice(0,16);this.brokers=new Map();this.networks=new Map();this.inventory=new Map();this.closed=false;}
  names(team,id){const key=createHash('sha256').update(team.id).digest('hex').slice(0,12),prefix=`st-${this.owner}-${key}`;return {network:prefix,proxy:prefix+'-egress',container:id?prefix+'-'+id.slice(0,12):null,volume:id?prefix+'-'+id.slice(0,12)+'-data':null};}
  async docker(host,args,options){if(host!=='local'&&!this.allowedHosts.includes(host))throw new Error('This SSH environment is not enabled.');const cmd=dockerCommand(host,args);return this.command(cmd.bin,cmd.args,options);}
  labels(team,session){return ['--label',`super-terminal.owner=${this.owner}`,'--label',`super-terminal.team=${team.id}`,...(session?['--label',`super-terminal.agent=${session.id}`]:[])];}
  async inspectOwned(host,type,name){const raw=await this.docker(host,[type,'inspect',name]);const row=JSON.parse(raw)[0];if((row.Config?.Labels||row.Labels)?.['super-terminal.owner']!==this.owner)throw new Error('Runtime ownership does not match. No resource was changed.');return row;}
  async capability(host='local',image='super-terminal-agent:1'){
    try{const raw=await this.docker(host,['info','--format','{{json .}}'],{timeout:10000}),info=JSON.parse(raw);let ready=true;
      try{await this.docker(host,['image','inspect',image],{timeout:10000});}catch{ready=false;}
      return {available:true,imageReady:ready,image,engines:Object.keys(info.Runtimes||{}),note:ready?'Container engine and runtime image are available.':'Build the runtime image before launching an isolated team.'};
    }catch(error){return {available:false,imageReady:false,image,error:error.message};}
  }
  async ensureNetwork(team,p){
    const key=team.host+':'+team.id;if(this.networks.has(key))return this.networks.get(key);
    const operation=(async()=>{const names=this.names(team),exists=await this.docker(team.host,['network','ls','--filter',`name=^${names.network}$`,'--format','{{.Name}}']);
      if(exists.trim()){const row=await this.inspectOwned(team.host,'network',names.network);if(!row.Internal)throw new Error('The team network is not isolated.');}
      else await this.docker(team.host,['network','create','--internal',...this.labels(team),names.network]);
      if(p.network==='restricted'){
        const found=await this.docker(team.host,['ps','-a','--filter',`name=^/${names.proxy}$`,'--format','{{.ID}}']);
        if(found.trim()){const row=await this.inspectOwned(team.host,'container',names.proxy);if((row.Config.Env.find(s=>s.startsWith('ST_ALLOWED_DOMAINS='))!==`ST_ALLOWED_DOMAINS=${JSON.stringify(p.domains)}`||row.Config.Image!==p.image))throw new Error('The retained gateway has a different network policy. Stop the team runtime before reconfiguring it.');if(!row.State.Running)await this.docker(team.host,['start',names.proxy]);}
        else {await this.docker(team.host,['create','--name',names.proxy,...this.labels(team),'--network',names.network,'--network-alias','gateway','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','192m','--cpus','.5','--env',`ST_ALLOWED_DOMAINS=${JSON.stringify(p.domains)}`,'--workdir','/opt/st','--entrypoint','node',p.image,'/opt/st/egress.mjs']);await this.docker(team.host,['network','connect','bridge',names.proxy]);await this.docker(team.host,['start',names.proxy]);}
      }
      team.runtimeServices={network:{name:names.network,state:'ready'},gateway:{name:names.proxy,state:p.network==='restricted'?'running':'offline'}};this.store.save();return names;
    })();this.networks.set(key,operation);try{return await operation;}catch(error){this.networks.delete(key);throw error;}
  }
  async launch(session,team,prompt,stopRevision=team.runtimeStopRevision||0){
    return this.locked('team:'+team.id,()=>{if(stopRevision!==(team.runtimeStopRevision||0))throw new Error('The team was stopped after this launch was requested. Start a fresh launch explicitly.');return this.locked(session.id,()=>this.launchUnlocked(session,team,prompt));});
  }
  async launchUnlocked(session,team,prompt){
    const p=sandboxPolicy(team.runtime),names=this.names(team,session.id);
    if(session.host!==team.host||session.projectId!==team.projectId)throw new Error('Sandbox location must match its explicit team project.');
    if(session.parentAgentId){const parent=this.store.state.sessions.find(s=>s.id===session.parentAgentId),receipt=team.delegations?.find(r=>r.id===session.delegationRequestId);if(!p.delegation||!parent||parent.enrollmentRevokedAt||parent.contextIsolation||parent.status!=='running'||parent.assignmentRevision!==receipt?.parentAssignmentRevision||parent.attemptId!==receipt?.parentAttemptId||parent.execution?.policyRevision!==team.runtimeRevision)throw new Error('Parent authority changed before launch.');}
    const active=this.store.state.sessions.filter(s=>s.teamId===team.id&&occupiesRuntimeSlot(s));
    if(active.length>=p.maxAgents)throw new Error('The team’s concurrent-agent allowance is exhausted.');
    if((team.runtimeLaunches||0)>=p.maxLaunches)throw new Error('The team’s launch allowance is exhausted.');
    // Reserve capacity durably before the first asynchronous operation. Failed
    // launches count, preventing retry loops from bypassing the launch allowance.
    team.runtimeLaunches=(team.runtimeLaunches||0)+1;
    session.execution={kind:'container',container:names.container,volume:names.volume,network:names.network,image:p.image,engine:p.engine,policyRevision:team.runtimeRevision,workspace:'/workspace/repo',state:'preparing',limits:{cpu:p.cpu,memoryMb:p.memoryMb,pids:p.pids},networkMode:p.network};
    session.status='unknown';session.launchState='starting';this.store.state.sessions.push(session);this.store.save();
    try{
      const ready=await this.capability(session.host,p.image);if(!ready.available||!ready.imageReady)throw new Error(ready.error||ready.note);
      if(p.engine==='runsc'&&!ready.engines.includes('runsc'))throw new Error('gVisor/runsc is not installed in this container engine. Choose Docker or configure runsc on that environment.');
      const provider=session.provider==='shell'?'bash':session.provider;
      if(!['bash','codex','claude','grok'].includes(provider))throw new Error('Unsupported runtime provider.');
      try{await this.docker(session.host,['run','--rm','--network','none','--user','1000:1000','--read-only','--cap-drop','ALL','--workdir','/opt/st','--entrypoint','sh',p.image,'-c',`command -v ${provider}`]);}catch{throw new Error(`${provider} is unavailable in this runtime image. Choose an image containing the provider CLI.`);}
      const sourceArgs=['-C',team.cwd,'bundle','create','-','HEAD'];
      const bundle=team.host==='local'?await this.command('git',sourceArgs,{binary:true,maxBytes:128*1024*1024}):await this.command('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=8',team.host,['git',...sourceArgs].map(quote).join(' ')],{binary:true,maxBytes:128*1024*1024});
      await this.ensureNetwork(team,p);
      await this.docker(session.host,['volume','create',...this.labels(team,session),names.volume]);
      await this.inspectOwned(session.host,'volume',names.volume);
      const mounts=['--mount',`type=volume,source=${names.volume},target=/workspace`];
      const prepare="const fs=require('fs'),cp=require('child_process');fs.mkdirSync('/workspace/home',{recursive:true});let chunks=[];process.stdin.on('data',d=>chunks.push(d)).on('end',()=>{fs.writeFileSync('/workspace/source.bundle',Buffer.concat(chunks));cp.execFileSync('git',['init','/workspace/repo']);cp.execFileSync('git',['-C','/workspace/repo','fetch','/workspace/source.bundle','HEAD']);cp.execFileSync('git',['-C','/workspace/repo','checkout','-b','agent','FETCH_HEAD']);cp.execFileSync('git',['-C','/workspace/repo','config','user.name','Super Terminal Agent']);cp.execFileSync('git',['-C','/workspace/repo','config','user.email','agent@localhost']);fs.rmSync('/workspace/source.bundle');process.stdout.write(cp.execFileSync('git',['-C','/workspace/repo','rev-parse','HEAD']));});";
      const base=await this.docker(session.host,['run','--rm','-i','--network','none','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,nodev,size=128m',...mounts,'--workdir','/workspace','--entrypoint','node',p.image,'-e',prepare],{input:bundle,timeout:120000,maxBytes:1024*1024});session.execution.baseCommit=base.trim();
      const config={id:session.id,transport:'stdio-spool',spool:'/workspace/bridge',assignmentRevision:session.assignmentRevision,attemptId:session.attemptId,taskId:session.taskId};
      const write="const fs=require('fs');let data='';process.stdin.on('data',d=>data+=d).on('end',()=>{const v=JSON.parse(data);fs.mkdirSync('/workspace/bridge',{recursive:true});fs.writeFileSync('/workspace/launch.json',JSON.stringify(v.launch),{mode:0o600});fs.writeFileSync('/workspace/bridge/config.json',JSON.stringify(v.config),{mode:0o600});});";
      await this.docker(session.host,['run','--rm','-i','--network','none','--user','1000:1000','--read-only','--cap-drop','ALL',...mounts,'--workdir','/workspace','--entrypoint','node',p.image,'-e',write],{input:JSON.stringify({launch:{provider:session.provider,prompt},config})});
      const args=['run','-d','--name',names.container,...this.labels(team,session),'--init','--network',names.network,'--network-alias',`${session.id.slice(0,12)}.st-team`,'--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--security-opt','seccomp=/dev/stdin','--pids-limit',String(p.pids),'--memory',`${p.memoryMb}m`,'--cpus',String(p.cpu),'--shm-size','256m','--tmpfs','/tmp:rw,nosuid,nodev,size=256m',...mounts];
      if(p.engine==='runsc')args.push('--runtime','runsc');
      if(p.network==='restricted')args.push('--env','HTTP_PROXY=http://gateway:8080','--env','HTTPS_PROXY=http://gateway:8080','--env','http_proxy=http://gateway:8080','--env','https_proxy=http://gateway:8080','--env','NO_PROXY=localhost,127.0.0.1,.st-team');
      this.checkLaunchAuthority(session,team);
      await this.docker(session.host,[...args,p.image],{input:fs.readFileSync(path.join(this.root,'runtime','seccomp.json'))});
      for(let attempt=0;attempt<30;attempt++){try{await this.docker(session.host,['exec',names.container,'tmux','has-session','-t','agent']);break;}catch(error){if(attempt===29)throw error;await new Promise(r=>setTimeout(r,200));}}
      this.checkLaunchAuthority(session,team);
      Object.assign(session.execution,{state:'running'});session.status='running';session.launchState='transport-ready';this.snapshotAt=0;this.store.save();this.connect(session);return session;
    }catch(error){session.execution.state='failed';session.execution.error=error.message;session.status='unknown';this.store.save();throw error;}
  }
  checkLaunchAuthority(session,team){
    if(session.teamId!==team.id||session.projectId!==team.projectId||session.contextIsolation||session.enrollmentRevokedAt||session.execution.policyRevision!==team.runtimeRevision)throw new Error('Runtime assignment changed during launch. Start a fresh agent.');
    if(session.parentAgentId){const parent=this.store.state.sessions.find(s=>s.id===session.parentAgentId),receipt=team.delegations?.find(r=>r.id===session.delegationRequestId);if(!parent||parent.enrollmentRevokedAt||parent.contextIsolation||parent.teamId!==team.id||parent.status!=='running'||parent.assignmentRevision!==receipt?.parentAssignmentRevision||parent.attemptId!==receipt?.parentAttemptId)throw new Error('Parent authority changed during launch.');}
  }
  async snapshots(){
    if(this.snapshotPending)return this.snapshotPending;
    if(Date.now()-(this.snapshotAt||0)<4000)return this.inventory;
    this.snapshotPending=this.readSnapshots();
    try{return await this.snapshotPending;}finally{this.snapshotPending=null;this.snapshotAt=Date.now();}
  }
  async readSnapshots(){
    const sessions=this.store.state.sessions.filter(s=>s.execution?.kind==='container'),hosts=[...new Set(sessions.map(s=>s.host))];
    await Promise.all(hosts.map(async host=>{
      try{const raw=await this.docker(host,['ps','-a','--filter',`label=super-terminal.owner=${this.owner}`,'--format','{{json .}}'],{timeout:10000}),rows=raw.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
        for(const team of this.store.state.teams.filter(t=>t.host===host&&t.runtimeServices?.gateway))team.runtimeServices.gateway.state=rows.find(r=>r.Names===team.runtimeServices.gateway.name)?.State||'stopped';
        for(const s of sessions.filter(s=>s.host===host)){const row=rows.find(r=>r.Names===s.execution.container),status=!row?'stopped':row.State==='running'?'running':row.State==='paused'?'paused':['exited','dead','created'].includes(row.State)?'stopped':'unknown';this.inventory.set(s.id,{status,execution:{...s.execution,state:row?.State||'missing',observedAt:new Date().toISOString()},launchState:s.launchState,provider:s.provider});if(status==='running'&&!s.enrollmentRevokedAt)this.connect(s);}
      }catch(error){for(const s of sessions.filter(s=>s.host===host))this.inventory.set(s.id,{status:'unknown',execution:{...s.execution,state:'unavailable',error:error.message}});}
    }));return this.inventory;
  }
  connect(session){
    if(this.closed||this.brokers.has(session.id)||!this.call)return;
    const cmd=dockerCommand(session.host,['exec','-i',session.execution.container,'node','/opt/st/broker.mjs']);const child=spawn(cmd.bin,cmd.args,{env,stdio:['pipe','pipe','pipe']});this.brokers.set(session.id,child);
    let bytes=0;child.stdout.on('data',data=>{bytes+=data.length;if(bytes>1024*1024){child.kill();}setTimeout(()=>{bytes=0;},1000).unref();});
    readline.createInterface({input:child.stdout}).on('line',async line=>{let request;try{request=JSON.parse(line);if(!/^[a-f0-9-]{36}$/.test(request.id)||!request.payload||typeof request.payload!=='object')throw new Error('Invalid scoped request.');const result=await this.call(session,request.payload);if(!child.stdin.destroyed)child.stdin.write(JSON.stringify({id:request.id,result})+'\n');}catch(error){if(request?.id&&!child.stdin.destroyed)child.stdin.write(JSON.stringify({id:request.id,result:{error:error.message}})+'\n');}});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',()=>{});child.on('close',()=>{if(this.brokers.get(session.id)===child)this.brokers.delete(session.id);});
  }
  async locked(id,operation){this.operations||=new Map();const previous=this.operations.get(id)||Promise.resolve(),current=previous.catch(()=>{}).then(operation);this.operations.set(id,current);try{return await current;}finally{if(this.operations.get(id)===current)this.operations.delete(id);}}
  async browser(session,input){return this.locked(session.id,async()=>{await this.inspectOwned(session.host,'container',session.execution.container);const raw=await this.docker(session.host,['exec','-i',session.execution.container,'node','/opt/st/browser-call.mjs'],{input:JSON.stringify(input),timeout:50000,maxBytes:4*1024*1024});return JSON.parse(raw);});}
  attachment(session){return dockerCommand(session.host,['exec','-it',session.execution.container,'tmux','attach-session','-t','agent']);}
  async control(session,desired){
    return this.locked(session.id,()=>this.controlUnlocked(session,desired));
  }
  async controlUnlocked(session,desired){
    const results=[];try{let row;try{row=await this.inspectOwned(session.host,'container',session.execution.container);}catch(error){if(!/No such (?:object|container)/i.test(error.message))throw error;if(desired!=='stopped')throw error;}
      if(row){if(desired==='paused'&&row.State.Running&&!row.State.Paused)await this.docker(session.host,['pause',session.execution.container]);
        if(desired==='running'){if(!row.State.Running)throw new Error('This runtime stopped. Its workspace remains available for export; start a fresh agent.');if(row.State.Paused)await this.docker(session.host,['unpause',session.execution.container]);}
        if(desired==='stopped'){if(row.State.Paused)await this.docker(session.host,['unpause',session.execution.container]);await this.docker(session.host,['stop','--time','5',session.execution.container]);await this.docker(session.host,['container','rm',session.execution.container]);}
      }
      results.push({resource:'container',status:'succeeded'});session.status=desired;session.execution.state=desired;
    }catch(error){results.push({resource:'container',status:'failed',error:error.message});if(desired==='stopped')session.status='unknown';}
    if(desired==='stopped'){this.brokers.get(session.id)?.kill();delete session.agentToken;session.enrollmentRevokedAt||=new Date().toISOString();}
    const ok=results.every(r=>r.status==='succeeded');this.snapshotAt=0;this.inventory.delete(session.id);this.store.state.lifecycle[session.id]=session.status;const outcome={id:session.id,requestedState:desired,state:session.status,ok,partial:!ok,results,result:ok?`Runtime ${desired}; workspace and browser profile retained.`:'Runtime control was not confirmed.'};session.lastControl={...outcome,at:new Date().toISOString()};this.store.save();return outcome;
  }
  async exportChanges(session){
    return this.locked(session.id,async()=>{
      let pausedHere=false;
      try{const row=await this.inspectOwned(session.host,'container',session.execution.container);if(row.State.Running&&!row.State.Paused){await this.docker(session.host,['pause',session.execution.container]);pausedHere=true;}}
      catch(error){if(!/No such (?:object|container)/i.test(error.message))throw error;}
      try{return await this.exportSnapshot(session);}finally{if(pausedHere)await this.docker(session.host,['unpause',session.execution.container]);this.snapshotAt=0;}
    });
  }
  async exportSnapshot(session){
    if(!/^[a-f0-9]{40,64}$/.test(session.execution.baseCommit||''))throw new Error('This runtime has no completed source snapshot to export.');
    await this.inspectOwned(session.host,'volume',session.execution.volume);
    // Include committed, staged, unstaged and untracked work without touching the
    // agent's real Git index. Output is a binary-safe patch from the original base.
    const script='mkdir -p /tmp/objects; export GIT_INDEX_FILE=/tmp/export-index GIT_OBJECT_DIRECTORY=/tmp/objects GIT_ALTERNATE_OBJECT_DIRECTORIES=/workspace/repo/.git/objects; git read-tree HEAD && git add -A && tree=$(git write-tree) && git diff --binary '+quote(session.execution.baseCommit)+' "$tree"';
    const raw=await this.docker(session.host,['run','--rm','--network','none','--user','1000:1000','--read-only','--cap-drop','ALL','--tmpfs','/tmp:rw,nosuid,nodev,size=128m','--mount',`type=volume,source=${session.execution.volume},target=/workspace,readonly`,'--entrypoint','sh',session.execution.image,'-c',script],{timeout:45000,maxBytes:32*1024*1024});return raw;
  }
  async controlTeam(team,desired){
    if(!team)throw new Error('Team not found.');
    return this.locked('team:'+team.id,()=>this.controlTeamUnlocked(team,desired));
  }
  async controlTeamUnlocked(team,desired){
    if(!team||!['running','paused','stopped'].includes(desired))throw new Error('Choose a team and running, paused or stopped.');
    if(desired==='stopped'){team.runtimeStopRevision=(team.runtimeStopRevision||0)+1;this.store.save();}
    const members=this.store.state.sessions.filter(s=>s.teamId===team.id&&s.execution?.kind==='container'&&(desired==='stopped'||!s.enrollmentRevokedAt)),results=[];
    for(const member of members)results.push(await this.control(member,desired));
    if(desired==='stopped'&&results.every(r=>r.ok)){
      const names=this.names(team);
      try{const exists=await this.docker(team.host,['ps','-aq','--filter',`name=^/${names.proxy}$`]);if(exists.trim()){await this.inspectOwned(team.host,'container',names.proxy);await this.docker(team.host,['container','rm','--force',names.proxy]);}this.networks.delete(team.host+':'+team.id);if(team.runtimeServices?.gateway)team.runtimeServices.gateway.state='stopped';this.store.save();results.push({resource:'team-gateway',ok:true});
        const network=await this.docker(team.host,['network','ls','--filter',`name=^${names.network}$`,'--format','{{.Name}}']);if(network.trim()){await this.inspectOwned(team.host,'network',names.network);await this.docker(team.host,['network','rm',names.network]);}if(team.runtimeServices?.network)team.runtimeServices.network.state='removed';this.store.save();results.push({resource:'team-network',ok:true});}catch(error){results.push({resource:'team-services',ok:false,error:error.message});}
    }
    return {ok:results.every(r=>r.ok),partial:results.some(r=>!r.ok),results,result:results.every(r=>r.ok)?`Team runtime ${desired}; saved workspaces retained.`:'Some runtime controls were not confirmed; saved workspaces retained.'};
  }
  close(){this.closed=true;for(const child of this.brokers.values())child.kill();this.brokers.clear();}
}
