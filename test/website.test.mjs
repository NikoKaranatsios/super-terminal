import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const website=fileURLToPath(new URL('../website/',import.meta.url));
const assets=['index.html','styles.css','site.js','favicon.svg','robots.txt','sitemap.xml'];
const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.txt':'text/plain','.xml':'application/xml'};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const axeSource=process.env.SUPER_TERMINAL_AXE_SOURCE;

test('public demo supports session decisions, graph navigation and installation under production CSP',async t=>{
  const server=http.createServer(async(req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(name==='__test_axe.js'&&axeSource){res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile(axeSource));return;}
    if(!assets.includes(name)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',types[path.extname(name)]);res.setHeader('Content-Security-Policy',csp);
    res.end(await fs.readFile(path.join(website,name)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1080},permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce'});
  const page=await context.newPage(), errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))errors.push(message.text());});
  page.on('request',request=>{if(!request.url().startsWith(origin))external.push(request.url());});
  const reset=async()=>{await page.goto(origin);await page.locator('[data-session="review"]').waitFor();};
  const text=id=>page.locator('#'+id).textContent();
  try{
    await t.test('initial graph, facts and real parent relationships',async()=>{
      await reset();assert.equal(await page.locator('.agent-node').count(),5);
      assert.equal(await page.locator('.project-node').count(),2);
      assert.equal(await page.locator('.graph-edge.child[data-parent="menu"]').count(),1);
      assert.equal(await text('session-name'),'Keyboard review');
      assert.match(await text('session-checkout'),/review\/keyboard · worktree/);
      assert.equal(await page.locator('#terminal-entry').isVisible(),true);
      const ids=await page.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id));
      assert.equal(new Set(ids).size,ids.length);
      assert.deepEqual(await page.locator('a[href^="#"]').evaluateAll(nodes=>nodes.map(n=>n.hash).filter(hash=>!document.getElementById(hash.slice(1)))),[]);
    });
    await t.test('reply changes the question and counts without a model request',async()=>{
      await page.locator('[data-filter="question"]').click();
      await page.locator('#terminal-entry').fill('Return focus to the opening button.');
      await page.locator('#terminal-entry').press('Enter');
      assert.equal(await text('session-status'),'Working');
      assert.equal(await text('count-question'),'0');assert.equal(await text('count-working'),'3');
      assert.match(await text('terminal-output'),/Example reply received/);
      assert.equal(await page.locator('[data-session="review"]').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#canvas-viewport').isVisible(),true);
    });
    await t.test('session switching preserves drafts and view-only limits',async()=>{
      await reset();await page.locator('#terminal-entry').fill('Draft decision');
      await page.locator('#open-parent').click();assert.equal(await text('session-name'),'Command menu');
      await page.locator('[data-session="review"]').click();
      assert.equal(await text('terminal-entry'),'Draft decision');
      await page.locator('[data-session="notes"]').click();
      assert.equal(await page.locator('#terminal-prompt').isVisible(),false);
      assert.match(await text('terminal-access'),/View only/);
      await page.locator('[data-session="docs"]').click();
      assert.equal(await text('session-status'),'Finished turn');
      assert.match(await text('evidence-text'),/not independent task verification/);
    });
    await t.test('filters, search, recovery and worktree scenario',async()=>{
      await reset();await page.locator('[data-filter="working"]').click();
      assert.match(await text('result-count'),/^2 of 5/);
      await page.locator('[data-filter="all"]').click();
      await page.locator('#session-search').fill('beacon');assert.match(await text('result-count'),/^2 of 5/);
      await page.locator('#session-search').fill('no such session');
      assert.equal(await page.locator('#empty-results').isVisible(),true);
      await page.locator('#clear-filters').click();assert.match(await text('result-count'),/^5 sessions/);
      await page.locator('[data-scenario="worktree"]').click();
      assert.equal(await text('session-name'),'API tests');assert.match(await text('session-checkout'),/beacon\/.worktrees\/api/);
      await page.locator('[data-scenario="family"]').click();assert.equal(await text('session-name'),'Keyboard review');
    });
    await t.test('drag moves edges without opening the terminal; zoom, fit and keyboard work',async()=>{
      await reset();await page.locator('#workspace').scrollIntoViewIfNeeded();
      const tile=page.locator('[data-session="menu"] .node-tile'),box=await tile.boundingBox();
      const before=await page.locator('[data-session="menu"]').evaluate(el=>el.style.left);
      const edgeBefore=await page.locator('.graph-edge.child').getAttribute('d');
      await page.mouse.move(box.x+40,box.y+36);await page.mouse.down();await page.mouse.move(box.x+90,box.y+66,{steps:8});await page.mouse.up();
      assert.notEqual(await page.locator('[data-session="menu"]').evaluate(el=>el.style.left),before);
      assert.notEqual(await page.locator('.graph-edge.child').getAttribute('d'),edgeBefore);
      assert.equal(await text('session-name'),'Keyboard review');
      const zoom=await text('zoom-level');await page.locator('#zoom-in').click();assert.notEqual(await text('zoom-level'),zoom);
      await page.locator('#fit-graph').click();
      const view=await page.locator('#canvas-viewport').boundingBox(),panBefore=await page.locator('#canvas-world').getAttribute('style');
      await page.mouse.move(view.x+10,view.y+10);await page.mouse.down();await page.mouse.move(view.x+45,view.y+28,{steps:5});await page.mouse.up();
      assert.notEqual(await page.locator('#canvas-world').getAttribute('style'),panBefore);
      await page.locator('[data-session="menu"]').focus();await page.locator('[data-session="menu"]').press('ArrowRight');
      assert.equal(await page.locator('[data-session="review"]').evaluate(el=>el===document.activeElement),true);
      await page.locator('[data-session="review"]').press('Enter');
      assert.equal(await page.evaluate(()=>document.activeElement.id||document.activeElement.dataset.session),'terminal-entry');
      await page.locator('#terminal-entry').press('Escape');
      assert.equal(await page.locator('[data-session="review"]').evaluate(el=>el===document.activeElement),true);
    });
    await t.test('terminal commands, safe literal text and reset',async()=>{
      await reset();await page.locator('#terminal-entry').fill('<img src=x onerror=alert(1)>');await page.locator('#terminal-entry').press('Enter');
      assert.match(await text('terminal-output'),/<img src=x/);assert.equal(await page.locator('#terminal-output img').count(),0);
      await page.locator('#terminal-entry').fill('status');await page.locator('#terminal-entry').press('Enter');assert.match(await text('terminal-output'),/Keyboard review · Working/);
      await page.locator('#terminal-entry').fill('clear');await page.locator('#terminal-entry').press('Enter');assert.equal(await text('terminal-output'),'');
      await page.locator('#terminal-entry').fill('help');await page.locator('#terminal-entry').press('Enter');assert.match(await text('terminal-output'),/Demo commands/);
      await page.locator('#reset-demo').click();assert.equal(await text('session-status'),'Needs input');assert.equal(await text('count-question'),'1');
    });
    await t.test('installation copy and FAQ',async()=>{
      await page.locator('#copy-install').click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),(await text('install-commands')).trim());
      await page.getByText('Is this open source?',{exact:true}).click();
      await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Fixture denied clipboard');};});
      await page.locator('#copy-install').click();
      assert.match(await text('copy-status'),/Copy unavailable/);
      assert.equal(await page.evaluate(()=>getSelection().toString()),await text('install-commands'));
      assert.equal(await page.locator('details').first().getAttribute('open'),'');
      assert.match(await page.locator('details').first().textContent(),/license has not been specified/);
      await page.getByText('Is this open source?',{exact:true}).click();
    });
    await t.test('responsive navigation, screenshots and no horizontal page overflow',async()=>{
      await reset();
      const capture=process.env.SUPER_TERMINAL_WEBSITE_SCREENSHOTS;
      if(capture){await fs.mkdir(capture,{recursive:true});await page.screenshot({path:path.join(capture,'desktop-top.png')});await page.locator('#workspace').screenshot({path:path.join(capture,'desktop-workspace.png')});}
      for(const width of [1024,768,390,320]){
        await page.setViewportSize({width,height:900});
        await page.locator('#jump-session').selectOption('api');
        assert.equal(await text('session-name'),'API tests');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'page overflow at '+width);
        const view=await page.locator('#canvas-viewport').boundingBox(),node=await page.locator('[data-session="api"]').boundingBox();
        assert.ok(node.x>=view.x-1&&node.x+node.width<=view.x+view.width+1,'selected node visible at '+width);
        await page.locator('#jump-session').selectOption('notes');assert.equal(await page.locator('#terminal-prompt').isVisible(),false);
      }
      await page.setViewportSize({width:390,height:844});await page.locator('#reset-demo').click();
      if(capture){await page.screenshot({path:path.join(capture,'mobile-full.png'),fullPage:true});await page.locator('#workspace').screenshot({path:path.join(capture,'mobile-workspace.png')});}
    });
    await t.test('installation and feature content remain available without JavaScript',async()=>{
      const noScript=await browser.newContext({javaScriptEnabled:false});
      try{const fallback=await noScript.newPage();await fallback.goto(origin);assert.equal(await fallback.locator('.noscript').isVisible(),true);assert.equal(await fallback.locator('.workspace-body').isVisible(),false);assert.equal(await fallback.locator('#install-commands').isVisible(),true);}
      finally{await noScript.close();}
    });
    if(axeSource)await t.test('automated accessibility for wide, filtered and narrow views',async()=>{
      for(const width of [1440,390]){
        await page.setViewportSize({width,height:1000});await reset();
        await page.addScriptTag({url:origin+'/__test_axe.js'});
        for(const filter of ['all','question']){
          await page.locator('[data-filter="'+filter+'"]').click();
          const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
          assert.deepEqual(violations,[],width+'px '+filter);
        }
      }
    });
    await t.test('no external requests or script/CSP failures',()=>{
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    });
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
