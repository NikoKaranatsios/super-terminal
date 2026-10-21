import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const chrome = [process.env.SUPER_TERMINAL_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));

test('fixture renderer keeps work records, process controls, task views, chat scope and paged output distinct', {skip:!chrome}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-ui-'));
  await build({entryPoints:['src/app.js'],bundle:true,format:'esm',outfile:path.join(dir,'app.js'),logLevel:'silent'});
  const state={
    hosts:[],hostNames:{},remote:[],preferences:{fontSize:13,automaticBriefing:false,notifyOnFinish:false},activity:[],messages:[],prompts:{codex:'',claude:'',grok:''},defaultCwd:'/example',
    coordinator:{running:false,history:[],assessments:{},loop:{state:'stopped'}},
    projects:[{id:'project',name:'Example project',host:'local',cwd:'/example'}],
    tasks:[{id:'task',projectId:'project',title:'Verify example output',status:'doing',notes:'Run the fixture check.',evidence:['Fixture evidence'],agentId:'agent',scope:{workSessionId:'work',projectId:'legacy-project',goalId:'task'}}],
    workSessions:[{id:'work',title:'Example work',status:'active',projects:[]},{id:'saved',title:'Saved work',status:'wrapped',projects:[]}],
    teams:[{id:'team',name:'Example team',mission:'Check the fixture',cwd:'/example',host:'local'}],
    sessions:[{id:'agent',title:'codex · terminal',role:'Fixture reviewer',provider:'codex',kind:'managed',status:'running',host:'local',cwd:'/example',group:'Example team',scope:{workSessionId:'work',projectId:'legacy-project',goalId:'task'}}],
    history:[{id:'history',kind:'history',title:'Saved fixture',provider:'codex',host:'local',cwd:'/example'}]
  };
  for(const status of ['todo','blocked','done','stopped'])state.tasks.push({id:status,projectId:'project',title:`Example ${status} task`,status,notes:status==='blocked'?'Waiting for fixture evidence.':'',evidence:[],scope:{workSessionId:'work',projectId:'legacy-project',goalId:status}});
  let recent=0,historyUnavailable=false;const requests=[],errors=[];
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
      requests.push({path:url.pathname,method:req.method,body});let result={ok:true};
      if(url.pathname==='/api/state')result=state;
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
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const page=await browser.newPage({viewport:{width:1150,height:820}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#working-session-select').waitFor();
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
    await page.waitForSelector('[data-agent-prompt]:not([disabled])');
    await page.click('[data-agent-prompt]');await page.fill('.agent-prompt input','Fixture prompt only');await page.click('.agent-prompt [type="submit"]');
    await page.waitForFunction(()=>document.querySelector('.agent-prompt').hidden);
    assert.equal(requests.find(r=>r.path==='/api/sessions/agent/prompt').body.text,'Fixture prompt only');
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
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
});
