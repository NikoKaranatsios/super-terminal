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
  state.sessions.push({id:'plain-shell',host:'local',provider:'shell',kind:'external',status:'external',title:'zsh · ttys001',cwd:'/fixture'},{id:'background',host:'local',provider:'codex',kind:'external',status:'external',runtime:true,title:'codex · ??',cwd:'/fixture'});
  let fixtureToken='fixture-token',stateUnavailable=false,recent=0,historyUnavailable=false,holdSettings=false,releaseSettings,holdReply=false,releaseReply,createdReply;const requests=[],errors=[],terminalInput=[];
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/desktop-health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({product:'super-terminal',protocol:2,buildId:'fixture-build',dataKey:'fixture-data'}));return;}
    if(url.pathname.startsWith('/api/')){
      if(req.headers['x-super-terminal']!==fixtureToken){res.statusCode=403;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Reload Super Terminal to reconnect.'}));return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
      requests.push({path:url.pathname,method:req.method,body});let result={ok:true};
      if(url.pathname==='/api/state'){if(stateUnavailable){res.statusCode=503;result={error:'Fixture service unavailable'};}else result=state;}
      else if(url.pathname==='/api/focus')state.coordinator.focus={...body,summary:body.projectId?state.projects.find(p=>p.id===body.projectId)?.name:'No focused project'};
      else if(url.pathname==='/api/messages')result=state.messages.filter(m=>!url.searchParams.get('agentId')||m.to===url.searchParams.get('agentId')||m.from===url.searchParams.get('agentId'));
      else if(url.pathname==='/api/sessions/agent/prompt'){result={id:'fixture-message',from:'you',to:'agent',text:body.text,read:false,delivery:'queued',note:'Queued for the next checkpoint.'};state.messages.push(result);}
      else if(url.pathname==='/api/sessions/agent/project'){Object.assign(state.sessions[0],{projectId:body.projectId,scope:null,contextIsolation:'restart-required',projectAssignment:{source:'manual',verified:true},capabilities:{mailbox:false,terminalInput:true,continuationHistoryId:null}});for(const message of state.messages)if(!message.read)message.delivery='withdrawn';result={session:state.sessions[0],note:'Assignment moved. Start a fresh agent to separate model context.'};}
      else if(url.pathname==='/api/sessions'){result={id:body.historyId?'continued-agent':'fresh-agent',title:'Fresh fixture agent',provider:'codex',kind:'managed',status:'running',host:body.host,cwd:body.cwd || '/example',projectId:body.projectId || 'project'};state.sessions.push(result);}
      else if(url.pathname==='/api/work-sessions/work')state.workSessions[0].status=body.status;
      else if(url.pathname==='/api/sessions/agent/control'){if(body.state==='stopped')result={ok:false,partial:true,results:[{target:'fixture child',ok:false,error:'Fixture refused stop'}]};else state.sessions[0].status=body.state;}
      else if(url.pathname==='/api/coordinator/control')state.coordinator.loop.state=body.state;
      else if(url.pathname==='/api/coordinator/catalog')result={defaultModel:'fixture-native',defaultReasoningEffort:'high',models:[{id:'fixture-native',name:'Native fixture'},{id:'fixture-chosen',name:'Chosen fixture'}],skills:[{name:'fixture-review',path:'/fixture/SKILL.md',description:'Review the fixture'}],errors:[]};
      else if(url.pathname==='/api/coordinator/settings'){if(holdSettings)await new Promise(resolve=>releaseSettings=resolve);if(body.workSessionId)state.workSessions.find(s=>s.id===body.workSessionId).conductorSettings=body.settings;else state.coordinator.settings=body.settings;result=body.settings;}
      else if(url.pathname==='/api/coordinator'){if(holdReply){state.coordinator.running=true;await new Promise(resolve=>releaseReply=resolve);state.coordinator.running=false;if(createdReply){result=createdReply;state.coordinator.history.push({prompt:body.prompt,...createdReply});}else{res.statusCode=503;result={error:'Fixture connection failed'};}}else{result=createdReply || {answer:'Fixture response'};state.coordinator.history.push({prompt:body.prompt,...result});}}
      else if(url.pathname==='/api/history/history'){
        if(historyUnavailable){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Fixture source unavailable'}));return;}
        const earlier=url.searchParams.has('cursor');
        result=earlier?{events:[{id:'codex:0:0',role:'user',kind:'message',text:'Earlier fixture output'}],nextCursor:null,coverage:{from:0,to:100,totalBytes:200},note:'Fixture output'}:{events:[{id:'codex:100:0',role:'tool',kind:'tool_result',name:'fixture tool',text:'Tool result visible'},...(recent?[{id:'codex:150:0',role:'assistant',kind:'commentary',text:'New fixture commentary'}]:[])],nextCursor:100,coverage:{from:100,to:200,totalBytes:200},note:'Fixture output'};
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(url.pathname==='/app.js'||url.pathname==='/app.css'){res.setHeader('Content-Type',url.pathname.endsWith('css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(dir,url.pathname.slice(1))));return;}
    res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('src/index.html','utf8').replace('__TOKEN__',fixtureToken).replace('__BUILD__','fixture-build').replace('__DATA_KEY__','fixture-data'));
  });
  const sockets=new WebSocketServer({server});
  sockets.on('connection',(socket,request)=>{const id=new URL(request.url,'http://fixture').searchParams.get('id');socket.send(JSON.stringify({type:'ready'}));socket.on('message',message=>{const event=JSON.parse(message);if(event.type==='input')terminalInput.push({id,data:event.data});});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const page=await browser.newPage({viewport:{width:1150,height:820}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.click('#sessions-nav');
    await page.locator('.sessions-heading').waitFor();await page.click('#management-menu>summary');await page.click('#conductor-nav');
    await page.locator('#working-session-select').waitFor();
    assert.equal(await page.locator('#terminals .sidebar-project').count(),2);
    assert.equal(await page.locator('#terminals [data-id="plain-shell"]').isVisible(),true);
    assert.equal(await page.locator('#terminals [data-id="background"]').isVisible(),false);
    assert.equal(await page.locator('#terminals [data-id="plain-shell"]').isVisible(),true);
    assert.doesNotMatch(await page.locator('#terminals [data-id="plain-shell"] .label').innerText(),/ttys/);
    assert.equal(await page.locator('.pane').count(),1,'fresh workspace opens with one chat pane');
    await page.click('#conductor-nav');
    await page.getByText('Codex · fixture-native · high',{exact:true}).waitFor();
    await page.locator('#conductor-settings summary').click();
    await page.locator('[data-conductor-setting="model"]').evaluate(el=>window.originalModelInput=el);
    await page.fill('[data-conductor-setting="model"]','fixture-chosen');
    assert.equal(await page.evaluate(()=>window.originalModelInput===document.querySelector('[data-conductor-setting=model]')),true,'typing keeps the model field DOM identity');
    await page.selectOption('[data-conductor-setting="reasoningEffort"]','high');
    await page.selectOption('[data-conductor-setting="access"]','workspace');
    await page.click('#save-conductor-settings');
    await page.getByText('Codex · fixture-chosen · high',{exact:true}).waitFor();
    assert.equal(state.workSessions[0].conductorSettings.model,'fixture-chosen');
    holdSettings=true;
    await page.fill('[data-conductor-setting="model"]','fixture-submitted');
    const saving=page.waitForRequest(r=>r.url().endsWith('/api/coordinator/settings'));
    await page.click('#save-conductor-settings');await saving;
    await page.fill('[data-conductor-setting="model"]','fixture-newer');
    releaseSettings();holdSettings=false;
    await page.getByText('Codex · fixture-submitted · high',{exact:true}).waitFor();
    assert.equal(await page.inputValue('[data-conductor-setting="model"]'),'fixture-newer','save preserves newer edits');
    assert.match(await page.locator('#conductor-settings-dirty').innerText(),/unsaved changes/);
    await page.fill('[data-conductor-setting="model"]','fixture-chosen');await page.click('#save-conductor-settings');
    await page.getByText('Codex · fixture-chosen · high',{exact:true}).waitFor();
    await page.selectOption('#conductor-skill','0');
    assert.match(await page.inputValue('#chat-input'),/Use \$fixture-review \(\/fixture\/SKILL.md\)/);
    await page.fill('#chat-input','');
    await page.selectOption('#working-session-select','saved');
    await page.getByText('Codex · fixture-native · high',{exact:true}).waitFor();
    await page.selectOption('#working-session-select','work');
    await page.getByText('Codex · fixture-chosen · high',{exact:true}).waitFor();
    if(process.env.SUPER_TERMINAL_CONSOLE_SCREENSHOT)await page.screenshot({path:process.env.SUPER_TERMINAL_CONSOLE_SCREENSHOT.replace(/\.png$/, '-expanded.png')});
    await page.locator('#conductor-settings summary').click();
    await page.locator('#chat-output .console-heading').waitFor();
    assert.equal(await page.locator('#chat-output .working-details').evaluate(el=>el.open),false);
    await page.locator('#chat-output .working-details>summary').click();
    assert.equal(await page.locator('#chat-output .console-command').evaluate(el=>getComputedStyle(el).color),'rgb(171, 225, 218)');
    assert.equal(await page.locator('#chat-output .console-error .console-body').evaluate(el=>getComputedStyle(el).color),'rgb(231, 137, 137)');
    assert.equal(await page.locator('#chat-output .console-heading').evaluate(el=>getComputedStyle(el).fontWeight),'700');
    assert.equal(await page.locator('#chat-output .ansi-dim').evaluate(el=>getComputedStyle(el).opacity),'0.65');
    assert.equal(await page.locator('#chat-output .console-code code').innerText(),'{"ready": true}\n');
    assert.equal(await page.locator('#chat-output mark').innerText(),'Remote review needed');
    assert.equal(await page.locator('#chat-output .task-list-item-checkbox:disabled').count(),2);
    assert.equal(await page.locator('#chat-output table tbody tr').count(),2);
    assert.equal(await page.locator('#chat-output .hljs-literal').evaluate(el=>getComputedStyle(el).color),'rgb(198, 160, 216)');
    await page.evaluate(()=>{window.openedFixtureLinks=[];window.superTerminalDesktop={openLink:async url=>{window.openedFixtureLinks.push(url);return true;}};});
    await page.locator('#chat-output a').click();
    assert.deepEqual(await page.evaluate(()=>window.openedFixtureLinks),['https://example.com/review']);
    assert.equal(await page.locator('#chat-output .console-payload').count(),0,'structured transport does not duplicate the answer');
    state.coordinator.history[0].trace.push({kind:'commentary',text:'Fixture update arrived.'});
    await page.getByText('Fixture update arrived.',{exact:true}).waitFor();
    assert.equal(await page.locator('#chat-output .working-details').evaluate(el=>el.open),true,'expanded output must remain open when progress refreshes');
    assert.equal(await page.locator('#chat-output .console-payload').count(),0,'structured transport does not duplicate the answer');
    await page.locator('#chat-output .working-details>summary').click();
    if(process.env.SUPER_TERMINAL_CONSOLE_SCREENSHOT){await page.locator('#notice').evaluate(el=>el.hidden=true);await page.screenshot({path:process.env.SUPER_TERMINAL_CONSOLE_SCREENSHOT});await page.setViewportSize({width:820,height:650});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:process.env.SUPER_TERMINAL_CONSOLE_SCREENSHOT.replace(/\.png$/, '-narrow.png')});await page.setViewportSize({width:1150,height:820});}
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
    assert.equal(requests.filter(r=>r.method==='PATCH' && r.path.startsWith('/api/work-sessions/')).length,0,'browsing must not resume a session');
    await page.selectOption('#working-session-select','work');
    await page.click('#session-controls>summary');
    await page.click('[data-work-control="paused"]');
    await page.waitForFunction(()=>document.querySelector('.session-state').textContent==='Paused');
    assert.equal(state.sessions[0].status,'running','human work pause cannot pause an agent');
    await page.click('#overview-nav');
    assert.equal(await page.locator('[data-task-square="task"]').getAttribute('class'),'task-square state-doing');
    assert.equal(await page.locator('.other-projects [data-work-view="project:other-project"]').isVisible(),false);
    await page.locator('.other-projects>summary').click();
    assert.equal(await page.locator('.other-projects [data-work-view="project:other-project"]').isVisible(),true);
    state.projects[1].cwd='/updated-example';
    await page.locator('.other-projects').getByText('/updated-example',{exact:true}).waitFor();
    assert.equal(await page.locator('.other-projects').evaluate(el=>el.open),true,'other projects remain expanded after polling');
    state.projects[1].cwd='/another-example';
    await page.locator('.other-projects>summary').click();
    if(process.env.SUPER_TERMINAL_UI_SCREENSHOT){fs.mkdirSync(path.dirname(process.env.SUPER_TERMINAL_UI_SCREENSHOT),{recursive:true});await page.screenshot({path:process.env.SUPER_TERMINAL_UI_SCREENSHOT});await page.setViewportSize({width:820,height:650});await page.screenshot({path:process.env.SUPER_TERMINAL_UI_SCREENSHOT.replace(/\.png$/, '-narrow.png')});await page.setViewportSize({width:1150,height:820});}
    await page.click('[data-task-square="task"]');
    assert.match(await page.locator('.pane-content .task-section').allTextContents().then(a=>a.join(' ')),/Fixture evidence/);
    await page.locator('.pane-content [data-ask-scope]').click();
    await page.fill('#chat-input','Explain this fixture task');await page.click('#send-chat');
    await page.waitForFunction(()=>document.querySelector('#chat-output').textContent.includes('Fixture response'));
    const chat=requests.find(r=>r.path==='/api/coordinator');assert.equal(chat.body.taskId,'task');assert.equal(chat.body.projectId,'project');assert.equal(chat.body.workSessionId,'work');assert.equal(chat.body.settingsSessionId,'work');
    assert.match(await page.locator('#chat-scope').innerText(),/^Conductor · Local · focus:/);
    assert.equal(await page.locator('#clear-chat-scope').innerText(),'Clear focus');
    await page.click('[data-loop-control="running"]');
    await page.waitForFunction(()=>document.querySelector('[data-loop-control=paused]')!==null);
    await page.click('#terminals [data-id="agent"]');
    await page.locator('[data-view=agent] .agent-controls>summary').click();
    await page.click('[data-agent-control="paused"]');
    await page.waitForSelector('[data-agent-control="running"]');
    await page.click('[data-agent-control="running"]');
    assert.equal(await page.locator('[data-view=agent] .agent-message').count(),0);
    await page.click('[data-agent-control="stopped"]');await page.getByText('Partially completed. fixture child: failed — Fixture refused stop',{exact:true}).first().waitFor();
    assert.equal(state.sessions[0].status,'running');assert.equal(state.tasks[0].status,'doing');
    await page.click('#teams-nav');assert.match(await page.locator('.pane-content .team-strip').innerText(),/Fixture reviewer/);
    await page.locator('[data-runtime-create]').click();assert.match(await page.inputValue('#chat-input'),/^Create an isolated Linux team/);
    assert.equal(requests.filter(r=>r.path==='/api/coordinator').length,1,'opening create-team chat must not send automatically');
    await page.locator('#history summary').click();await page.click('#history-list [data-id="history"]');
    await page.locator('[data-view=history] .working-details>summary').click();
    await page.getByText('Tool result visible',{exact:false}).waitFor();
    await page.click('.load-earlier');await page.getByText('Earlier fixture output',{exact:false}).waitFor();
    recent=1;
    await page.waitForFunction(()=>document.querySelector('[data-view="history"] .output')?.textContent.includes('New fixture commentary'),{},{timeout:10000});
    assert.match(await page.locator('[data-view="history"] .output').innerText(),/Earlier fixture output/);
    historyUnavailable=true;
    await page.waitForFunction(()=>document.querySelector('.history-coverage')?.textContent.includes('Fixture source unavailable'),{},{timeout:10000});
    assert.match(await page.locator('[data-view="history"] .output').innerText(),/Earlier fixture output/);
    await page.click('#terminals [data-id="tmux"]');
    await page.waitForFunction(()=>document.querySelector('[data-view="tmux"] .connection').textContent==='');
    await page.locator('[data-view="tmux"] .xterm-helper-textarea').pressSequentially('Fixture terminal input');await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    assert.equal(terminalInput.filter(event=>event.id==='tmux').map(event=>event.data).join(''),'Fixture terminal input\r');
    assert.equal(requests.some(r=>r.path==='/api/sessions/tmux/prompt'),false);
    await page.click('#terminals [data-id="agent"]');

    const movedFocus=page.waitForResponse(response=>response.url().endsWith('/api/focus')&&response.request().postDataJSON()?.projectId==='other-project');
    await page.selectOption('[data-view="agent"] .agent-project-select','other-project');await page.click('[data-view="agent"] .move-agent-project');
    await page.locator('[data-view="agent"] .fresh-agent').waitFor();
    await movedFocus;

    assert.match(await page.locator('[data-view="agent"] .session-continuation').innerText(),/previous model context/);
    assert.equal(await page.locator('[data-view="agent"] .continue-agent').isVisible(),false);
    assert.equal(state.sessions[0].cwd,'/example','assignment cannot move the process directory');
    await page.click('#conductor-nav');assert.match(await page.locator('#chat-scope').innerText(),/Conductor · Local · focus: Another example/);
    assert.match(await page.locator('#chat-output').innerText(),/Explain this fixture task/,'changing project focus retains the owner conversation');
    await page.fill('#chat-input','Explain the current project');await page.click('#send-chat');
    await page.getByText('Explain the current project',{exact:true}).waitFor();
    const focusedChat=requests.filter(r=>r.path==='/api/coordinator').at(-1);assert.equal(focusedChat.body.projectId,'other-project');assert.equal(focusedChat.body.workSessionId,undefined);assert.equal(focusedChat.body.focus.agentId,'agent');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('focus:workspace:main')).projectId),'other-project');
    await page.click('#terminals [data-id="agent"]');
    await page.click('[data-view="agent"] .fresh-agent');
    const freshRequest=requests.find(r=>r.path==='/api/sessions'&&r.body.projectId==='other-project');assert.equal(freshRequest.body.cwd,'/another-example');assert.equal(freshRequest.body.historyId,undefined);assert.equal(freshRequest.body.task,'');
    await page.click('#terminals [data-id="external"]');
    await page.evaluate(()=>{window.copiedFixtureText='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedFixtureText=text;}}});});
    assert.equal(await page.locator('[data-view=external] textarea').count(),0);
    assert.equal(await page.locator('[data-view=external] .continue-agent').count(),0,'live external sessions cannot be duplicated');
    assert.equal(requests.some(r=>r.path==='/api/sessions/external/prompt'),false);
    assert.ok(requests.some(r=>r.path==='/api/focus'&&r.body.projectId==='other-project'));
    await page.click('#conductor-nav');
    await page.evaluate(()=>{window.copiedFixtureText='';});
    await page.locator('#chat-output [data-copy-message]').first().click();
    assert.equal(await page.evaluate(()=>window.copiedFixtureText),state.coordinator.history[0].answer);
    await page.locator('#chat-output [data-copy-code]').first().click();
    assert.equal(await page.evaluate(()=>window.copiedFixtureText),'{"ready": true}\n');
    await page.fill('#chat-input','Draft stays while filtering');
    state.hosts=['remote-example'];
    await page.waitForFunction(()=>document.querySelector('#environment option[value="remote-example"]'));
    await page.selectOption('#environment','remote-example');
    assert.equal(await page.locator('[data-view=conductor]').isVisible(),true);
    assert.match(await page.locator('#chat-scope').innerText(),/remote-example/);
    assert.equal(await page.inputValue('#chat-input'),'Draft stays while filtering');
    await page.selectOption('#environment','local');
    holdReply=true;
    await page.fill('#chat-input','Unconfirmed fixture request');
    const submitting=page.waitForRequest(r=>r.url().endsWith('/api/coordinator'));
    await page.click('#send-chat');await submitting;
    await page.fill('#chat-input','Newer draft while replying');
    const before=requests.filter(r=>r.path==='/api/coordinator').length;
    await page.locator('#chat-input').press('Enter');
    assert.equal(await page.inputValue('#chat-input'),'Newer draft while replying','busy Enter cannot discard the draft');
    assert.equal(requests.filter(r=>r.path==='/api/coordinator').length,before);
    releaseReply();holdReply=false;
    await page.locator('#chat-error').waitFor();
    assert.equal(await page.inputValue('#chat-input'),'Newer draft while replying','failure cannot overwrite newer text');
    await page.locator('#chat-error summary').click();
    await page.click('[data-restore-draft]');
    assert.equal(await page.inputValue('#chat-input'),'Newer draft while replying\n\nUnconfirmed fixture request');
    stateUnavailable=true;
    await page.locator('#service-status').waitFor();
    assert.match(await page.locator('#service-status').innerText(),/Fixture service unavailable/);
    assert.match(await page.inputValue('#chat-input'),/Newer draft while replying/);
    fixtureToken='fixture-replacement-token';stateUnavailable=false;
    await page.click('#retry-service');await page.locator('#service-status').waitFor({state:'hidden'});
    assert.match(await page.inputValue('#chat-input'),/Unconfirmed fixture request/);
    await page.reload();await page.locator('#chat-input').waitFor();await page.click('#management-menu>summary');
    assert.equal(await page.inputValue('#chat-input'),'Newer draft while replying\n\nUnconfirmed fixture request','draft survives reload');
    holdReply=true;createdReply={answer:'Created separate work.',nextScope:{workSessionId:'created',projectId:'project'},createdScopes:[{label:'Created work',scope:{workSessionId:'created',projectId:'project'}}]};
    await page.fill('#chat-input','Create separate work');const creating=page.waitForRequest(r=>r.url().endsWith('/api/coordinator'));await page.click('#send-chat');await creating;
    await page.selectOption('#working-session-select','saved');await page.fill('#chat-input','New draft while creation runs');
    state.workSessions.push({id:'created',title:'Created work',status:'active',projects:[]});releaseReply();holdReply=false;
    await page.getByRole('button',{name:'Open Created work in Conductor'}).waitFor();
    assert.equal(await page.inputValue('#working-session-select'),'saved','creation cannot overwrite a newer settings-owner selection');
    assert.equal(await page.inputValue('#chat-input'),'New draft while creation runs');
    createdReply={answer:'Project created.',nextScope:{projectId:'other-project'}};await page.fill('#chat-input','Create another project');await page.click('#send-chat');await page.waitForFunction(()=>document.querySelector('#chat-scope').textContent.includes('Another example'));
    createdReply=null;
    state.activity=[{id:'gone',kind:'conductor',target:'missing-agent',title:'Fixture event',text:'Original notice',at:new Date().toISOString()}];
    await page.click('#notifications-nav');await page.locator('[data-activity-event=gone]').waitFor();await page.click('[data-activity-event=gone]');assert.match(await page.locator('#activity-output').innerText(),/no longer available/);
    state.activity.push({id:'chat-event',kind:'conductor',target:'conductor',title:'Open chat',text:'Fixture chat event',at:new Date().toISOString()});
    await page.locator('[data-activity-event=chat-event]').waitFor();await page.click('[data-activity-event=chat-event]');assert.equal(await page.locator('#chat-input').isVisible(),true);
    state.history=Array.from({length:5000},(_,index)=>({id:'large-'+index,kind:'history',title:'Saved fixture '+index,provider:'codex',host:'local',cwd:'/fixture'}));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#history-count')?.textContent==='5000');await page.click('#management-menu>summary');
    assert.equal(await page.locator('#history-list .agent').count(),40);
    await page.locator('#history').evaluate(el=>el.open=true);await page.click('#more-history');
    assert.equal(await page.locator('#history-list .agent').count(),80);
    await page.fill('#sidebar-search','Saved fixture 4999');assert.equal(await page.locator('#history-list .agent').count(),1);assert.match(await page.locator('#history-list').innerText(),/4999/);
    await page.fill('#sidebar-search','');assert.equal(await page.locator('#history-list .agent').count(),40);
    console.log('Large inventory fixture',await page.evaluate(()=>({rows:document.querySelectorAll('#history-list .agent').length,nodes:document.querySelectorAll('*').length,readyMs:Math.round(performance.now())})));
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();for(const socket of sockets.clients)socket.terminate();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
});
