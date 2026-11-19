import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {layoutSessionGraph,adjacentGraphNode,graphEdgePath,graphBounds} from '../src/session-graph-layout.mjs';
import {sessionGraph,observationAge} from '../src/session-graph.mjs';
import {reviewFixture,reviewState} from './fixtures/ui-review.mjs';
const chrome=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath()].find(p=>fs.existsSync(p));
function inventory(){
  const groups=[{key:'one'},{key:'two'}],nodes=[];
  for(const group of groups){nodes.push({id:'project:'+group.key,kind:'project',groupKey:group.key});for(let i=0;i<40;i++)nodes.push({id:group.key+i,kind:'session',groupKey:group.key,session:{parentAgentId:i%5?group.key+(i-i%5):null}});}
  return {groups,nodes,edges:[]};
}
function verifyGeometry(graph){
  assert.equal(new Set(graph.nodes.map(n=>n.id)).size,graph.nodes.length);
  for(let i=0;i<graph.nodes.length;i++)for(const b of graph.nodes.slice(i+1)){const a=graph.nodes[i];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${a.id} overlaps ${b.id}`);}
}
test('canvas lays out a left-to-right forest with no overlaps and stable topology',()=>{
  const graph=layoutSessionGraph(inventory());verifyGeometry(graph);
  const byId=new Map(graph.nodes.map(n=>[n.id,n]));
  for(const node of graph.nodes.filter(n=>n.session?.parentAgentId)){const parent=byId.get(node.session.parentAgentId);assert.ok(node.x>parent.x+parent.width);assert.match(graphEdgePath(parent,node),/^M .* C /);}
  assert.deepEqual(layoutSessionGraph(inventory(),{width:300}).nodes,layoutSessionGraph(inventory(),{width:2000}).nodes,'Resizing the viewport never reshuffles nodes');
  for(const region of graph.regions)for(const node of graph.nodes.filter(n=>n.groupKey===region.key)){assert.ok(node.x>=region.x&&node.x+node.width<=region.x+region.width);assert.ok(node.y>=region.y&&node.y+node.height<=region.y+region.height);}
});
test('drag coordinates and negative positions preserve relationships; cycles remain bounded',()=>{
  const input=inventory(),auto=layoutSessionGraph(input),positions=new Map([['one0',{x:-120,y:30}],['one1',{x:80,y:-60}]]),moved=layoutSessionGraph(input,{positions});
  assert.equal(moved.nodes.find(n=>n.id==='one0').x,-120);assert.equal(moved.nodes.find(n=>n.id==='one1').session.parentAgentId,'one0');assert.ok(graphBounds(moved.nodes).y<0);
  assert.equal(moved.nodes.find(n=>n.id==='one5').x,auto.nodes.find(n=>n.id==='one5').x);
  input.nodes.find(n=>n.id==='one0').session.parentAgentId='one1';const cycle=layoutSessionGraph(input);assert.equal(cycle.nodes.length,input.nodes.length);verifyGeometry(cycle);
});
test('keyboard follows the canvas geometry and age discloses old evidence',()=>{
  const graph=layoutSessionGraph(inventory());
  assert.equal(adjacentGraphNode(graph.nodes,'one1','ArrowLeft'),'one0');
  assert.equal(adjacentGraphNode(graph.nodes,'one1','ArrowDown'),'one2');
  assert.equal(adjacentGraphNode(graph.nodes,'one2','ArrowUp'),'one1');
  const now=Date.parse('2026-01-01T12:00:00Z');assert.equal(observationAge(null,now),'No observation time');assert.equal(observationAge('2026-01-01T11:56:00Z',now),'Seen 4m ago');assert.equal(observationAge('2025-12-30T12:00:00Z',now),'Seen 2d ago');
});
test('changing task titles preserves canvas positions',()=>{
  const state=reviewState(),before=sessionGraph(state);state.tasks[0].title='ZZ changed task';state.sessions[1].title='AA changed conversation';
  assert.deepEqual(sessionGraph(state).nodes.map(n=>[n.id,n.x,n.y]),before.nodes.map(n=>[n.id,n.x,n.y]));
});
test('canvas drag, zoom, minimap, inspector and saved positions preserve session behavior',{skip:!chrome,timeout:45000},async()=>{
  const fixture=await reviewFixture();let browser;const errors=[],at=new Date().toISOString();
  const question='Which approach should the implementation use? '+('Full context stays available in the inspector. ').repeat(8);
  Object.assign(fixture.state.sessions[0],{model:'model-with-a-long-explicit-provider-name',branch:'feature/responsive-agent-overview',worktreeRoot:'/example/.worktrees/overview',cwd:'/example/.worktrees/overview/packages/interface/src',agentActivity:{state:'waiting',question,at}});
  fixture.state.tasks[0].lastReport={at:'2020-01-01T00:00:00Z',summary:'Prior task report',nextStep:'Check keyboard traversal before completing the review.'};
  fixture.state.sessions.push({id:'helper',parentAgentId:'agent',kind:'managed',provider:'codex',host:'local',cwd:'/example',projectId:'project',status:'running',role:'Test helper',agentActivity:{state:'working',at,detail:'Checking navigation.'}});
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.goto(fixture.url);await page.locator('[data-session-node=agent]').waitFor();
    const position=()=>page.locator('[data-node-id=agent]').evaluate(e=>({x:e.offsetLeft,y:e.offsetTop}));
    const camera=()=>page.locator('.sg-world').evaluate(e=>e.style.transform);
    const before=await position(),edge=await page.locator('.sg-edges').innerHTML(),icon=await page.locator('[data-session-node=agent] .sg-icon').boundingBox();
    await page.mouse.move(icon.x+icon.width/2,icon.y+icon.height/2);await page.mouse.down();await page.mouse.move(icon.x+icon.width/2+90,icon.y+icon.height/2+55,{steps:8});await page.mouse.up();
    const moved=await position();assert.notDeepEqual(moved,before);assert.notEqual(await page.locator('.sg-edges').innerHTML(),edge);assert.equal(await page.locator('.pane').count(),1,'Dragging must not open a session');
    await page.reload();await page.locator('[data-session-node=agent]').waitFor();assert.deepEqual(await position(),moved,'Dragged positions survive reopening');
    await page.locator('[data-sg-details=agent]').focus();await page.keyboard.press('Enter');await page.locator('.sg-inspector:not([hidden])').waitFor();
    assert.match(await page.locator('.sg-inspector').innerText(),/Check keyboard traversal/);assert.ok((await page.locator('.sg-inspector').innerText()).includes(question));assert.match(await page.locator('.sg-inspector').innerText(),/packages\/interface\/src/);
    assert.equal(await page.locator('.pane').count(),1);assert.deepEqual(await position(),moved,'Inspecting a node does not reflow the graph');
    await page.click('[data-sg-close]');await page.click('[data-sg-fit]');
    const firstCamera=await camera(),viewport=await page.locator('.sg-viewport').boundingBox();await page.mouse.move(viewport.x+20,viewport.y+20);await page.mouse.wheel(90,60);assert.notEqual(await camera(),firstCamera);
    const panCamera=await camera();await page.keyboard.down('Control');await page.mouse.wheel(0,-70);await page.keyboard.up('Control');assert.notEqual(await camera(),panCamera);
    await page.click('.sg-minimap',{position:{x:20,y:20}});assert.notEqual(await camera(),panCamera);
    await page.click('[data-sg-arrange]');assert.deepEqual(await position(),before,'Tidy up restores the computed topology');
    await page.reload();await page.locator('[data-session-node=agent]').waitFor();assert.deepEqual(await position(),before);
    await page.locator('[data-session-node=agent]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement.matches('.xterm-helper-textarea'));assert.equal(await page.locator('.pane').count(),2);
    await page.setViewportSize({width:800,height:500});assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));assert.ok(await page.locator('.sg-viewport').evaluate(e=>e.clientHeight>80));
    await page.locator('[data-sg-details=agent]').focus();await page.keyboard.press('Enter');const panel=await page.locator('.sg-inspector').boundingBox(),canvas=await page.locator('.sg-canvas').boundingBox();assert.ok(panel.width<=canvas.width&&panel.height<=canvas.height);
    assert.equal(fixture.requests.filter(r=>r.method==='POST'&&(r.path==='/api/sessions'||r.path.endsWith('/prompt'))).length,0);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});
test('large canvas starts readable, fits the complete graph and reveals offscreen keyboard targets',{skip:!chrome,timeout:20000},async()=>{
  const fixture=await reviewFixture();let browser;
  fixture.state.sessions=Array.from({length:80},(_,i)=>({id:'canvas-'+String(i).padStart(2,'0'),kind:'managed',provider:'codex',host:'local',cwd:'/example',projectId:'project',status:'running',title:'Agent '+i,parentAgentId:i%5?'canvas-'+String(i-i%5).padStart(2,'0'):null}));fixture.state.tasks=[];fixture.state.history=[];
  try{
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1500,height:950}});await page.goto(fixture.url);await page.locator('[data-session-node]').first().waitFor();assert.equal(await page.locator('[data-session-node]').count(),80);
    assert.ok(parseInt(await page.locator('[data-sg-reset]').innerText())>=65,'Large inventories initially retain readable nodes');
    await page.click('[data-sg-fit]');
    assert.equal(await page.locator('.sg-viewport').evaluate(view=>{const b=view.getBoundingClientRect();return [...view.querySelectorAll('.sg-node')].every(e=>{const r=e.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1;});}),true,'Fit includes every node');
    await page.click('[data-sg-reset]');await page.locator('[data-session-node=canvas-79]').focus();
    assert.equal(await page.locator('[data-session-node=canvas-79]').evaluate(e=>{const r=e.getBoundingClientRect(),b=e.closest('.sg-viewport').getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom&&r.left>=b.left&&r.right<=b.right;}),true,'Keyboard focus pans an offscreen node into view');
    assert.equal(await page.locator('.pane').count(),1);assert.equal(fixture.requests.filter(r=>r.method==='POST'&&r.path==='/api/sessions').length,0);
  }finally{await browser?.close();await fixture.close();}
});
