import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {reviewFixture} from './fixtures/ui-review.mjs';
import {sandboxPolicy} from '../server/sandbox-policy.mjs';

const chrome=[process.env.SUPER_TERMINAL_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath(),'/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
test('isolated team UI exposes limits, lineage, runtime controls and browser errors without losing drafts',{skip:!chrome,timeout:90000},async()=>{
  const fixture=await reviewFixture();let browser;const errors=[],capture=process.env.SUPER_TERMINAL_RUNTIME_CAPTURE;
  async function accessibility(page){if(!process.env.SUPER_TERMINAL_AXE_SOURCE)return;if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:process.env.SUPER_TERMINAL_AXE_SOURCE});const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);}
  const team=fixture.state.teams[0];team.runtime=sandboxPolicy({delegation:true});team.runtimeLaunches=2;
  const parent=fixture.state.sessions[0];parent.execution={kind:'container',state:'running',workspace:'/workspace/repo',baseCommit:'0123456789abcdef',image:'super-terminal-agent:1',engine:'docker',networkMode:'restricted'};
  fixture.state.sessions.push({...parent,id:'helper',title:'Review keyboard behavior',role:'Keyboard reviewer',parentAgentId:parent.id,delegationDepth:1});
  team.delegations=[{id:'pending',parentAgentId:parent.id,role:'Additional reviewer',status:'failed',error:'Concurrent-agent allowance reached. Reuse an existing peer.'}];
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(fixture.url);await page.click('#sessions-nav');await page.locator('.sessions-heading').waitFor();await page.click('#management-menu>summary');await page.click('#conductor-nav');await page.click('#teams-nav');await page.locator('.team-agent-list').waitFor();
    assert.match(await page.locator('[data-view="teams"]').innerText(),/Isolated Linux/);assert.match(await page.locator('[data-view="teams"]').innerText(),/2 \/ 12 launches/);assert.match(await page.locator('[data-view="teams"]').innerText(),/Concurrent-agent/);
    await page.locator('.team-runtime-policy summary').click();assert.match(await page.locator('.team-runtime-policy').innerText(),/registry.npmjs.org/);
    await accessibility(page);
    if(capture){fs.mkdirSync(capture,{recursive:true});await page.screenshot({path:path.join(capture,'teams-wide.png')});}
    await page.locator('[data-work-view="runtime:helper"]').click();await page.locator('[data-view="runtime:helper"]').waitFor();assert.match(await page.locator('[data-view="runtime:helper"]').innerText(),/Requested by/);
    await page.fill('[data-runtime-url]','http://localhost:3000');
    await page.route('**/api/browser/helper',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Preview is not running. Start its server in the runtime terminal.'})}));
    await page.locator('[data-runtime-browser] button[type="submit"]').click();await page.getByText('Preview is not running.',{exact:false}).waitFor();assert.equal(await page.inputValue('[data-runtime-url]'),'http://localhost:3000');
    fixture.state.sessions.find(s=>s.id==='helper').status='paused';await page.getByRole('button',{name:'Resume runtime',exact:true}).waitFor();assert.equal(await page.inputValue('[data-runtime-url]'),'http://localhost:3000');
    assert.equal(await page.locator('[data-runtime-url]').isDisabled(),true);
    await accessibility(page);
    if(capture)await page.screenshot({path:path.join(capture,'runtime-wide.png')});
    for(const [width,height] of [[800,500],[400,500],[320,568]]){await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));assert.ok(await page.locator('[data-view="runtime:helper"] .work-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));}
    if(capture)await page.screenshot({path:path.join(capture,'runtime-narrow.png')});
    Object.assign(fixture.state.sessions.find(s=>s.id==='helper'),{status:'unknown',enrollmentRevokedAt:'fixture',lastControl:{ok:false,results:[{error:'Stop was not confirmed. Retry when the engine is available.'}]}});await page.getByRole('button',{name:'Retry stop',exact:true}).waitFor();assert.match(await page.locator('.runtime-error').innerText(),/Stop was not confirmed/);assert.equal(await page.getByRole('button',{name:'Resume runtime',exact:true}).count(),0);
    await page.setViewportSize({width:1440,height:1000});await page.click('#system-graph-nav');await page.locator('[data-graph-node="sandbox:helper"]').click();assert.match(await page.locator('.graph-inspector').innerText(),/Private home/);await page.locator('.graph-open').click();await page.locator('[data-view="runtime:helper"]').waitFor();
    await page.click('#teams-nav');await page.getByRole('button',{name:'Configure in Conductor',exact:false}).click();assert.match(await page.inputValue('#chat-input'),/runtime and helper allowance/);assert.equal(fixture.requests.filter(r=>r.path==='/api/coordinator').length,0,'configuration opens a draft, never silently submits it');
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});
