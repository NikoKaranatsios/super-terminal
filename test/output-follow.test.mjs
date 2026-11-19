import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const chrome=[process.env.SUPER_TERMINAL_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,25)))));

test('output follows, pauses, pins and restores independent reading anchors across layout changes', {skip:!chrome},async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<style>.output{height:240px;width:450px;overflow:auto;overflow-anchor:none} article{height:100px;margin:0}details{height:auto}#other{height:120px}</style><div id="output" class="output"></div><div id="other" class="output"></div>');
    await page.addScriptTag({content:fs.readFileSync('src/output-follow.mjs','utf8').replaceAll('export ','')+'\nObject.assign(window,{OutputFollow,reconcileOutput});'});
    await page.evaluate(()=>{
      window.records=Array.from({length:15},(_,i)=>({id:'row:'+i,html:'Output '+i}));
      window.el=document.querySelector('#output');window.follow=new OutputFollow(el,{storage:null});
      window.update=(rows,earlier=false)=>{const anchor=follow.beforeUpdate({earlier});reconcileOutput(el,rows);follow.afterUpdate(anchor,{newOutput:!earlier});};
      window.gap=()=>el.scrollHeight-el.clientHeight-el.scrollTop;
      window.other=new OutputFollow(document.querySelector('#other'),{storage:null});
      reconcileOutput(other.element,records);other.activate();update(records);
    });
    await settle(page);assert.equal(await page.evaluate(()=>gap()),0,'initial content follows');
    await page.evaluate(()=>{records.push({id:'new',html:'New output'});update(records);});await settle(page);
    assert.equal(await page.evaluate(()=>gap()),0,'appending follows');
    await page.evaluate(()=>el.scrollTop=340);await settle(page);
    assert.equal(await page.evaluate(()=>follow.following),false,'upward scroll pauses');
    const anchored=await page.evaluate(()=>follow.anchor());
    await page.evaluate(()=>{records.push({id:'newer',html:'Newer output'});update(records);});await settle(page);
    assert.equal(await page.evaluate(()=>el.scrollTop),340,'new output leaves reading position alone');
    assert.equal(await page.evaluate(()=>follow.unread),true);
    await page.evaluate(()=>{records.unshift({id:'earlier',html:'Earlier output'});update(records,true);});await settle(page);
    assert.deepEqual(await page.evaluate(()=>({id:follow.anchor().id,offset:follow.anchor().offset})),{id:anchored.id,offset:anchored.offset},'prepend preserves the visible record offset');
    const top=await page.evaluate(()=>el.scrollTop);
    await page.evaluate(()=>{records.splice(12,0,{id:'gap-fill',html:'Missing output'});update(records,true);});await settle(page);
    assert.equal(await page.evaluate(()=>el.scrollTop),top,'gap filled below reader must not move them');
    await page.evaluate(()=>{el.style.display='none';records.push({id:'hidden-update',html:'Hidden output'});update(records);});await settle(page);
    await page.evaluate(()=>{el.style.display='block';el.style.height='180px';follow.activate();});await settle(page);
    assert.equal(await page.evaluate(()=>el.scrollTop),top,'paused hidden pane preserves its anchor');
    assert.equal(await page.evaluate(()=>other.following),true,'the other pane follows independently');
    await page.evaluate(()=>follow.latest());await settle(page);assert.equal(await page.evaluate(()=>gap()),0);
    await page.evaluate(()=>{el.style.display='none';records.push({id:'hidden-follow',html:'Hidden output while following'});update(records);});await settle(page);
    await page.evaluate(()=>{el.style.display='block';follow.activate();});await settle(page);assert.equal(await page.evaluate(()=>gap()),0,'hidden following pane returns to latest');
    await page.evaluate(()=>el.style.height='300px');await settle(page);assert.equal(await page.evaluate(()=>follow.following),true,'viewport expansion does not pause following');
    await page.evaluate(()=>{records.push({id:'after-grow',html:'Output after growing viewport'});update(records);});await settle(page);assert.equal(await page.evaluate(()=>gap()),0);
    await page.evaluate(()=>el.style.height='95px');await settle(page);assert.equal(await page.evaluate(()=>gap()),0,'resize keeps latest visible');
    await page.evaluate(()=>follow.pin(true));await settle(page);
    await page.evaluate(()=>el.scrollTop=0);await settle(page);assert.equal(await page.evaluate(()=>gap()),0,'explicit pin resists upward scrolling');
    await page.evaluate(()=>follow.pin(false));await page.evaluate(()=>el.scrollTop=150);await settle(page);assert.equal(await page.evaluate(()=>follow.following),false);
    await page.evaluate(()=>{window.stableNode=el.children[2];window.selection=getSelection();const range=document.createRange();range.selectNodeContents(stableNode);selection.addRange(range);records.push({id:'last',html:'Last output'});update(records);});await settle(page);
    assert.equal(await page.evaluate(()=>stableNode===el.children[2] && selection.toString()===stableNode.textContent),true,'unchanged rows preserve text selection');
    await page.evaluate(()=>{follow.dispose();other.dispose();window.changes=0;follow.onChange=()=>changes++;el.scrollTop=0;});await settle(page);assert.equal(await page.evaluate(()=>changes),0,'disposed observers and listeners do not run');
  }finally{await browser.close();}
});

