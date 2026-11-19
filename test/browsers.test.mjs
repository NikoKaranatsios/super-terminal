import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { AgentBrowsers } from '../server/browsers.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture() {
  const context=new EventEmitter();let pages=[];
  Object.assign(context,{route:async()=>{},routeWebSocket:async()=>{},setDefaultTimeout(){},pages:()=>pages.filter(p=>!p.closed),newPage:async()=>{
    const page=new EventEmitter();Object.assign(page,{closed:false,isClosed:()=>page.closed,url:()=>page.address||'about:blank',goto:async url=>{page.address=url;},waitForLoadState:async()=>{},title:async()=>'',locator:()=>({ariaSnapshot:async()=>page.address||''}),close:async()=>{page.closed=true;page.emit('close');}});pages.push(page);context.emit('page',page);return page;
  },close:async()=>{for(const page of pages)await page.close();context.emit('close');context.closed=true;}});return context;
}
test('agent browser commands serialize per agent, recover page loss and preserve profiles',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'st-browser-'));const contexts=[];
  const manager=new AgentBrowsers({root,launch:async()=>{const c=fixture();contexts.push(c);return c;}});
  t.after(async()=>{await manager.close();fs.rmSync(root,{recursive:true,force:true});});
  const original=await manager.get('one');const gate=deferred(),entered=deferred(),order=[];
  original.page.goto=async url=>{order.push(url);if(url.endsWith('/first')){entered.resolve();await gate.promise;}original.page.address=url;};
  const first=manager.action('one',{action:'open',url:'https://example.test/first'});await entered.promise;
  const second=manager.action('one',{action:'open',url:'https://example.test/second'});
  assert.equal((await manager.action('two',{action:'open',url:'https://example.test/independent'})).url,'https://example.test/independent');
  assert.deepEqual(order,['https://example.test/first']);gate.resolve();await first;await second;assert.equal(order.length,2);
  const popup=await original.context.newPage();await popup.goto('https://example.test/popup');assert.equal((await manager.action('one',{action:'snapshot'})).url,'https://example.test/popup');
  await popup.close();assert.equal((await manager.action('one',{action:'snapshot'})).url,'https://example.test/second');
  await original.page.close();await manager.action('one',{action:'open',url:'https://example.test/recovered'});
  await manager.action('one',{action:'close'});assert.equal(contexts[0].closed,true);assert.equal(fs.existsSync(path.join(root,'browsers','one')),true);
});
test('close waits for pending browser creation, launch failures are actionable',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'st-browser-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const gate=deferred(),context=fixture();const manager=new AgentBrowsers({root,launch:()=>gate.promise});
  const opening=manager.get('pending');let closed=false;const closing=manager.close().then(()=>closed=true);await Promise.resolve();assert.equal(closed,false);
  gate.resolve(context);await opening;await closing;assert.equal(context.closed,true);await assert.rejects(manager.action('pending',{action:'snapshot'}),/shutting down/);
  const broken=new AgentBrowsers({root,launch:async()=>{throw Error('not installed');}});await assert.rejects(broken.action('failed',{action:'snapshot'}),/Install Chrome or set SUPER_TERMINAL_BROWSER/);assert.equal(broken.pending.size,0);await broken.close();
});
test('real popup redirects retain the browser marker and control WebSockets never reach the server',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'st-browser-boundary-'));
  let unmarked=0,marked=0,upgrades=0;
  const control=http.createServer((req,res)=>{if(req.headers['x-super-terminal-browser']==='1'){marked++;res.writeHead(403);res.end('Denied browser');}else{unmarked++;res.end('BOOTSTRAP_SECRET');}});
  control.on('upgrade',(_req,socket)=>{upgrades++;socket.destroy();});
  await new Promise(r=>control.listen(0,'127.0.0.1',r));const controlUrl=`http://127.0.0.1:${control.address().port}`;
  const fixture=http.createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:controlUrl});res.end();}else{res.setHeader('Content-Type','text/html');res.end('<title>Fixture</title><body>Allowed page</body>');}});
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const fixtureUrl=`http://127.0.0.1:${fixture.address().port}`;
  const manager=new AgentBrowsers({root,controlPort:control.address().port});
  t.after(async()=>{await manager.close();for(const server of [fixture,control]){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(root,{recursive:true,force:true});});
  await manager.action('fixture',{action:'open',url:fixtureUrl});const {page,context}=await manager.get('fixture');
  const code=await page.evaluate(url=>new Promise((resolve,reject)=>{const ws=new WebSocket(url);ws.onclose=event=>resolve(event.code);setTimeout(()=>reject(Error('WebSocket close not observed')),3000);}),controlUrl.replace('http','ws'));
  assert.equal(code,1008);assert.equal(upgrades,0);
  const opened=context.waitForEvent('page');await page.evaluate(url=>{window.open(url);},fixtureUrl+'/redirect');const popup=await opened;await popup.waitForLoadState('domcontentloaded');
  assert.doesNotMatch(await popup.locator('body').innerText(),/BOOTSTRAP_SECRET/);assert.equal(unmarked,0);assert.ok(marked>0);
  await assert.rejects(manager.action('fixture',{action:'snapshot'}),/control service/);
  await popup.close();assert.equal((await manager.action('fixture',{action:'snapshot'})).url,fixtureUrl+'/');
});
