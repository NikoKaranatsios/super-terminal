import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {reviewFixture} from './fixtures/ui-review.mjs';
const chrome=[process.env.SUPER_TERMINAL_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath(),'/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));

test('sessions home filters all environments and sends native terminal keys without a composer',{skip:!chrome,timeout:60000},async()=>{
  const fixture=await reviewFixture();let browser;const errors=[];
  Object.assign(fixture.state.sessions[0],{model:'gpt-fixture',modelSource:'provider-index',tty:'ttys001'});
  Object.assign(fixture.state.sessions[2],{status:'running',connectionLost:false,model:'claude-remote',provider:'claude'});
  try {
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1280,height:850}});page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.url);await page.click('#sessions-nav');await page.locator('.sessions-heading').waitFor();
    assert.equal(await page.locator('#environment').inputValue(),'all');
    assert.equal(await page.locator('.sessions-table tbody tr').count(),4);
    assert.equal(await page.locator('#conductor-nav').isVisible(),false);
    assert.equal(await page.locator('#terminals [data-id=stopped]').count(),0);assert.equal(await page.locator('#terminals [data-id=service]').count(),0);
    await page.fill('#sidebar-search','gpt-fixture');assert.equal(await page.locator('.sessions-table tbody tr').count(),1);
    assert.match(await page.locator('.sessions-table').innerText(),/Example project/);
    await page.fill('#sidebar-search','');
    if(process.env.SUPER_TERMINAL_SESSIONS_CAPTURE){fs.mkdirSync(process.env.SUPER_TERMINAL_SESSIONS_CAPTURE,{recursive:true});await page.screenshot({path:process.env.SUPER_TERMINAL_SESSIONS_CAPTURE+'/sessions-wide.png'});}
    await page.click('.sessions-table [data-id=agent]');await page.waitForFunction(()=>document.activeElement.matches('.xterm-helper-textarea'));
    assert.equal(await page.locator('.agent-message').count(),0);assert.match(await page.locator('[data-view=agent] .agent-context').innerText(),/gpt-fixture/);
    await page.keyboard.type('native input');await page.keyboard.press('Enter');await page.keyboard.press('Control+c');
    await page.waitForTimeout(100);assert.equal(fixture.terminalInput.filter(row=>row.id==='agent').map(row=>row.data).join(''),'native input\r\x03');
    assert.equal(fixture.requests.filter(row=>row.path.endsWith('/prompt')).length,0);
    await page.click('#sessions-home');await page.click('.sessions-table [data-id=lost]');await page.waitForFunction(()=>document.activeElement.matches('.xterm-helper-textarea'));
    assert.equal(await page.locator('#environment').inputValue(),'all','opening a remote session must not hide local sessions');
    await page.click('[data-tab=agent]');assert.equal(await page.evaluate(()=>document.activeElement.matches('.xterm-helper-textarea')),true);
    fixture.state.sessions[0].model='gpt-switched';await page.waitForFunction(()=>document.querySelector('[data-view=agent] .terminal-model')?.textContent.includes('gpt-switched'));
    assert.equal(await page.evaluate(()=>document.activeElement.matches('.xterm-helper-textarea')),true,'polling preserves terminal keyboard focus');
    await page.click('#terminals [data-id=external]');assert.equal(await page.locator('[data-view=external] textarea').count(),0);assert.equal(await page.locator('[data-view=external] .continue-agent').count(),0);
    await page.click('#sessions-home');await page.selectOption('#environment','local');assert.equal(await page.locator('.sessions-table tbody tr').count(),3);
    await page.click('[data-session-new]');assert.equal(await page.locator('#new-session-dialog').isVisible(),true);await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(fixture.requests.filter(row=>row.path==='/api/sessions').length,0);
    await page.click('#management-menu>summary');await page.click('#conductor-nav');assert.equal(await page.locator('#chat-input').isVisible(),true);
    await page.click('#sessions-home');await page.setViewportSize({width:800,height:500});assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));
    if(process.env.SUPER_TERMINAL_SESSIONS_CAPTURE)await page.screenshot({path:process.env.SUPER_TERMINAL_SESSIONS_CAPTURE+'/sessions-compact.png'});
    await page.setViewportSize({width:400,height:700});assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});
