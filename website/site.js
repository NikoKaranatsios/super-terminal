'use strict';
// Fictional, browser-local fixtures. No API, provider, shell or storage access.
const initialSessions = [
  {id:'menu', name:'Command menu', provider:'Codex', mark:'C', model:'GPT-5', project:'orbit', location:'Local', branch:'feature/menu', path:'orbit/.worktrees/menu', worktree:true, state:'working', x:190, y:32, evidence:'Implementing arrow-key navigation. The keyboard test run is in progress.', output:[['prompt','› Add keyboard navigation to the command menu.'],['text','Reading src/command-menu.ts\nChecking tests/command-menu.test.ts'],['result','Focus movement is implemented. Running the keyboard tests…']]},
  {id:'review', name:'Keyboard review', provider:'Claude', mark:'✳', model:'Sonnet', project:'orbit', location:'Local', branch:'review/keyboard', path:'orbit/.worktrees/review', worktree:true, state:'question', parent:'menu', x:480, y:32, evidence:'When the menu closes, should focus return to the button that opened it?', output:[['prompt','› Review keyboard behavior in the command menu.'],['text','Arrow-key and Escape handling look consistent.'],['question','When the menu closes, should focus return to the button that opened it?']]},
  {id:'docs', name:'Docs & examples', provider:'Grok', mark:'G', model:'Grok', project:'orbit', location:'Local', branch:'main', path:'orbit/docs', worktree:false, state:'finished', x:190, y:218, evidence:'Reported: examples updated and documentation checks passed. This is a finished turn, not independent task verification.', output:[['prompt','› Document the command menu shortcuts.'],['text','Updated docs/keyboard.md and the example walkthrough.'],['result','Documentation checks passed. Ready for your review.']]},
  {id:'api', name:'API tests', provider:'Codex', mark:'C', model:'GPT-5', project:'beacon', location:'SSH · dev-server', branch:'test/api', path:'beacon/.worktrees/api', worktree:true, state:'working', x:190, y:410, evidence:'Checking pagination and empty results in the API test suite. The session runs on the example SSH server.', output:[['prompt','› Cover pagination and empty API responses.'],['text','Working in beacon/.worktrees/api\nAdding cases to tests/search.test.ts'],['result','Pagination cases pass. Checking the empty-response case…']]},
  {id:'notes', name:'Release notes', provider:'Claude', mark:'✳', model:'Sonnet', project:'beacon', location:'SSH · dev-server', branch:'main', path:'beacon/docs', worktree:false, state:'idle', viewOnly:true, x:480, y:410, evidence:'No current work is reported. This external process has readable saved output, but no attachable tmux terminal.', output:[['prompt','› Draft release notes from the changes.'],['text','Draft saved to docs/release-notes.md.'],['result','Waiting for the next task.'],['text','View only: saved output from an external terminal.']]},
];
const projects = [{id:'orbit',name:'Orbit',x:24,y:144,detail:'3 sessions\n2 worktrees'}, {id:'beacon',name:'Beacon',x:24,y:440,detail:'2 sessions\n1 worktree'}];
const stateNames = {question:'Needs input',working:'Working',finished:'Finished turn',idle:'Idle'};
const $ = id => document.getElementById(id);
const viewport=$('canvas-viewport'), world=$('canvas-world'), entry=$('terminal-entry');
let sessions=structuredClone(initialSessions), selected='review', filter='all', query='', transform={x:0,y:0,scale:1};
let pointer=null, suppressClick=false, scenario='question';
const drafts=new Map();
const nodes=new Map();
function element(tag, className, text) {const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function current(){return sessions.find(s=>s.id===selected);}
function matches(s){return (filter==='all'||s.state===filter)&&[s.name,s.provider,s.model,s.project,s.branch,s.path,s.location,stateNames[s.state]].join(' ').toLowerCase().includes(query);}
function announce(text){$('demo-announcement').textContent=text;}
function saveDraft(){drafts.set(selected,entry.textContent.slice(0,1000));}
function applyTransform(){world.style.transform='translate('+transform.x+'px,'+transform.y+'px) scale('+transform.scale+')';$('zoom-level').textContent=Math.round(transform.scale*100)+'%';}
function reveal(s,center=false){
  const width=viewport.clientWidth,height=viewport.clientHeight-65,z=transform.scale;
  if(center){transform.x=width/2-(s.x+94)*z;transform.y=height/2-(s.y+80)*z;}
  else {
    const left=s.x*z+transform.x,top=s.y*z+transform.y,right=left+188*z,bottom=top+166*z;
    if(left<16)transform.x+=16-left;else if(right>width-16)transform.x-=right-width+16;
    if(top<16)transform.y+=16-top;else if(bottom>height-16)transform.y-=bottom-height+16;
  }
  applyTransform();
}
function fit(initial=false){
  const points=[...sessions.map(s=>({x:s.x,y:s.y,w:188,h:168})),...projects.map(p=>({x:p.x,y:p.y,w:112,h:90}))];
  const x=Math.min(...points.map(p=>p.x))-18,y=Math.min(...points.map(p=>p.y))-18;
  const width=Math.max(...points.map(p=>p.x+p.w))-x+18,height=Math.max(...points.map(p=>p.y+p.h))-y+18;
  const available=viewport.clientHeight-68;
  transform.scale=Math.max(.25,Math.min(1.05,(viewport.clientWidth-24)/width,available/height));
  transform.x=(viewport.clientWidth-width*transform.scale)/2-x*transform.scale;
  transform.y=(available-height*transform.scale)/2-y*transform.scale+8;
  if(initial&&viewport.clientWidth<500){transform.scale=.88;reveal(current(),true);}else applyTransform();
}
function zoom(factor){
  const next=Math.max(.25,Math.min(1.6,transform.scale*factor)),cx=viewport.clientWidth/2,cy=(viewport.clientHeight-65)/2;
  transform.x=cx-(cx-transform.x)*next/transform.scale;transform.y=cy-(cy-transform.y)*next/transform.scale;
  transform.scale=next;applyTransform();
}
function drawLinks(){
  const fragment=document.createDocumentFragment();
  for(const s of sessions){
    const parent=s.parent?sessions.find(n=>n.id===s.parent):projects.find(p=>p.id===s.project);
    const x1=parent.x+(s.parent?135:112),y1=parent.y+(s.parent?36:27),x2=s.x+53,y2=s.y+36;
    const bend=Math.max(48,Math.abs(x2-x1)*.48);
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M'+x1+' '+y1+' C'+(x1+bend)+' '+y1+' '+(x2-bend)+' '+y2+' '+x2+' '+y2);
    path.setAttribute('class','graph-edge'+(s.parent?' child':'')+(matches(s)?'':' dimmed'));
    if(s.parent)path.dataset.parent=parent.id;
    fragment.append(path);
  }
  $('graph-links').replaceChildren(fragment);
}
function makeNodes(){
  $('project-nodes').replaceChildren(...projects.map(p=>{
    const el=element('div','project-node');el.style.left=p.x+'px';el.style.top=p.y+'px';
    el.append(element('div','project-tile',p.name),element('small','',p.detail));el.lastChild.style.whiteSpace='pre-line';return el;
  }));
  const fragment=document.createDocumentFragment();nodes.clear();
  for(const s of sessions){
    const button=element('button','agent-node');button.type='button';button.dataset.session=s.id;
    const tile=element('span','node-tile',s.mark);tile.setAttribute('aria-hidden','true');tile.append(element('i'));
    button.append(tile,element('strong','',s.name),element('span','node-model',s.provider+' · '+s.model),element('span','node-state'));
    button.addEventListener('click',event=>{if(suppressClick&&event.detail>0)return;select(s.id,true);clearScenario();});
    button.addEventListener('focus',()=>reveal(s));
    button.addEventListener('keydown',event=>{
      if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();const visible=sessions.filter(matches),index=visible.findIndex(v=>v.id===s.id);
      const delta=['ArrowRight','ArrowDown'].includes(event.key)?1:-1;
      const target=event.key==='Home'?visible[0]:event.key==='End'?visible.at(-1):visible[(index+delta+visible.length)%visible.length];
      nodes.get(target?.id)?.focus();
    });
    nodes.set(s.id,button);fragment.append(button);
  }
  $('agent-nodes').replaceChildren(fragment);
}
function renderGraph(){
  const matching=sessions.filter(matches);
  for(const s of sessions){
    const node=nodes.get(s.id),match=matches(s);
    node.className='agent-node '+s.state+(match?'':' dimmed');
    node.style.left=s.x+'px';node.style.top=s.y+'px';
    node.setAttribute('aria-pressed',String(selected===s.id));node.tabIndex=match?0:-1;
    node.setAttribute('aria-label',s.name+', '+s.provider+' '+s.model+', '+stateNames[s.state]+', '+s.project+(s.parent?', subagent of '+sessions.find(n=>n.id===s.parent).name:''));
    node.querySelector('.node-state').textContent=stateNames[s.state]+(s.parent?' · subagent':'');
  }
  for(const key of ['all','question','working','finished'])$('count-'+key).textContent=key==='all'?sessions.length:sessions.filter(s=>s.state===key).length;
  document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
  $('result-count').textContent=matching.length===sessions.length?'5 sessions across 2 projects':matching.length+' of 5 sessions · context stays visible';
  $('empty-results').hidden=matching.length>0;
  $('jump-session').replaceChildren(element('option','', 'Jump to agent…'),...sessions.map(s=>{
    const option=element('option','',s.name+' · '+stateNames[s.state]);option.value=s.id;return option;
  }));$('jump-session').firstChild.value='';
  drawLinks();
}
function renderTerminal(){
  const s=current();
  $('session-name').textContent=s.name;$('session-status').textContent=stateNames[s.state];$('session-status').className='status-badge '+s.state;
  $('session-model').textContent=s.provider+' / '+s.model;
  $('session-location').textContent=projects.find(p=>p.id===s.project).name+' / '+s.location;
  $('session-checkout').textContent=s.branch+' · '+(s.worktree?'worktree':'main checkout')+' · '+s.path;
  $('relationship').hidden=!s.parent;
  if(s.parent)$('open-parent').textContent=sessions.find(n=>n.id===s.parent).name;
  $('task-evidence').className='task-evidence '+(s.state==='question'?'question':'neutral');
  $('evidence-label').textContent={question:'Question from the agent',working:'Current activity',finished:'Reported result',idle:'Observed session state'}[s.state];
  $('evidence-text').textContent=s.evidence;$('terminal-name').textContent=s.provider.toLowerCase();
  $('terminal-access').textContent=s.viewOnly?'View only · saved output':'Example terminal';
  $('terminal-output').replaceChildren(...s.output.map(([kind,text])=>element('p',kind+'-line',text)));
  $('terminal-prompt').hidden=!!s.viewOnly;
  entry.textContent=drafts.get(selected)||'';
  entry.dataset.placeholder=s.state==='question'?'Type your reply, then Enter':'Try help or status, then Enter';
  $('terminal-footer').textContent=s.viewOnly?'No terminal attachment for this example':'Local simulation · nothing is sent or executed';
  $('terminal-screen').scrollTop=$('terminal-screen').scrollHeight;
}
function select(id,focus=false){
  saveDraft();selected=id;renderGraph();renderTerminal();reveal(current());
  announce(current().name+' selected. '+stateNames[current().state]+(current().viewOnly?'. Saved output is view only.':'. Example terminal available.'));
  if(focus){
    const target=current().viewOnly?$('terminal-screen'):entry;target.focus({preventScroll:true});
    if(innerWidth<=650)document.querySelector('.session-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }
}
function clearScenario(){scenario='';document.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed','false'));}
function applyFilter(){
  saveDraft();const matching=sessions.filter(matches);
  if(matching.length&&!matches(current())){selected=matching[0].id;renderTerminal();reveal(current());}
  renderGraph();clearScenario();
}
function chooseScenario(name){
  saveDraft();filter='all';query='';$('session-search').value='';scenario=name;
  const review=sessions.find(s=>s.id==='review');
  if(name==='question'){
    // Restart only this fictional question so the interaction can be tried again.
    Object.assign(review,{state:'question',evidence:initialSessions[1].evidence,output:structuredClone(initialSessions[1].output)});drafts.delete('review');
    selected='review';$('scenario-description').textContent='Claude needs a decision. Type a reply in its example terminal and watch its state change.';
  }else if(name==='worktree'){
    selected='api';query='beacon';$('session-search').value='beacon';
    $('scenario-description').textContent='API tests runs in a worktree; Release notes runs in a subfolder. Both belong to Beacon. Their checkouts and access stay distinct.';
  }else{
    selected='review';$('scenario-description').textContent='The dashed connection links Keyboard review to its parent, Command menu. Use the parent link in the details to move between them.';
  }
  document.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scenario===name)));
  renderGraph();renderTerminal();fit(true);
  if(name==='question')entry.focus({preventScroll:true});
  announce($('scenario-description').textContent);
}
function submit(){
  const text=entry.textContent.trim().slice(0,1000);if(!text)return;
  const s=current();drafts.delete(selected);entry.textContent='';
  const command=text.toLowerCase();
  if(command==='clear')s.output=[];
  else {
    s.output.push(['prompt','› '+text]);
    if(command==='help')s.output.push(['text','Demo commands: status, clear, help.\nReply to the waiting question to resume that example agent. No text is sent and no command is executed.']);
    else if(command==='status')s.output.push(['text',s.name+' · '+stateNames[s.state]+'\n'+s.project+' / '+s.branch+' / '+s.location]);
    else if(s.state==='question'){
      s.state='working';s.evidence='Your example reply was received. The keyboard review is continuing.';
      s.output.push(['result','Example reply received. Continuing the keyboard review with your decision.']);
      if(filter==='question')filter='all';
      $('scenario-description').textContent='The question is answered: Claude is now Working. The graph and terminal reflect the same session. Reset the demo to start again.';
      announce('Example reply received. Keyboard review is now Working. No text was sent.');
    }else s.output.push(['text','This is a local simulation. Try status or help, or select Find a question to try answering an agent.']);
  }
  s.output=s.output.slice(-24);renderGraph();renderTerminal();entry.focus({preventScroll:true});
}
entry.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();submit();}
  if(event.key==='Escape'){event.preventDefault();saveDraft();nodes.get(selected).focus();}
});
entry.addEventListener('input',()=>{if(entry.textContent.length>1000)entry.textContent=entry.textContent.slice(0,1000);drafts.set(selected,entry.textContent);});
$('open-parent').addEventListener('click',()=>{if(current().parent){filter='all';query='';$('session-search').value='';select(current().parent,true);clearScenario();}});
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;applyFilter();}));
$('session-search').addEventListener('input',event=>{query=event.target.value.trim().toLowerCase();applyFilter();});
$('clear-filters').addEventListener('click',()=>{filter='all';query='';$('session-search').value='';applyFilter();$('session-search').focus();});
$('jump-session').addEventListener('change',event=>{if(!sessions.some(s=>s.id===event.target.value))return;const id=event.target.value;filter='all';query='';$('session-search').value='';select(id,true);clearScenario();});
document.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>chooseScenario(b.dataset.scenario)));
$('zoom-in').addEventListener('click',()=>zoom(1.15));$('zoom-out').addEventListener('click',()=>zoom(1/1.15));$('fit-graph').addEventListener('click',()=>fit());
$('reset-demo').addEventListener('click',()=>{
  sessions=structuredClone(initialSessions);selected='review';filter='all';query='';drafts.clear();entry.textContent='';$('session-search').value='';
  makeNodes();chooseScenario('question');announce('Demo reset. Five sessions. One question waiting.');
});
viewport.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('.canvas-controls,.empty-results'))return;
  const node=event.target.closest('[data-session]');
  pointer={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:transform.x,y:transform.y,node:node?sessions.find(s=>s.id===node.dataset.session):null,moved:false};
  if(pointer.node){pointer.x=pointer.node.x;pointer.y=pointer.node.y;}
  // Retain the node as the pointer target so a tap still produces its click.
  pointer.capture=node||viewport;pointer.capture.setPointerCapture(event.pointerId);suppressClick=false;
});
viewport.addEventListener('pointermove',event=>{
  if(!pointer||event.pointerId!==pointer.id)return;
  const dx=event.clientX-pointer.startX,dy=event.clientY-pointer.startY;
  if(!pointer.moved&&Math.hypot(dx,dy)<5)return;
  pointer.moved=true;viewport.classList.add('dragging');suppressClick=true;
  if(pointer.node){pointer.node.x=pointer.x+dx/transform.scale;pointer.node.y=pointer.y+dy/transform.scale;const el=nodes.get(pointer.node.id);el.style.left=pointer.node.x+'px';el.style.top=pointer.node.y+'px';drawLinks();}
  else{transform.x=pointer.x+dx;transform.y=pointer.y+dy;applyTransform();}
});
function endPointer(event){if(!pointer||event.pointerId!==pointer.id)return;pointer.capture.releasePointerCapture(event.pointerId);pointer=null;viewport.classList.remove('dragging');setTimeout(()=>{suppressClick=false;},0);}
viewport.addEventListener('pointerup',endPointer);viewport.addEventListener('pointercancel',endPointer);
let previousWidth=0;
new ResizeObserver(()=>{if(Math.abs(viewport.clientWidth-previousWidth)>20){previousWidth=viewport.clientWidth;fit(true);}}).observe(viewport);
const copyButton=$('copy-install');
if(navigator.clipboard?.writeText){
  copyButton.hidden=false;
  copyButton.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('install-commands').textContent.trim());copyButton.textContent='Copied';$('copy-status').textContent='Installation commands copied.';setTimeout(()=>{copyButton.textContent='Copy commands';},2500);}
    catch{$('copy-status').textContent='Copy unavailable. Select the commands below.';copyButton.textContent='Select commands below';const range=document.createRange();range.selectNodeContents($('install-commands'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
  });
}
$('demo-controls').hidden=false;$('reset-demo').hidden=false;
document.querySelector('.workspace-body').hidden=false;document.querySelector('.demo-guide').hidden=false;
makeNodes();renderGraph();renderTerminal();fit(true);