test('live xterm follows after asynchronous writes, keeps paused scrollback and honors pin', {skip:!chrome},async()=>{
  const bundle=await build({stdin:{contents:"import {Terminal} from '@xterm/xterm';import {TerminalFollow} from './src/output-follow.mjs';Object.assign(window,{Terminal,TerminalFollow});",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',logLevel:'silent'});
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<div id="terminal" style="width:650px;height:260px"></div>');
    await page.addStyleTag({content:fs.readFileSync('node_modules/@xterm/xterm/css/xterm.css','utf8')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{window.term=new Terminal({cols:70,rows:12});term.open(document.querySelector('#terminal'));window.follow=new TerminalFollow(term,{storage:null});follow.write(Array.from({length:100},(_,i)=>'Line '+i+'\r\n').join(''));});
    await page.waitForFunction(()=>follow.writing===0);assert.equal(await page.evaluate(()=>term.buffer.active.viewportY===term.buffer.active.baseY),true);
    await page.evaluate(()=>term.scrollLines(-25));await settle(page);
    const top=await page.evaluate(()=>term.buffer.active.viewportY);assert.equal(await page.evaluate(()=>follow.following),false);
    await page.evaluate(()=>follow.write('Next line\r\n'));await page.waitForFunction(()=>follow.writing===0);
    assert.equal(await page.evaluate(()=>term.buffer.active.viewportY),top,'paused xterm keeps its viewport');assert.equal(await page.evaluate(()=>follow.unread),true);
    await page.evaluate(()=>follow.pin(true));await settle(page);
    await page.evaluate(()=>{term.scrollLines(-10);follow.write('Pinned\r\n');});await page.waitForFunction(()=>follow.writing===0);await settle(page);
    assert.equal(await page.evaluate(()=>term.buffer.active.viewportY===term.buffer.active.baseY),true);
    await page.evaluate(()=>{follow.resizing=true;term.resize(50,7);follow.resizing=false;follow.activate();});await settle(page);
    assert.equal(await page.evaluate(()=>term.buffer.active.viewportY===term.buffer.active.baseY),true,'resize returns to bottom');
    await page.evaluate(()=>{follow.pin(false);follow.write('Pending output\r\n');term.scrollLines(-5);});
    await page.waitForFunction(()=>follow.writing===0);assert.equal(await page.evaluate(()=>follow.following),false,'scrollbar/keyboard movement during pending write pauses following');
    assert.equal(await page.evaluate(()=>term.buffer.active.viewportY<term.buffer.active.baseY),true);
    await page.evaluate(()=>{follow.dispose();term.dispose();});
  }finally{await browser.close();}
});
