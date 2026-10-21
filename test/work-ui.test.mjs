import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { WebSocketServer } from 'ws';

const chrome = [process.env.SUPER_TERMINAL_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));

test('fixture renderer keeps work records, process controls, task views, chat scope and paged output distinct', {skip:!chrome}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-ui-'));
  await build({entryPoints:['src/app.js'],bundle:true,format:'esm',outfile:path.join(dir,'app.js'),logLevel:'silent'});
  const state={
    hosts:[],hostNames:{},remote:[],preferences:{fontSize:13,automaticBriefing:false,notifyOnFinish:false},activity:[],messages:[],prompts:{codex:'',claude:'',grok:''},defaultCwd:'/example',
    coordinator:{running:false,history:[{prompt:'Check the example project and summarize the result.',status:'complete',trace:[
      {kind:'commentary',text:'Checking **the current changes** before running `npm test`.'},
      {type:'item.completed',name:'command_execution',command:'npm test',output:'\u001b[32mPASS\u001b[0m · example checks\n\u001b[2mCompleted fixture verification\u001b[22m',exitCode:0,status:'completed'},
      {kind:'warning',text:'The remote environment has not been checked.'},
      {kind:'error',text:'Example unavailable source; other checks continued.'},
      {kind:'skill',name:'Example review',text:'Applied the project review instructions.'},
      {name:'agent_message',itemId:'fixture-response',seq:1,text:JSON.stringify({answer:'Local checks passed.',actions:[],assessments:[]})}
    ],answer:'## Review complete\n\n**Local checks passed.**\n\n- [x] Build verified\n- [ ] ==Remote review needed==\n\n| Check | Result |\n| --- | --- |\n| Local | Passed |\n| Remote | Unverified |\n\n```json\n{"ready": true}\n```\n\n[Review notes](https://example.com/review)'}],assessments:{},loop:{state:'stopped'}},
    projects:[{id:'project',name:'Example project',host:'local',cwd:'/example'},{id:'other-project',name:'Another example',host:'local',cwd:'/another-example'}],
    tasks:[{id:'task',projectId:'project',title:'Verify example output',status:'doing',notes:'Run the fixture check.',evidence:['Fixture evidence'],agentId:'agent',scope:{workSessionId:'work',projectId:'legacy-project',goalId:'task'}}],
    workSessions:[{id:'work',title:'Example work',status:'active',projects:[]},{id:'saved',title:'Saved work',status:'wrapped',projects:[]}],
    teams:[{id:'team',name:'Example team',mission:'Check the fixture',cwd:'/example',host:'local'}],
    sessions:[{id:'agent',title:'codex · terminal',role:'Fixture reviewer',provider:'codex',kind:'managed',status:'running',host:'local',cwd:'/example',projectId:'project',teamId:'team',group:'Example team',scope:{workSessionId:'work',projectId:'legacy-project',goalId:'task'}},{id:'external',title:'External fixture',provider:'codex',kind:'external',status:'external',host:'local',cwd:'/example',projectId:'project',historyId:'history'},{id:'tmux',title:'Live fixture terminal',provider:'codex',kind:'tmux',status:'running',host:'local',cwd:'/example',projectId:'project'}],
    background:{service:{state:'running',survivesQuit:false},collection:{state:'running',intervalMs:5000,lastCheckedAt:'2026-01-01T12:00:00Z',running:false},localDiscovery:{mode:'on-demand',cacheMs:7000,lastCollectedAt:'2026-01-01T12:00:00Z'},remoteDiscovery:{state:'configured',intervalMs:20000,historyCacheMs:60000},interface:{intervalMs:5000},notifications:{intervalMs:3000,enabled:false},terminal:{mode:'event-driven',attachments:1},browser:{mode:'on-demand',contexts:0}},
    history:[{id:'history',kind:'history',title:'Saved fixture',provider:'codex',host:'local',cwd:'/example'}]
  };
  for(const status of ['todo','blocked','done','stopped'])state.tasks.push({id:status,projectId:'project',title:`Example ${status} task`,status,notes:status==='blocked'?'Waiting for fixture evidence.':'',evidence:[],scope:{workSessionId:'work',projectId:'legacy-project',goalId:status}});
  let recent=0,historyUnavailable=false;const requests=[],errors=[],terminalInput=[];
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
      requests.push({path:url.pathname,method:req.method,body});let result={ok:true};
      if(url.pathname==='/api/state')result=state;
      else if(url.pathname==='/api/focus')state.coordinator.focus={...body,summary:body.projectId?state.projects.find(p=>p.id===body.projectId)?.name:'No focused project'};
      else if(url.pathname==='/api/messages')result=state.messages.filter(m=>!url.searchParams.get('agentId')||m.to===url.searchParams.get('agentId')||m.from===url.searchParams.get('agentId'));
      else if(url.pathname==='/api/sessions/agent/prompt'){result={id:'fixture-message',from:'you',to:'agent',text:body.text,read:false,delivery:'queued',note:'Queued for the next checkpoint.'};state.messages.push(result);}
      else if(url.pathname==='/api/sessions/agent/project'){Object.assign(state.sessions[0],{projectId:body.projectId,scope:null,contextIsolation:'restart-required',projectAssignment:{source:'manual',verified:true},capabilities:{mailbox:false,terminalInput:true,continuationHistoryId:null}});for(const message of state.messages)if(!message.read)message.delivery='withdrawn';result={session:state.sessions[0],note:'Assignment moved. Start a fresh agent to separate model context.'};}
      else if(url.pathname==='/api/sessions'){result={id:body.historyId?'continued-agent':'fresh-agent',title:'Fresh fixture agent',provider:'codex',kind:'managed',status:'running',host:body.host,cwd:body.cwd || '/example',projectId:body.projectId || 'project'};state.sessions.push(result);}
      else if(url.pathname==='/api/work-sessions/work')state.workSessions[0].status=body.status;
      else if(url.pathname==='/api/sessions/agent/control'){if(body.state==='stopped')result={ok:false,partial:true,results:[{target:'fixture child',ok:false,error:'Fixture refused stop'}]};else state.sessions[0].status=body.state;}
      else if(url.pathname==='/api/coordinator/control')state.coordinator.loop.state=body.state;
      else if(url.pathname==='/api/coordinator')state.coordinator.history.push({prompt:body.prompt,answer:'Fixture response'});
      else if(url.pathname==='/api/history/history'){
        if(historyUnavailable){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Fixture source unavailable'}));return;}
        const earlier=url.searchParams.has('cursor');
        result=earlier?{events:[{id:'codex:0:0',role:'user',kind:'message',text:'Earlier fixture output'}],nextCursor:null,coverage:{from:0,to:100,totalBytes:200},note:'Fixture output'}:{events:[{id:'codex:100:0',role:'tool',kind:'tool_result',name:'fixture tool',text:'Tool result visible'},...(recent?[{id:'codex:150:0',role:'assistant',kind:'commentary',text:'New fixture commentary'}]:[])],nextCursor:100,coverage:{from:100,to:200,totalBytes:200},note:'Fixture output'};
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(url.pathname==='/app.js'||url.pathname==='/app.css'){res.setHeader('Content-Type',url.pathname.endsWith('css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(dir,url.pathname.slice(1))));return;}
    res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('src/index.html','utf8').replace('__TOKEN__','fixture-token'));
  });
  const sockets=new WebSocketServer({server});
  sockets.on('connection',(socket,request)=>{const id=new URL(request.url,'http://fixture').searchParams.get('id');socket.send(JSON.stringify({type:'ready'}));socket.on('message',message=>{const event=JSON.parse(message);if(event.type==='input')terminalInput.push({id,data:event.data});});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const page=await browser.newPage({viewport:{width:1150,height:820}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#working-session-select').waitFor();
    await page.click('#conductor-nav');
    await page.locator('#chat-output .console-heading').waitFor();
    assert.equal(await page.locator('#chat-output .console-command').evaluate(el=>getComputedStyle(el).color),'rgb(171, 225, 218)');
    assert.equal(await page.locator('#chat-output .console-error .console-body').evaluate(el=>getComputedStyle(el).color),'rgb(231, 137, 137)');
    assert.equal(await page.locator('#chat-output .console-heading').evaluate(el=>getComputedStyle(el).fontWeight),'700');
    assert.equal(await page.locator('#chat-output .ansi-dim').evaluate(el=>getComputedStyle(el).opacity),'0.65');
    assert.equal(await page.locator('#chat-output .console-code').innerText(),'json\n{"ready": true}\n');
    assert.equal(await page.locator('#chat-output mark').innerText(),'Remote review needed');
    assert.equal(await page.locator('#chat-output .task-list-item-checkbox:disabled').count(),2);
    assert.equal(await page.locator('#chat-output table tbody tr').count(),2);
    assert.equal(await page.locator('#chat-output .hljs-literal').evaluate(el=>getComputedStyle(el).color),'rgb(198, 160, 216)');
    await page.evaluate(()=>{window.openedFixtureLinks=[];window.superTerminalDesktop={openLink:async url=>{window.openedFixtureLinks.push(url);return true;}};});
    await page.locator('#chat-output a').click();
    assert.deepEqual(await page.evaluate(()=>window.openedFixtureLinks),['https://example.com/review']);
    await page.locator('#chat-output .console-payload summary').click();
    state.coordinator.history[0].trace.push({kind:'commentary',text:'Fixture update arrived.'});
    await page.getByText('Fixture update arrived.',{exact:true}).waitFor();
    assert.equal(await page.locator('#chat-output .console-payload').evaluate(el=>el.open),true,'expanded output must remain open when progress refreshes');
    await page.locator('#chat-output .console-payload summary').click();
    if(process.env.SUPER_TERMINAL_CONSOLE_SCREENSHOT){await page.screenshot({path:process.env.SUPER_TERMINAL_CONSOLE_SCREENSHOT});await page.setViewportSize({width:820,height:650});await page.screenshot({path:process.env.SUPER_TERMINAL_CONSOLE_SCREENSHOT.replace(/\.png$/, '-narrow.png')});await page.setViewportSize({width:1150,height:820});}
    await page.click('#docs-nav');await page.locator('[data-view="docs"] .docs-status').waitFor();
    assert.match(await page.locator('[data-view="docs"] .docs-status').innerText(),/Conductor loop/);
    await page.locator('.docs-status details summary').first().click();state.background.collection.state='fixture collecting';
    await page.getByText('fixture collecting',{exact:false}).waitFor();assert.equal(await page.locator('.docs-status details').first().evaluate(el=>el.open),true,'expanded live status survives refreshed observations');
    await page.locator('.docs-status details summary').first().click();
    await page.click('[data-doc-section="messages"]');assert.match(await page.locator('.docs-guide').innerText(),/Read means fetched, not accepted or completed/);
    assert.equal(await page.locator('.docs-guide .console-heading').first().evaluate(el=>getComputedStyle(el).color),'rgb(176, 236, 192)');
    assert.equal(await page.locator('.docs-guide .console-table').evaluate(el=>getComputedStyle(el).overflowX),'auto');
    if(process.env.SUPER_TERMINAL_DOCS_SCREENSHOT){await page.locator('.docs-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:process.env.SUPER_TERMINAL_DOCS_SCREENSHOT});await page.setViewportSize({width:820,height:650});await page.locator('.docs-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:process.env.SUPER_TERMINAL_DOCS_SCREENSHOT.replace(/\.png$/, '-narrow.png')});await page.setViewportSize({width:1150,height:820});}
    await page.click('#conductor-nav');
    await page.selectOption('#working-session-select','saved');
    assert.equal(requests.filter(r=>r.method==='PATCH').length,0,'browsing must not resume a session');
    await page.selectOption('#working-session-select','work');
    await page.click('[data-work-control="paused"]');
    await page.waitForFunction(()=>document.querySelector('.session-state').textContent==='Paused');
    assert.equal(state.sessions[0].status,'running','human work pause cannot pause an agent');
    await page.click('#overview-nav');
    assert.equal(await page.locator('[data-task-square="task"]').getAttribute('class'),'task-square state-doing');
    if(process.env.SUPER_TERMINAL_UI_SCREENSHOT){fs.mkdirSync(path.dirname(process.env.SUPER_TERMINAL_UI_SCREENSHOT),{recursive:true});await page.screenshot({path:process.env.SUPER_TERMINAL_UI_SCREENSHOT});await page.setViewportSize({width:820,height:650});await page.screenshot({path:process.env.SUPER_TERMINAL_UI_SCREENSHOT.replace(/\.png$/, '-narrow.png')});await page.setViewportSize({width:1150,height:820});}
    await page.click('[data-task-square="task"]');
    assert.match(await page.locator('.pane-content .task-section').allTextContents().then(a=>a.join(' ')),/Fixture evidence/);
    await page.locator('.pane-content [data-ask-scope]').click();
    await page.fill('#chat-input','Explain this fixture task');await page.click('#send-chat');
    await page.waitForFunction(()=>document.querySelector('#chat-output').textContent.includes('Fixture response'));
    const chat=requests.find(r=>r.path==='/api/coordinator');assert.equal(chat.body.taskId,'task');assert.equal(chat.body.projectId,'project');assert.equal(chat.body.workSessionId,'work');
    await page.click('[data-loop-control="running"]');
    await page.waitForFunction(()=>document.querySelector('#conductor-loop strong').textContent==='running');
    await page.click('#terminals [data-id="agent"]');
    await page.click('[data-agent-control="paused"]');
    await page.waitForSelector('[data-agent-control="running"]');
    await page.click('[data-agent-control="running"]');
    await page.waitForSelector('[data-view="agent"] .submit-agent-message:not([disabled])');
    await page.fill('[data-view="agent"] .agent-message textarea','Fixture prompt only');await page.click('[data-view="agent"] .submit-agent-message');
    await page.waitForFunction(()=>document.querySelector('[data-view="agent"] .agent-message textarea').value==='');
    assert.equal(requests.find(r=>r.path==='/api/sessions/agent/prompt').body.text,'Fixture prompt only');
    assert.match(await page.locator('[data-view="agent"] .agent-message-receipts').innerText(),/Queued · awaiting read/);
    state.messages[0].read=true;
    await page.waitForFunction(()=>document.querySelector('[data-view="agent"] .agent-message-receipts').textContent.includes('Read by agent'),{},{timeout:10000});
    await page.click('[data-agent-control="stopped"]');await page.getByText('Partially completed. fixture child: failed — Fixture refused stop',{exact:true}).first().waitFor();
    assert.equal(state.sessions[0].status,'running');assert.equal(state.tasks[0].status,'doing');
    await page.click('#teams-nav');assert.match(await page.locator('.pane-content .team-strip').innerText(),/Fixture reviewer/);
    await page.locator('.pane-content [data-ask-scope]').first().click();assert.equal(await page.inputValue('#chat-input'),'Create a team to ');
    assert.equal(requests.filter(r=>r.path==='/api/coordinator').length,1,'opening create-team chat must not send automatically');
    await page.locator('#history summary').click();await page.click('#history-list [data-id="history"]');
    await page.getByText('Tool result visible',{exact:false}).waitFor();
    await page.click('.load-earlier');await page.getByText('Earlier fixture output',{exact:false}).waitFor();
    recent=1;
    await page.waitForFunction(()=>document.querySelector('.pane-content .output')?.textContent.includes('New fixture commentary'),{},{timeout:10000});
    assert.match(await page.locator('.pane-content .output').innerText(),/Earlier fixture output/);
    historyUnavailable=true;
    await page.waitForFunction(()=>document.querySelector('.history-coverage')?.textContent.includes('Fixture source unavailable'),{},{timeout:10000});
    assert.match(await page.locator('.pane-content .output').innerText(),/Earlier fixture output/);
    await page.click('#terminals [data-id="tmux"]');
    await page.waitForFunction(()=>document.querySelector('[data-view="tmux"] .connection').textContent==='');
    await page.fill('[data-view="tmux"] .agent-message textarea','Fixture terminal input');await page.click('[data-view="tmux"] .submit-agent-message');
    await page.getByText('Input submitted to the terminal. Check its output for the result.',{exact:true}).waitFor();
    assert.deepEqual(terminalInput.filter(event=>event.id==='tmux').map(event=>event.data),['Fixture terminal input','\r']);
    assert.equal(requests.some(r=>r.path==='/api/sessions/tmux/prompt'),false);
    await page.click('#terminals [data-id="agent"]');
    state.messages[0].read=false;
    const movedFocus=page.waitForResponse(response=>response.url().endsWith('/api/focus')&&response.request().postDataJSON()?.projectId==='other-project');
    await page.selectOption('[data-view="agent"] .agent-project-select','other-project');await page.click('[data-view="agent"] .move-agent-project');
    await page.locator('[data-view="agent"] .fresh-agent').waitFor();
    await movedFocus;
    await page.locator('[data-view="agent"] .message-receipt').filter({hasText:'Withdrawn · assignment changed'}).waitFor();
    assert.match(await page.locator('[data-view="agent"] .agent-message-hint').innerText(),/previous model context/);
    assert.equal(await page.locator('[data-view="agent"] .continue-agent').isVisible(),false);
    assert.equal(state.sessions[0].cwd,'/example','assignment cannot move the process directory');
    await page.click('#conductor-nav');assert.match(await page.locator('#chat-scope').innerText(),/Current: Another example/);
    await page.fill('#chat-input','Explain the current project');await page.click('#send-chat');
    await page.getByText('Explain the current project',{exact:true}).waitFor();
    const focusedChat=requests.filter(r=>r.path==='/api/coordinator').at(-1);assert.equal(focusedChat.body.projectId,'other-project');assert.equal(focusedChat.body.workSessionId,undefined);assert.equal(focusedChat.body.focus.agentId,'agent');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('focus:workspace:main')).projectId),'other-project');
    await page.click('#terminals [data-id="agent"]');
    await page.fill('[data-view="agent"] .agent-message textarea','Fresh project fixture request');await page.click('[data-view="agent"] .fresh-agent');
    const freshRequest=requests.find(r=>r.path==='/api/sessions'&&r.body.projectId==='other-project');assert.equal(freshRequest.body.cwd,'/another-example');assert.equal(freshRequest.body.historyId,undefined);assert.equal(freshRequest.body.task,'Fresh project fixture request');
    await page.click('#terminals [data-id="external"]');
    await page.evaluate(()=>{window.copiedFixtureText='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedFixtureText=text;}}});});
    await page.fill('[data-view="external"] .agent-message textarea','External fixture message');await page.click('[data-view="external"] .submit-agent-message');
    assert.equal(await page.evaluate(()=>window.copiedFixtureText),'External fixture message');
    assert.equal(requests.some(r=>r.path==='/api/sessions/external/prompt'),false);
    assert.match(await page.locator('[data-view="external"] .agent-message-status').innerText(),/no message was delivered here/);
    await page.click('[data-view="external"] .continue-agent');
    const continuation=requests.find(r=>r.path==='/api/sessions'&&r.body.historyId==='history');assert.equal(continuation.body.task,'External fixture message');
    assert.ok(state.sessions.some(s=>s.id==='external'),'continuation preserves the external process record');
    assert.ok(requests.some(r=>r.path==='/api/focus'&&r.body.projectId==='other-project'));
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();for(const socket of sockets.clients)socket.terminate();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
});
