import test from 'node:test';
import assert from 'node:assert/strict';
import {agentCapabilities,projectForAgent,projectOptions,messageTransport,messageReceiptMarkup} from '../src/agent-view.mjs';
import {helpSections} from '../src/help-guide.mjs';
import {backgroundStatusMarkup} from '../src/help-view.mjs';

test('message transports distinguish managed checkpoints, live tmux, external copies and isolated context',()=>{
  const managed={id:'a',kind:'managed',status:'running',historyId:'saved'};
  assert.equal(messageTransport(managed).mode,'mailbox');
  assert.equal(messageTransport({...managed,status:'paused'}).mode,'mailbox');
  assert.equal(messageTransport({kind:'tmux',status:'running'}).mode,'terminal');
  assert.equal(messageTransport({kind:'external',status:'external'}).mode,'copy');
  assert.equal(messageTransport({...managed,runtime:true}).mode,'copy');
  const isolated={...managed,contextIsolation:'restart-required',capabilities:{mailbox:false,continuationHistoryId:null}};
  assert.equal(messageTransport(isolated).mode,'copy');assert.equal(agentCapabilities(isolated).continuationHistoryId,null);
  assert.equal(agentCapabilities({...managed,capabilities:{continuationHistoryId:null}}).continuationHistoryId,null);
  assert.equal(agentCapabilities({...managed,connectionLost:true}).terminalInput,false);
  assert.equal(agentCapabilities({...managed,status:'paused',capabilities:{terminalInput:true}}).terminalInput,false);
  assert.equal(agentCapabilities({...managed,runtime:true,capabilities:{terminalInput:true}}).terminalInput,false);
});
test('manual unassignment cannot recover a previous project through stale task metadata',()=>{
  const state={projects:[{id:'p',name:'Example'}],tasks:[{id:'task',projectId:'p',agentId:'a'}]};
  assert.equal(projectForAgent({id:'a'},state).id,'p');
  assert.equal(projectForAgent({id:'a',projectId:null,projectAssignment:{source:'manual'}},state),null);
  assert.ok(!projectOptions({projects:[{id:'remote',host:'other-host',name:'Remote project'}]},null,'local').includes('Remote project'));
});
test('mailbox receipts distinguish queued from read and escape user text',()=>{
  const markup=messageReceiptMarkup([{id:'m',from:'you',to:'a',text:'<script>example</script>',read:false},{id:'n',from:'you',to:'a',text:'Reviewed',read:true},{id:'other',from:'you',to:'b',text:'Outside'}],'a');
  assert.ok(markup.includes('Queued · awaiting read'));assert.ok(markup.includes('Read by agent'));
  assert.ok(!markup.includes('<script>'));assert.ok(!markup.includes('Outside'));
  const withdrawn=messageReceiptMarkup([{id:'m',from:'you',to:'a',text:'Old context',read:false,delivery:'withdrawn'}],'a',{id:'m',text:'Old context',read:false});
  assert.ok(withdrawn.includes('Withdrawn · assignment changed'));assert.ok(!withdrawn.includes('Queued'));
});
test('Docs distinguish live reported status from guide content and unsupported guarantees',()=>{
  const markup=backgroundStatusMarkup({coordinator:{loop:{state:'paused',observedProgress:2,pendingProgress:1,lastError:'<error>'}},remote:[]},null);
  assert.ok(markup.includes('paused'));assert.ok(markup.includes('2 observed'));assert.ok(markup.includes('1 awaiting review'));
  assert.ok(markup.includes('&lt;error&gt;'));assert.ok(markup.includes('Not recorded'));
  assert.equal(new Set(helpSections.map(section=>section.id)).size,helpSections.length);
  assert.ok(helpSections.find(s=>s.id==='messages').markdown.includes('Read means fetched, not accepted or completed'));
  assert.ok(helpSections.find(s=>s.id==='projects').markdown.includes('cannot forget its previous model context'));
});
