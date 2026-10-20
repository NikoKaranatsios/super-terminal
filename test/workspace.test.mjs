import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace.mjs';

test('independent panels retain tabs, focus existing agents and restore their sizes', () => {
  const w = new Workspace(); w.open('conductor'); const left=w.activePane;
  w.split('row');w.open('agent1');w.open('agent2');w.resize(w.root.id,.7);
  w.split('column');w.open('history1');
  w.open('conductor');assert.equal(w.activePane,left);assert.equal(w.panes().length,3);
  assert.deepEqual(w.panes().map(p=>p.tabs),[['conductor'],['agent1','agent2'],['history1']]);
  const saved=new Workspace(w.serialize());assert.equal(saved.root.ratio,.7);assert.equal(saved.activePane,left);
  saved.close('agent2');assert.equal(saved.panes()[1].active,'agent1');
  saved.close('agent1');assert.equal(saved.panes().length,2);assert.equal(saved.panes()[1].active,'history1');
  saved.close('conductor');assert.equal(saved.panes().length,1);assert.equal(saved.current().active,'history1');
});
test('blank panels can close, ratios are bounded and corrupt layouts recover', () => {
  const w=new Workspace();w.open('a');const empty=w.split('row');w.resize(w.root.id,1);assert.equal(w.root.ratio,.85);
  w.removeEmpty(empty.id);assert.equal(w.current().active,'a');
  for(let i=0;i<5;i++)w.split();assert.throws(()=>w.split(),/six panels/);
  assert.equal(new Workspace('{broken').panes().length,1);
  const bad=new Workspace();bad.open('a');bad.root.tabs.push('a');assert.equal(new Workspace(bad.serialize()).current().tabs.length,0);
});
