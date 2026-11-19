import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {reviewFixture} from './fixtures/ui-review.mjs';

const chrome=[process.env.SUPER_TERMINAL_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath(),'/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
const capture=process.env.SUPER_TERMINAL_UI_REVIEW_CAPTURE,axeSource=process.env.SUPER_TERMINAL_AXE_SOURCE;
async function navigate(page,selector) {
  if(!await page.locator(selector).first().isVisible()) {
    const toggle=page.locator('#toggle-sidebar');
    if(await toggle.isVisible())await toggle.click();
  }
  await page.locator(selector).first().click();
}

test('UI review covers every main surface, contrast and constrained layouts',{skip:!chrome},async()=>{
  const fixture=await reviewFixture();let browser;const findings=[],errors=[];
  const baseline=process.env.SUPER_TERMINAL_UI_REVIEW_BASELINE==='1';
  try {
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const page=await browser.newPage({viewport:{width:1280,height:850}});page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.url);await page.click('#sessions-nav');await page.locator('.sessions-heading').waitFor();await page.click('#management-menu>summary');await page.click('#conductor-nav');await page.locator('#chat-input').waitFor();
    const screens=[['conductor','#conductor-nav'],['graph','#system-graph-nav'],['overview','#overview-nav'],['project','[data-work-view="project:project"]'],['task','[data-work-view="task:task-0"]'],['teams','#teams-nav'],['messages','#team-messages-nav'],['agent','#terminals [data-id="agent"]'],['saved','#terminals [data-id="external"]'],['settings','#settings-nav'],['activity','#notifications-nav'],['docs','#docs-nav']];
    for(const [name,selector] of screens) {
      await page.setViewportSize({width:1280,height:850});await navigate(page,selector);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      if(axeSource) {
        if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:axeSource});
        const result=await page.evaluate(async()=>{const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
        findings.push({screen:name,violations:result});
      }
      for(const [label,width,height] of [['wide',1280,850],['small',800,500],['zoom',640,425],['compact-zoom',400,250],['reflow',320,568]]) {
        await page.setViewportSize({width,height});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        if(capture){fs.mkdirSync(capture,{recursive:true});await page.screenshot({path:path.join(capture,name+'-'+label+'.png')});}
        const dimensions=await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth,content:[...document.querySelectorAll('.view:not([hidden])')].map(el=>({width:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight})),main:document.querySelector('#main').clientWidth}));
        findings.push({screen:name,size:label,dimensions});
        if(!baseline){assert.ok(dimensions.body<=width+1,name+' must not overflow the window');assert.ok(dimensions.main>=Math.min(width,300),name+' must retain useful content width');assert.ok(dimensions.content.every(c=>c.width>0&&c.height>0),name+' must remain visible');}
      }
    }
    if(capture)fs.writeFileSync(path.join(capture,'audit.json'),JSON.stringify(findings,null,2));
    const violations=findings.filter(f=>f.violations?.length);
    console.log('UI accessibility findings',JSON.stringify(violations));
    if(!baseline)assert.deepEqual(violations,[]);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});

