import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {Workspace} from '../src/workspace.mjs';
import {sessionGraph} from '../src/session-graph.mjs';
import {reviewFixture,reviewState} from './fixtures/ui-review.mjs';
const chrome=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath()].find(p=>fs.existsSync(p));
test('graph groups repository worktrees, distinguishes environments and filters ordinary shells',()=>{
  const state=reviewState();Object.assign(state.sessions[0],{projectGroupId:'project',projectId:'legacy-tree',worktreeRoot:'/worktree',branch:'review',model:'model-fixture'});
  const graph=sessionGraph(state);assert.equal(graph.sessions,3);assert.equal(graph.nodes.find(n=>n.id==='agent').project,'Example project');assert.equal(graph.nodes.find(n=>n.id==='agent').checkout,'Worktree · review');
  assert.equal(sessionGraph(state,'all','model-fixture').sessions,1);assert.equal(sessionGraph(state,'all','','',1,false).sessions,4);
});
test('opening graph sessions preserves the graph and reuses terminal panes and tabs',()=>{
  const workspace=new Workspace();workspace.open('existing');workspace.open('session-graph');workspace.openBeside('session-graph','existing');
  assert.equal(workspace.panes().length,2);assert.equal(workspace.panes()[0].active,'session-graph');assert.equal(workspace.current().active,'existing');
  workspace.openBeside('session-graph','other');workspace.openBeside('session-graph','existing');assert.equal(workspace.panes().length,2);assert.equal(workspace.panes().flatMap(p=>p.tabs).filter(id=>id==='existing').length,1);
  const saved=new Workspace(workspace.serialize());assert.equal(saved.panes()[0].active,'session-graph');assert.equal(saved.current().active,'existing');
});
test('graph is the default workspace and a single node click opens a native terminal beside it',{skip:!chrome,timeout:60000},async()=>{
  const fixture=await reviewFixture();let browser;const errors=[];
  Object.assign(fixture.state.sessions[0],{model:'model-fixture',branch:'feature/review',worktreeRoot:'/example/.worktrees/review'});
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1500,height:950}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(fixture.url);await page.locator('[data-view=session-graph] .sg-session').first().waitFor();
    assert.equal(await page.locator('[data-view=session-graph]').isVisible(),true);assert.equal(await page.locator('#management-menu').getAttribute('open'),null);
    assert.equal(await page.locator('[data-session-node]').count(),3);assert.match(await page.locator('[data-session-node=agent]').innerText(),/model-fixture/);assert.match(await page.locator('[data-session-node=agent]').innerText(),/Worktree · feature\/review/);
    await page.fill('[aria-label="Search session graph"]','feature/review');assert.equal(await page.locator('[data-session-node]').count(),1);await page.fill('[aria-label="Search session graph"]','');
    await page.click('[data-session-node=agent]');await page.waitForFunction(()=>document.activeElement.matches('.xterm-helper-textarea'));
    assert.equal(await page.locator('.pane').count(),2);assert.equal(await page.locator('[data-view=session-graph]').isVisible(),true);assert.equal(await page.locator('[data-view=agent]').isVisible(),true);assert.equal(await page.locator('.agent-message').count(),0);
    await page.keyboard.type('native graph input');await page.keyboard.press('Enter');await page.waitForTimeout(100);assert.equal(fixture.terminalInput.map(r=>r.data).join(''),'native graph input\r');
    await page.click('[data-session-node=external]');await page.locator('[data-view=external]').waitFor();assert.equal(await page.locator('[data-view=session-graph]').isVisible(),true);assert.equal(await page.locator('[data-view=external] textarea').count(),0);
    await page.click('[data-session-node=agent]');assert.equal(await page.locator('.pane').count(),2);assert.equal(await page.locator('[data-tab=agent]').count(),1);
    await page.locator('[data-session-node=agent]').focus();await page.keyboard.press('ArrowDown');assert.notEqual(await page.evaluate(()=>document.activeElement.dataset.sessionNode),'agent');await page.keyboard.press('Enter');assert.equal(await page.locator('[data-view=session-graph]').isVisible(),true);
    await page.click('.sg-agent-filter');assert.equal(await page.locator('[data-session-node=shell]').count(),1);await page.click('.sg-agent-filter');
    await page.locator('[data-session-node=agent]').focus();fixture.state.sessions[0].status='paused';await page.waitForFunction(()=>document.querySelector('[data-session-node=agent]').dataset.state==='paused');assert.equal(await page.evaluate(()=>document.activeElement.dataset.sessionNode),'agent');
    await page.click('[data-sg-project]');assert.ok(await page.locator('[data-session-node]').count()<3);await page.selectOption('[aria-label="Session graph project"]','');
    const at=new Date().toISOString();fixture.state.history[0].sessionId='parent-native';fixture.state.history.push({id:'child-output',sessionId:'child-native',parentSessionId:'parent-native',provider:'claude',host:'local',cwd:'/example',kind:'history',title:'Inspect navigation',agentActivity:{state:'waiting',at,question:'Which navigation option?'}});
    await page.waitForFunction(()=>document.querySelector('[data-session-node="child-output"]'));
    assert.match(await page.locator('[data-session-node="child-output"]').innerText(),/Needs input/);assert.match(await page.locator('[data-session-node="child-output"]').innerText(),/Which navigation option/);assert.match(await page.locator('[data-session-node="child-output"]').innerText(),/↳/);
    await page.click('[data-sg-signal=attention]');assert.equal(await page.locator('[data-session-node]').count(),2,'Question filter retains the parent context');
    await page.click('[data-session-node="child-output"]');assert.equal(await page.locator('[data-view="child-output"]').isVisible(),true);assert.equal(await page.locator('[data-view="child-output"] textarea').count(),0);
    fixture.state.history.at(-1).agentActivity={state:'finished',at:new Date().toISOString(),detail:'Provider finished a turn.'};
    await page.click('[data-sg-signal=finished]');await page.waitForFunction(()=>document.querySelector('[data-session-node="child-output"]')?.textContent.includes('Just finished'));
    await page.click('[data-sg-signal=""]');
    fixture.state.history.at(-1).agentActivity={state:'finished',at:'2020-01-01T00:00:00Z'};
    await page.waitForFunction(()=>!document.querySelector('[data-session-node="child-output"]'));
    await page.click('[data-sg-expand=external]');await page.locator('[data-session-node="child-output"]').waitFor();
    await page.locator('[data-sg-expand=external]').focus();await page.waitForTimeout(5500);assert.equal(await page.evaluate(()=>document.activeElement.dataset.sgExpand),'external','fold control retains focus during refresh');
    if(process.env.SUPER_TERMINAL_GRAPH_CAPTURE){fs.mkdirSync(process.env.SUPER_TERMINAL_GRAPH_CAPTURE,{recursive:true});await page.screenshot({path:process.env.SUPER_TERMINAL_GRAPH_CAPTURE+'/agent-graph.png'});}
    assert.equal(fixture.requests.filter(r=>r.path==='/api/sessions'||r.path.endsWith('/prompt')).length,0,'node navigation must never launch or prompt an agent');
    await page.reload();await page.locator('[data-view=session-graph]').waitFor();assert.equal(await page.locator('.pane').count(),2);
    await page.setViewportSize({width:800,height:500});assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});
