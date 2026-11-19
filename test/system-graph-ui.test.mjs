import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {reviewFixture} from './fixtures/ui-review.mjs';

const chrome=[process.env.SUPER_TERMINAL_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath(),'/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
test('system graph exposes live work, prompts, messages, navigation and failures while retaining focus',{skip:!chrome,timeout:90000},async()=>{
  const fixture=await reviewFixture();let browser;const errors=[];
  fixture.state.sessions[0].initialPrompt={text:'Original task: check the fixture.\n<script>unsafe()</script>',recordedAt:'2026-01-01T12:00:00Z'};
  fixture.state.background.mcp={state:'available',mode:'per-agent stdio',clients:[{agentId:'agent',transport:'mcp',command:'report',lastStatus:'responded',active:0}]};
  fixture.state.coordinator.running=true;fixture.state.coordinator.phase='Checking fixture work';fixture.state.coordinator.loop.state='running';
  fixture.state.coordinator.history.push({id:'live',status:'running',prompt:'Verify the fixture behavior.',trace:[{type:'item.started',name:'command_execution',itemId:'cmd',command:'npm test',seq:1}],actions:[{action:{type:'message_agent',target:'agent',text:'Report evidence'},status:'started'}]});
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}});page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.url);await page.click('#sessions-nav');await page.locator('.sessions-heading').waitFor();await page.click('#management-menu>summary');await page.click('#conductor-nav');await page.locator('#chat-input').waitFor();await page.click('#system-graph-nav');
    await page.locator('.graph-node[data-graph-node="mcp"]').waitFor();
    assert.match(await page.locator('#conductor-presence').innerText(),/working/);
    assert.match(await page.locator('.graph-inspector').innerText(),/Verify the fixture behavior/);
    assert.match(await page.locator('.graph-inspector').innerText(),/npm test/);
    await page.locator('.graph-node[data-graph-node="agent:agent"]').click();
    await page.locator('[data-graph-detail="prompt"] summary').click();
    assert.match(await page.locator('.graph-inspector').innerText(),/Original task: check the fixture/);assert.equal(await page.locator('.graph-inspector script').count(),0);
    assert.match(await page.locator('.graph-inspector').innerText(),/Review complete/);
    await page.locator('[aria-label="Search system graph"]').fill('Implementation reviewer');
    await page.locator('[aria-label="Search system graph"]').focus();
    fixture.state.sessions[0].status='paused';
    await page.waitForFunction(()=>document.querySelector('[data-graph-node="agent:agent"] .graph-node-status')?.textContent==='paused');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Search system graph');
    assert.equal(await page.locator('[data-graph-detail="prompt"]').getAttribute('open'),'');
    await page.locator('.graph-open').click();await page.locator('[data-view="agent"] > .terminal').waitFor();
    await page.click('#system-graph-nav');assert.equal(await page.inputValue('[aria-label="Search system graph"]'),'Implementation reviewer');
    await page.locator('[data-graph-clear]').click();await page.locator('.graph-node[data-graph-node="agent:external"]').click();
    await page.getByText('The saved review is available.',{exact:false}).waitFor();
    await page.locator('[data-graph-detail="prompt"] summary').click();assert.match(await page.locator('.graph-inspector').innerText(),/original launch prompt was not captured/);
    await page.locator('[data-graph-open="history"]').click();await page.locator('[data-view="history"]').waitFor();
    await page.click('#system-graph-nav');await page.locator('[data-graph-select="mcp"]').count();
    await page.locator('.graph-node[data-graph-node="mcp"]').click();assert.match(await page.locator('.graph-inspector').innerText(),/st_conductor/);
    await page.locator('[data-graph-reset]').click();await page.locator('[data-graph-zoom="-1"]').click();assert.equal(await page.locator('[data-graph-reset]').innerText(),'83%');
    await page.locator('[data-graph-reset]').click();assert.equal(await page.locator('[data-graph-reset]').innerText(),'100%');
    await page.selectOption('.graph-project','project');await page.locator('[data-graph-fit]').click();
    if(process.env.SUPER_TERMINAL_GRAPH_CAPTURE){fs.mkdirSync(process.env.SUPER_TERMINAL_GRAPH_CAPTURE,{recursive:true});await page.screenshot({path:path.join(process.env.SUPER_TERMINAL_GRAPH_CAPTURE,'system-graph-wide.png')});}
    for(const [width,height] of [[800,500],[400,500],[320,568]]){await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));assert.ok(await page.locator('.graph-inspector').evaluate(el=>el.clientHeight>0));}
    if(process.env.SUPER_TERMINAL_GRAPH_CAPTURE)await page.screenshot({path:path.join(process.env.SUPER_TERMINAL_GRAPH_CAPTURE,'system-graph-narrow.png')});
    await page.setViewportSize({width:1440,height:960});await page.selectOption('#environment','remote-fixture');await page.waitForFunction(()=>document.querySelector('.graph-environment')?.textContent.includes('Remote example'));
    assert.equal(await page.locator('[data-graph-node="agent:agent"]').count(),0);assert.equal(await page.locator('[data-graph-node="agent:lost"]').count(),1);
    await page.route('**/api/state?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture source disconnected'})}));
    await page.locator('.graph-offline').waitFor();assert.match(await page.locator('.graph-offline').innerText(),/last received state/);
    await page.unroute('**/api/state?*');await page.click('#retry-service');await page.waitForFunction(()=>!document.querySelector('.graph-offline'));
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});