test('UI keeps drafts, failed settings, filters and keyboard focus intact',{skip:!chrome},async()=>{
  const fixture=await reviewFixture();let browser;const errors=[];
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1280,height:850}});page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.url);await page.click('#sessions-nav');await page.locator('.sessions-heading').waitFor();await page.click('#management-menu>summary');await page.click('#conductor-nav');await page.locator('#chat-input').waitFor();
    await navigate(page,'#settings-nav');await page.fill('#prompt-codex','An unsaved startup draft.');
    await navigate(page,'#conductor-nav');await navigate(page,'#settings-nav');assert.equal(await page.inputValue('#prompt-codex'),'An unsaved startup draft.');
    await page.locator('[data-close="settings"]').click();await navigate(page,'#settings-nav');assert.equal(await page.inputValue('#prompt-codex'),'An unsaved startup draft.');
    await page.reload();await page.locator('#prompt-codex').waitFor();assert.equal(await page.inputValue('#prompt-codex'),'An unsaved startup draft.');
    fixture.flags.failPrompt=true;await page.click('#save-prompts');await page.waitForFunction(()=>document.querySelector('#saved').textContent.includes('Not saved:'));assert.equal(await page.inputValue('#prompt-codex'),'An unsaved startup draft.');
    fixture.flags.failPrompt=false;await page.click('#save-prompts');await page.waitForFunction(()=>document.querySelector('#saved').textContent==='Saved.');assert.equal(fixture.state.prompts.codex,'An unsaved startup draft.');assert.equal(await page.locator('#save-prompts').isDisabled(),true);
    fixture.flags.failPreference=true;await page.selectOption('#font-size','18');await page.waitForFunction(()=>document.querySelector('#preference-status').textContent.includes('Not saved:'));assert.equal(await page.inputValue('#font-size'),'13');
    await page.click('#notify-finish');await page.waitForFunction(()=>!document.querySelector('#notify-finish').disabled);assert.equal(await page.locator('#notify-finish').isChecked(),false);
    fixture.flags.failPreference=false;await page.selectOption('#font-size','16');await page.waitForFunction(()=>document.querySelector('#preference-status').textContent==='Saved.');assert.equal(fixture.state.preferences.fontSize,16);
    await navigate(page,'#terminals [data-id="agent"]');assert.equal(await page.locator('.agent-message').count(),0);await page.locator('[data-close="agent"]').click();await navigate(page,'#terminals [data-id="agent"]');
    await page.reload();await page.locator('.view:not([hidden]) > .terminal').waitFor();await page.click('#management-menu>summary');
    await navigate(page,'#overview-nav');await page.fill('[data-work-search]','workspace-79');assert.equal(await page.locator('.project-strip').count(),1);assert.match(await page.locator('.project-strip').innerText(),/workspace-79/);
    await page.fill('[data-work-search]','');await page.selectOption('#environment','remote-fixture');assert.equal(await page.locator('.project-strip').count(),1);assert.match(await page.locator('.project-strip').innerText(),/Another project/);
    await page.selectOption('#environment','local');await page.locator('[data-work-filter]').focus();fixture.state.tasks.push({id:'new-task',projectId:'project',title:'A new fixture task',status:'todo'});await page.locator('[data-task-square="new-task"]').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-work-filter')),true,'polling retains focus on the working-session filter');
    await navigate(page,'[data-work-view="project:project"]');assert.equal(await page.locator('.work-table tbody tr').count(),6);assert.ok(await page.locator('.work-table tbody tr').first().evaluate(el=>el.offsetHeight)<110);
    await page.selectOption('[data-task-status]','blocked');assert.equal(await page.locator('.work-table tbody tr').count(),1);await page.fill('[data-work-search]','nothing matches');assert.match(await page.locator('.work-empty').innerText(),/No tasks match/);
    await page.selectOption('#environment','remote-fixture');assert.equal(await page.locator('#terminals [data-id="lost"]').count(),1);assert.match(await page.locator('#terminals [data-id="lost"]').innerText(),/Unverified/);
    await page.selectOption('#environment','local');await page.click('[data-sidebar-section="stopped"] summary');assert.equal(await page.locator('#other-sessions [data-id="stopped"]').isVisible(),true);
    await page.click('[data-sidebar-section="services"] summary');await page.click('#other-sessions [data-id="service"]');assert.equal(await page.locator('[data-view="service"] .agent-message').isVisible(),false);assert.match(await page.locator('[data-view="service"] .output').innerText(),/Background service/);
    const tab=page.locator('[role="tab"][aria-selected="true"]');await tab.focus();await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'session-graph');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'sessions');await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'service');await page.keyboard.press('Delete');assert.equal(await page.locator('[data-tab="service"]').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'tab');
    await page.setViewportSize({width:400,height:250});assert.equal(await page.locator('#sidebar').isVisible(),false);await page.click('#toggle-sidebar');assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'),'true');assert.equal(await page.evaluate(()=>document.querySelector('#main').inert),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.querySelector('#sidebar').contains(document.activeElement)&&document.activeElement.id!=='close-sidebar'),true);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'close-sidebar');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'toggle-sidebar');
    await page.click('#toggle-sidebar');await page.click('#docs-nav');assert.equal(await page.locator('#sidebar').isVisible(),false);assert.equal(await page.locator('[data-view="docs"]').isVisible(),true);assert.equal(await page.evaluate(()=>document.querySelector('#main').inert),false);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});

test('opening chats focuses their composer and team messages stay within the selected membership',{skip:!chrome},async()=>{
  const fixture=await reviewFixture();let browser;const errors=[];
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1150,height:820}});page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.url);await page.click('#sessions-nav');await page.locator('.sessions-heading').waitFor();await page.click('#management-menu>summary');await page.click('#conductor-nav');await page.locator('#chat-input').waitFor();
    await navigate(page,'#terminals [data-id="agent"]');await page.waitForFunction(()=>document.activeElement.matches('.xterm-helper-textarea'));
    assert.equal(await page.locator('.agent-message').count(),0);
    await navigate(page,'#conductor-nav');assert.equal(await page.evaluate(()=>document.activeElement.id),'chat-input');
    await page.locator('[data-tab="agent"]').click();assert.equal(await page.evaluate(()=>document.activeElement.matches('.xterm-helper-textarea')),true);
    await navigate(page,'#terminals [data-id="external"]');assert.equal(await page.locator('[data-view=external] textarea').count(),0);
    await navigate(page,'#teams-nav');await page.locator('[data-team="team"]').click();assert.equal(await page.evaluate(()=>document.activeElement.matches('.team-compose textarea')),true);
    const form=page.locator('.view:not([hidden]) .team-compose');assert.equal(await form.locator('select[name=recipient]').inputValue(),'agent');assert.equal(await form.locator('select[name=recipient] option').count(),2,'only the selected team member with a mailbox is offered');
    await page.keyboard.type('A team message draft.');await page.locator('[data-close="messages:team"]').click();await navigate(page,'#teams-nav');await page.locator('[data-team="team"]').click();assert.equal(await form.locator('textarea').inputValue(),'A team message draft.');
    fixture.flags.failMessage=true;await form.locator('button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('.view:not([hidden]) .team-compose-status').textContent.includes('not confirmed queued'));assert.equal(await form.locator('textarea').inputValue(),'A team message draft.');
    fixture.flags.failMessage=false;fixture.flags.promptDelayMs=250;await form.locator('button[type=submit]').click();await form.locator('textarea').fill('A second draft while the first is queueing.');await page.waitForFunction(()=>document.querySelector('.view:not([hidden]) .team-compose-status').textContent.startsWith('Queued for'));assert.equal(await form.locator('textarea').inputValue(),'A second draft while the first is queueing.');assert.equal(fixture.state.messages.at(-1).to,'agent');assert.equal(fixture.state.messages.at(-1).text,'A team message draft.');
    assert.match(await page.locator('.view:not([hidden]) .team-output').innerText(),/A team message draft/);await page.fill('.view:not([hidden]) .message-search','no matching phrase');assert.match(await page.locator('.view:not([hidden]) .team-output').innerText(),/No messages match/);
    await page.reload();await page.locator('.view:not([hidden]) .team-compose textarea').waitFor();assert.equal(await page.inputValue('.view:not([hidden]) .team-compose textarea'),'A second draft while the first is queueing.');
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});
