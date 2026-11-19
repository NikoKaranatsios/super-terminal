import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {WebSocketServer} from 'ws';

export function reviewState() {
  return {
    hosts:['remote-fixture'],hostNames:{'remote-fixture':'Remote example'},remote:[],preferences:{fontSize:13,automaticBriefing:false,notifyOnFinish:false},activity:[],messages:[{id:'message-1',from:'agent',to:'coordinator',teamId:'team',group:'Example project',text:'**Review complete.** The task view is ready to inspect.\n\n- Layout checked\n- Keyboard review next',createdAt:'2025-01-01T12:00:00Z',delivery:'read',read:true}],prompts:{codex:'Example coding instructions.',claude:'Example design instructions.',grok:''},defaultCwd:'/example',localDiscovery:{healthy:true},
    projects:[{id:'project',name:'Example project',host:'local',cwd:'/example'},{id:'other',name:'Another project',host:'remote-fixture',cwd:'/remote/example'},...Array.from({length:80},(_,i)=>({id:'archived-'+i,name:'workspace',host:'local',cwd:'/example/references/workspace-'+i}))],
    tasks:['doing','todo','blocked','done','stopped'].map((status,i)=>({id:'task-'+i,projectId:'project',title:['Review the release and verify the updated interface','Prepare the next work item','Resolve the missing verification evidence','Document the accepted outcome','Retain the stopped experiment'][i],status,notes:'Review notes: '+('A useful overview should remain readable while full context stays available in task details. ').repeat(9),blocker:status==='blocked'?'Waiting for review evidence.':'',evidence:status==='done'?['Fixture verification passed.']:[],agentId:i===0?'agent':null})),
    workSessions:[{id:'work',title:'Example working session',status:'active',projects:[]},{id:'saved',title:'Earlier working session',status:'wrapped',projects:[]}],
    sessions:[{id:'agent',kind:'managed',provider:'codex',host:'local',cwd:'/example',projectId:'project',teamId:'team',scope:{workSessionId:'work'},role:'Implementation reviewer',mission:'Review the interface, verify keyboard and layout behavior, then record the results.',taskId:'task-0',status:'running'},{id:'external',kind:'external',provider:'claude',host:'local',cwd:'/example',projectId:'project',title:'Review of typography, navigation and the overall workspace hierarchy',status:'external',historyId:'history'},{id:'lost',kind:'managed',provider:'codex',host:'remote-fixture',cwd:'/remote/example',projectId:'other',title:'Remote review',status:'disconnected',connectionLost:true},{id:'stopped',kind:'managed',provider:'codex',host:'local',cwd:'/example',projectId:'project',title:'Previous review',status:'stopped'},{id:'service',kind:'external',provider:'claude',host:'local',cwd:'/example',runtime:true,status:'external',title:'claude daemon'},{id:'shell',kind:'tmux',provider:'shell',host:'local',cwd:'/example',status:'running',title:'zsh · ttys001'}],
    teams:[{id:'team',name:'Example project',projectId:'project',host:'local',cwd:'/example',mission:'Review the interface and report useful findings.'}],
    history:[{id:'history',kind:'history',provider:'claude',host:'local',cwd:'/example',projectId:'project',title:'Saved design review',updatedAt:'2025-01-01T12:00:00Z'}],
    coordinator:{running:false,settings:{},assessments:{},loop:{state:'stopped'},history:[{id:'turn',prompt:'Review the example interface.',answer:'**The review is ready.**\n\nThe project view keeps tasks, agents and completion evidence together.\n\n- Check navigation and keyboard focus.\n- Preserve drafts when changing views.\n\n| Check | Outcome |\n| --- | --- |\n| Layout | Ready for review |\n| Keyboard | Needs verification |\n\n```js\nconst result = { reviewed: true };\n```',status:'complete',trace:[]}]},
    background:{collection:{state:'stopped',intervalMs:5000},coordination:{state:'stopped',mode:'manual'},discovery:{state:'configured',intervalMs:20000,historyCacheMs:60000},interface:{intervalMs:5000},notifications:{intervalMs:3000,enabled:false},terminal:{mode:'event-driven',attachments:0},browser:{mode:'on-demand',contexts:0}}
  };
}

export async function reviewFixture() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'st-ui-fixture-'));
  await build({entryPoints:['src/app.js'],bundle:true,format:'esm',outfile:path.join(directory,'app.js'),logLevel:'silent'});
  const state=reviewState(),requests=[],terminalInput=[],flags={failPreference:false,failPrompt:false,failMessage:false};
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://fixture');
      if(url.pathname.startsWith('/api/')) {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
        requests.push({path:url.pathname,method:req.method,body});let result={ok:true};
        if(url.pathname==='/api/state')result=state;
        else if(url.pathname==='/api/focus')state.coordinator.focus=body;
        else if(url.pathname==='/api/coordinator/catalog')result={defaultModel:'fixture-model',defaultReasoningEffort:'high',models:[],skills:[],errors:[]};
        else if(url.pathname==='/api/preferences') {
          if(flags.failPreference){res.statusCode=503;result={error:'Fixture preference save failed.'};}
          else result=Object.assign(state.preferences,body);
        } else if(url.pathname==='/api/prompts') {
          if(flags.failPrompt){res.statusCode=503;result={error:'Fixture prompt save failed.'};}
          else {state.prompts=body;result=body;}
        } else if(url.pathname.endsWith('/prompt')){if(flags.promptDelayMs)await new Promise(resolve=>setTimeout(resolve,flags.promptDelayMs));if(flags.failMessage){res.statusCode=503;result={error:'Fixture mailbox unavailable.'};}else{result={id:'message-'+(state.messages.length+1),from:'you',to:url.pathname.split('/')[3],teamId:'team',group:'Example project',text:body.text,createdAt:'2025-01-01T12:01:00Z',delivery:'queued',read:false};state.messages.push(result);}}
        else if(url.pathname==='/api/messages')result=state.messages;
        else if(url.pathname.startsWith('/api/history/'))result={events:[{id:'fixture:0:0',role:'user',kind:'message',text:'Please review the layout.'},{id:'fixture:1:0',role:'assistant',kind:'message',text:'The saved review is available.\n\n**Next:** check the project task table.'}],nextCursor:null,note:'Example saved output.',coverage:{from:0,to:10,totalBytes:10}};
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
      }
      if(url.pathname==='/app.js'||url.pathname==='/app.css'){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(directory,url.pathname.slice(1))));return;}
      res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('src/index.html','utf8').replace('__TOKEN__','fixture').replace('__BUILD__','fixture').replace('__DATA_KEY__','fixture'));
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
  });
  const sockets=new WebSocketServer({server});sockets.on('connection',(socket,request)=>{socket.on('message',bytes=>{const message=JSON.parse(bytes);if(message.type==='input')terminalInput.push({id:new URL(request.url,'http://fixture').searchParams.get('id'),data:message.data});});socket.send(JSON.stringify({type:'ready'}));socket.send(JSON.stringify({type:'output',data:'Example terminal\r\nReady for review.\r\n'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {state,flags,requests,terminalInput,url:'http://127.0.0.1:'+server.address().port,async close(){for(const socket of sockets.clients)socket.terminate();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}};
}
