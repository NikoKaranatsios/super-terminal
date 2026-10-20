const {app,utilityProcess}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const {WebSocket}=require('ws');
const {startBackend}=require('../desktop/backend.cjs');
app.setPath('userData',path.join(process.env.SUPER_TERMINAL_DATA,'desktop-test'));
app.whenReady().then(async()=>{
  let backend,terminalId,headers,base;
  try{
    backend=await startBackend({utilityProcess,root:path.resolve(__dirname,'..'),port:Number(process.env.PORT),dataDir:process.env.SUPER_TERMINAL_DATA,env:process.env});
    assert.equal(backend.owned,true);base=backend.origin;
    const html=await(await fetch(base)).text();headers={'x-super-terminal':html.match(/name="super-terminal-token" content="([^"]+)"/)[1],'content-type':'application/json'};
    const api=async(url,method='GET',body)=>{const r=await fetch(base+'/api'+url,{method,headers,body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
    const terminal=await api('/sessions','POST',{provider:'shell',title:'Desktop runtime verification',cwd:process.env.SUPER_TERMINAL_DATA});terminalId=terminal.id;
    const command="printf '\\nDESKTOP_%s_READY\\n' runtime\r";
    await new Promise((resolve,reject)=>{
      const ws=new WebSocket(base.replace('http','ws')+'/terminal?token='+headers['x-super-terminal']+'&id='+terminal.id,{origin:base});let output='';
      const timer=setTimeout(()=>{ws.terminate();reject(new Error('Desktop PTY did not respond'));},7000);
      ws.on('error',reject);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='ready')ws.send(JSON.stringify({type:'input',data:command}));if(m.type==='output'){output+=m.data;if(output.includes('DESKTOP_runtime_READY')){clearTimeout(timer);ws.close();resolve();}}});
    });
    const reused=await startBackend({utilityProcess,root:path.resolve(__dirname,'..'),port:Number(process.env.PORT),dataDir:process.env.SUPER_TERMINAL_DATA,env:process.env});
    assert.equal(reused.owned,false);await reused.stop();assert.ok(await fetch(base+'/desktop-health'));
    await backend.stop();
    backend=await startBackend({utilityProcess,root:path.resolve(__dirname,'..'),port:Number(process.env.PORT),dataDir:process.env.SUPER_TERMINAL_DATA,env:process.env});
    const again=await(await fetch(base)).text();headers['x-super-terminal']=again.match(/name="super-terminal-token" content="([^"]+)"/)[1];
    const state=await api('/state');assert.equal(state.sessions.find(s=>s.id===terminalId).status,'running');
    await api('/sessions/'+terminalId,'DELETE');terminalId=null;
    await backend.stop();backend=null;
    console.log('Desktop runtime passed: bundled Node, SQLite history, native PTY, service reuse, clean shutdown, and tmux survival across restart.');
    app.exit(0);
  }catch(error){
    console.error(error);
    if(terminalId&&headers)try{await fetch(base+'/api/sessions/'+terminalId,{method:'DELETE',headers});}catch{}
    await backend?.stop();app.exit(1);
  }
});
