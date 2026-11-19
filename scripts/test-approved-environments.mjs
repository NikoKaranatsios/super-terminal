// Explicit opt-in live acceptance. Reads the existing private allowlist; creates
// only disposable shells, directories and credentials with generated IDs.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';
if(!process.argv.includes('--approved-environments'))throw new Error('Pass --approved-environments to exercise your existing SSH allowlist.');
const exec=promisify(execFile),root=process.cwd(),connections=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.super-terminal/connections.json')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'st-remote-acceptance-')),socket='st-remote-'+path.basename(dir);
fs.writeFileSync(path.join(dir,'connections.json'),JSON.stringify(connections),{mode:0o600});fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({sessions:[],hosts:[],preferences:{automaticBriefing:false,notifyOnFinish:false},conductor:{loop:{state:'stopped'}}}));
const fixture=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Disposable remote browser check</title><h1>REMOTE_BROWSER_READY</h1>');});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const listener=http.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:String(port),SUPER_TERMINAL_DATA:dir,SUPER_TERMINAL_SOCKET:socket,SUPER_TERMINAL_TEST:'1',CODEX_HOME:path.join(dir,'codex'),CLAUDE_CONFIG_DIR:path.join(dir,'claude'),GROK_HOME:path.join(dir,'grok')},stdio:['ignore','ignore','pipe']});let log='';child.stderr.on('data',c=>log=(log+c).slice(-4000));let token;
const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const ssh=async(connection,command)=> (await exec('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=6',connection.target,command],{timeout:75000,maxBuffer:1024*1024})).stdout.trim();
const api=async(route,method='GET',body)=>{const r=await fetch(base+'/api'+route,{method,headers:{'x-super-terminal':token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
let active,remoteDir;
try{
 for(let i=0;i<100;i++){try{token=(await(await fetch(base)).text()).match(/name="super-terminal-token" content="([^"]+)"/)?.[1];if(token)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(token,'Test service did not start');
 for(const connection of connections){
  try{
   remoteDir=await ssh(connection,'mktemp -d /tmp/super-terminal-acceptance.XXXXXXXX');assert.match(remoteDir,/^\/tmp\/super-terminal-acceptance\.[\w]+$/);
   active=await api('/sessions','POST',{provider:'shell',host:connection.target,cwd:remoteDir,title:'Disposable remote acceptance'});
   const helper=async args=>JSON.parse(await ssh(connection,`SUPER_TERMINAL_AGENT_CONFIG="$HOME/.super-terminal/agent-${active.id}.json" python3 "$HOME/.super-terminal/agents/${active.id}/bridge.py" ${args.map(quote).join(' ')}`));
   let ready=false;for(let i=0;i<20;i++){try{await helper(['context']);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.equal(ready,true,'Remote helper did not connect');
   const message=await api('/sessions/'+active.id+'/prompt','POST',{text:'Disposable mailbox acceptance'});
   assert.ok((await helper(['inbox'])).messages.some(m=>m.id===message.id));assert.equal((await helper(['ack','--message-id',message.id])).delivery,'acknowledged');
   await helper(['browser','open','--url',`http://127.0.0.1:${fixture.address().port}`]);const shot=await helper(['browser','screenshot']);
   assert.match(shot.screenshot,new RegExp(active.id));
   assert.equal(await ssh(connection,'python3 -c '+quote("import pathlib,sys;p=pathlib.Path(sys.argv[1]);print(p.read_bytes()[:8].hex())")+' '+quote(shot.screenshot)),'89504e470d0a1a0a');
   await exec('tmux',['-L',socket,'respawn-pane','-k','-t',active.tmuxName,'/bin/sleep 60']);
   await ssh(connection,'tmux has-session -t '+quote(active.tmuxName));
   await api('/sessions/'+active.id+'/reconnect','POST',{});
   ready=false;for(let i=0;i<20;i++){try{await helper(['context']);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.equal(ready,true,'Reconnected helper did not respond');
   assert.equal((await ssh(connection,'tmux list-sessions -F '+quote('#{session_name}'))).split('\n').filter(s=>s===active.tmuxName).length,1);
   const removed=await api('/sessions/'+active.id,'DELETE');assert.equal(removed.removed,true);
   const revoked=await ssh(connection,`test ! -e "$HOME/.super-terminal/agent-${active.id}.json" && test ! -e "$HOME/.super-terminal/agents/${active.id}/bridge.py" && printf clean`);assert.equal(revoked,'clean');
   await ssh(connection,'rm -f -- '+quote(shot.screenshot));active=null;
   console.log(connection.name+': shell persistence, cwd preflight, scoped helper, explicit acknowledgment, remote screenshot, transport reconnect without duplication, and credential cleanup passed.');
  }finally{
   if(active){try{await api('/sessions/'+active.id,'DELETE');}catch{}active=null;}
   if(remoteDir){await ssh(connection,'rmdir -- '+quote(remoteDir)).catch(()=>{});remoteDir=null;}
  }
 }
}catch(error){let message=error.message;for(const c of connections)message=message.replaceAll(c.target,c.name);console.error(message);console.error('Private diagnostics retained:',dir);process.exitCode=1;}
finally{child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)r();else child.once('close',r);});fixture.closeAllConnections();await new Promise(r=>fixture.close(r));if(!process.exitCode)fs.rmSync(dir,{recursive:true,force:true});}
