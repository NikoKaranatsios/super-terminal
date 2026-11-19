import {liveSessionRows} from './sessions-view.mjs';
import {sessionSignal,graphSessions} from '../shared/session-signals.mjs';
import {layoutSessionGraph,adjacentGraphNode,graphBounds,graphEdgePath} from './session-graph-layout.mjs';
import {html} from './work-views.mjs';

export function sessionGraph(state,host='all',query='',project='',columns=1,agentsOnly=true,activityFilter='',expandedParents=new Set()){
  const inventory=graphSessions(state),rows=liveSessionRows({...state,sessions:inventory},host,'').filter(row=>!agentsOnly||row.session.provider!=='shell').map(row=>({...row,signal:sessionSignal(row.session,state)}));
  // Mutable task titles must not reshuffle families during inventory refresh.
  rows.sort((a,b)=>a.project.localeCompare(b.project)||a.location.localeCompare(b.location)||a.session.id.localeCompare(b.session.id));
  const terms=query.toLowerCase().split(/\s+/).filter(Boolean),groups=new Map(),counts={all:rows.length};
  for(const row of rows){const key=['waiting','question','blocked'].includes(row.signal.key)?'attention':row.signal.key;counts[key]=(counts[key] || 0)+1;}
  const matches=new Set(rows.filter(row=>(!activityFilter||(activityFilter==='attention'?['waiting','question','blocked'].includes(row.signal.key):row.signal.key===activityFilter))&&terms.every(term=>[row.title,row.project,row.checkout,row.model,row.location,row.identity,row.session.provider,row.session.cwd,row.signal.label,row.signal.detail,row.signal.task,row.session.agentRole].join(' ').toLowerCase().includes(term))).map(row=>row.session.id));
  const foldable=row=>row.session.kind==='history'&&!['working','waiting','question','blocked','finished'].includes(row.signal.key);
  if(!query&&!activityFilter)for(const row of rows)if(foldable(row)&&!expandedParents.has(row.session.parentAgentId))matches.delete(row.session.id);
  // Keep ancestors visible so a filtered child never loses its parent context.
  const byId=new Map(rows.map(row=>[row.session.id,row]));
  for(const id of [...matches]){let row=byId.get(id);const seen=new Set([id]);while(row?.session.parentAgentId&&!seen.has(row.session.parentAgentId)){seen.add(row.session.parentAgentId);row=byId.get(row.session.parentAgentId);if(row)matches.add(row.session.id);}}
  for(const row of rows.filter(row=>matches.has(row.session.id))){
    const key=JSON.stringify([row.session.host,row.projectId || row.session.repositoryRoot || row.session.cwd || 'unassigned']);
    if(!groups.has(key))groups.set(key,{key,title:row.project,location:row.location,rows:[]});groups.get(key).rows.push(row);
  }
  const nodes=[],edges=[];
  for(const group of groups.values()){
    if(project&&group.key!==project)continue;
    const all=rows.filter(r=>JSON.stringify([r.session.host,r.projectId || r.session.repositoryRoot || r.session.cwd || 'unassigned'])===group.key);
    const statuses={};for(const row of all){const key=['waiting','question','blocked'].includes(row.signal.key)?'attention':row.signal.key;statuses[key]=(statuses[key]||0)+1;}
    const parent={id:'project:'+group.key,kind:'project',groupKey:group.key,title:group.title,location:group.location,count:group.rows.length,liveCount:all.filter(r=>r.session.kind!=='history').length,savedCount:all.filter(r=>r.session.kind==='history').length,statuses};nodes.push(parent);
    for(const row of group.rows){
      const directParent=byId.get(row.session.parentAgentId),children=rows.filter(r=>r.session.parentAgentId===row.session.id);
      const taskRows=(state.tasks||[]).filter(t=>t.agentId===row.session.id||t.id===row.session.taskId||t.id===row.session.scope?.goalId);
      const taskCounts={};for(const task of taskRows)taskCounts[task.status]=(taskCounts[task.status]||0)+1;
      const node={...row,id:row.session.id,kind:'session',groupKey:group.key,parentTitle:directParent?.session.agentRole || directParent?.session.role || directParent?.title || (row.session.parentAgentId?'Parent unavailable':''),children:children.length,hiddenChildren:children.filter(r=>!matches.has(r.session.id)).length,foldableChildren:children.filter(foldable).length,workingChildren:children.filter(r=>r.signal.key==='working').length,waitingChildren:children.filter(r=>['waiting','question','blocked'].includes(r.signal.key)).length,taskCounts,taskRows};
      nodes.push(node);edges.push({from:row.session.parentAgentId||parent.id,to:node.id,kind:row.session.parentAgentId?'child':'project'});
    }
  }
  const ids=new Set(nodes.map(n=>n.id));
  return layoutSessionGraph({nodes,edges:edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),groups:[...groups.values()],counts,liveSessions:rows.filter(r=>r.session.kind!=='history').length,savedChildren:rows.filter(r=>r.session.kind==='history').length,sessions:nodes.filter(n=>n.kind==='session').length},{width:columns*390,columns});
}

const providerName=value=>({codex:'Codex',claude:'Claude',grok:'Grok',shell:'Terminal'}[value]||value||'Agent');
const compact=(value,limit=260)=>{const text=String(value||'').replace(/\s+/g,' ').trim();return text.length>limit?text.slice(0,limit)+'…':text;};
export function observationAge(at,now=Date.now()){
  const time=Date.parse(at);if(!Number.isFinite(time))return 'No observation time';
  const seconds=Math.max(0,Math.floor((now-time)/1000));
  return seconds<60?'Seen just now':seconds<3600?`Seen ${Math.floor(seconds/60)}m ago`:seconds<86400?`Seen ${Math.floor(seconds/3600)}h ago`:`Seen ${Math.floor(seconds/86400)}d ago`;
}
const sourceName=value=>({'provider-output':'Provider output','task-report':'Agent report','task-record':'Task record',unknown:'No activity evidence'}[value]||'Observed activity');
const providerMark=value=>({codex:'>_',claude:'✳',grok:'G',shell:'$_'}[value]||'◇');
const nodeName=node=>node.session.agentRole||node.session.role||node.signal.task||node.title;
function nodeMarkup(node,expanded,canFold){
  const s=node.session,attention=['waiting','question','blocked'].includes(node.signal.key),mark=attention?'!':node.signal.key==='finished'?'✓':node.signal.key==='working'?'↻':'·';
  return `<button type="button" class="sg-open" data-session-node="${html(node.id)}" data-state="${html(node.state.toLowerCase())}" aria-pressed="${node.selected}" aria-label="Open ${html([nodeName(node),node.signal.label,node.model,node.access].join(' · '))}">
    <span class="sg-icon" data-provider="${html(s.provider)}"><span class="sg-port sg-port-in"></span><span class="sg-provider-mark" aria-hidden="true">${providerMark(s.provider)}</span><small>${html(providerName(s.provider))}</small><span class="sg-state-mark" aria-hidden="true">${mark}</span><span class="sg-port sg-port-out"></span></span>
    <strong class="sg-name">${html(compact(nodeName(node),110))}</strong>
    <span class="sg-model">${html(node.model)}</span>
    <span class="sg-signal">${html(node.signal.label)}${s.kind==='history'?' · Saved':''}</span>
    <span class="sg-checkout">${html(node.checkout||node.location)}${s.parentAgentId?' · ↳ Subagent':''}</span>
    <span class="sg-note">${html(node.signal.question||node.signal.task||node.signal.detail)}</span>
  </button>
  <div class="sg-node-tools">${node.children?`<span class="sg-family-count">${node.children} subagent${node.children===1?'':'s'}</span>`:node.signal.progress?`<span>${html(node.signal.progress)}</span>`:''}${canFold?`<button class="sg-expand" data-sg-expand="${html(node.id)}" aria-expanded="${expanded}" aria-label="${expanded?'Collapse older':'Show older'} subagents for ${html(nodeName(node))}">${expanded?'−':'+'}${node.hiddenChildren||''}</button>`:''}<button data-sg-details="${html(node.id)}" aria-label="Details for ${html(nodeName(node))}">Details</button></div>`;
}
function inspectorMarkup(node){
  const s=node.session,attention=['waiting','question','blocked'].includes(node.signal.key);
  const facts=[['Provider / model',providerName(s.provider)+' · '+node.model],['Checkout',node.checkout||'Branch unavailable'],['Directory',s.cwd||'Unknown'],['Location / terminal',node.location+' · '+node.identity],['Access',s.kind==='history'?'Saved output · View only':node.access],['Process',s.kind==='history'?'Saved subagent':node.state],['Evidence',sourceName(node.signal.source)+' · '+observationAge(node.signal.at)],['Observation',Number.isFinite(Date.parse(node.signal.at))?new Date(node.signal.at).toLocaleString():'No timestamp supplied'],['Model evidence',node.modelHint]];
  return `<header><span>AGENT DETAILS</span><button data-sg-close aria-label="Close agent details">×</button></header><div class="sg-inspector-body"><span class="sg-inspector-state" data-signal="${html(node.signal.key)}">${html(node.signal.label)}</span><h2>${html(nodeName(node))}</h2><section><small>${node.signal.task?'CURRENT TASK':'CONVERSATION / MISSION'}</small><p>${html(node.signal.task||node.title)}</p></section><section class="sg-detail ${attention?'attention':''}"><small>${node.signal.question?'QUESTION':node.signal.key==='blocked'?'BLOCKER':'LATEST ACTIVITY'}</small><p>${html(node.signal.question||node.signal.detail)}</p></section>${node.signal.progress?`<section><small>REPORTED PROGRESS</small><p>${html(node.signal.progress)}</p><div class="sg-progress-track">${Object.entries(node.taskCounts).map(([key,n])=>`<span data-task-state="${html(key)}" style="flex:${n}" title="${n} ${html(key)}"></span>`).join('')}</div></section>`:''}<dl>${facts.map(([label,value])=>`<dt>${label}</dt><dd>${html(value)}</dd>`).join('')}</dl>${node.parentTitle?`<section><small>PARENT SESSION</small><p>${html(node.parentTitle)}</p></section>`:''}${node.children?`<section><small>SUBAGENTS</small><p>${node.children} total · ${node.workingChildren} working · ${node.waitingChildren} need attention${node.hiddenChildren?' · '+node.hiddenChildren+' older hidden':''}</p></section>`:''}${node.taskRows.map(t=>`<section><small>${html(t.status)} · TASK</small><p>${html(t.title)}</p>${t.lastReport?.summary?`<p>${html(t.lastReport.summary)}</p>`:''}${t.lastReport?.nextStep?`<p>Next: ${html(t.lastReport.nextStep)}</p>`:''}</section>`).join('')}${s.mission&&s.mission!==node.title?`<section><small>MISSION</small><p>${html(s.mission)}</p></section>`:''}</div><footer><button data-sg-open="${html(node.id)}">${node.terminal?'Open terminal':'Open output'} ↗</button></footer>`;
}
export class SessionGraphView{
  constructor(element,{open}){
    Object.assign(this,{element,open,query:'',project:'',zoom:1,pan:{x:40,y:40},selected:null,inspected:null,agentsOnly:true,activityFilter:'',expandedParents:new Set(),positions:new Map()});
    this.storageKey='session-graph-positions:v1:'+(document.querySelector('meta[name="super-terminal-data"]')?.content||'default');
    try{const value=JSON.parse(localStorage.getItem(this.storageKey)||'[]');this.positions=new Map(value.filter(([id,p])=>typeof id==='string'&&Number.isFinite(p?.x)&&Number.isFinite(p?.y)).slice(-2000));}catch{}
    element.classList.add('session-graph');
    element.innerHTML=`<div class="sg-toolbar"><strong>Agent graph</strong><span class="sg-environment"></span><input type="search" aria-label="Search session graph" placeholder="Find an agent, task or model…"><select aria-label="Session graph project"><option value="">All projects</option></select><button class="sg-agent-filter" aria-pressed="true">Agents</button></div><div class="sg-signals" role="group" aria-label="Filter agents by activity"></div><div class="sg-canvas"><div class="sg-viewport" tabindex="0" role="region" aria-label="Session graph. Drag nodes to arrange. Drag canvas to pan. Click a session to open its terminal alongside."><div class="sg-world"><div class="sg-regions" aria-hidden="true"></div><svg class="sg-edges" aria-hidden="true"></svg><div class="sg-nodes"></div></div></div><div class="sg-canvas-controls"><button data-sg-zoom="-1" aria-label="Zoom session graph out">−</button><button data-sg-reset title="Reset zoom">100%</button><button data-sg-zoom="1" aria-label="Zoom session graph in">+</button><span></span><button data-sg-fit>Fit</button><button data-sg-arrange title="Restore automatic node positions">Tidy up</button></div><button class="sg-minimap" aria-label="Navigate graph overview" title="Click to move around the canvas"><svg aria-hidden="true"></svg></button><aside class="sg-inspector" aria-label="Agent details" hidden></aside><div class="sg-empty" hidden>No agents match. Clear search or choose All to return.</div></div><div class="sg-footer"><span class="sg-status" role="status"></span><span class="sg-help">Drag nodes to arrange · Scroll to pan · ⌘/Ctrl + scroll to zoom</span></div>`;
    this.viewport=element.querySelector('.sg-viewport');this.world=element.querySelector('.sg-world');this.inspector=element.querySelector('.sg-inspector');
    element.querySelector('input').oninput=e=>{this.query=e.target.value;this.filterChanged();};
    element.querySelector('select').onchange=e=>{this.project=e.target.value;this.filterChanged();};
    element.addEventListener('click',async e=>{
      if(this.suppressClick){this.suppressClick=false;e.preventDefault();return;}
      const target=e.target.closest('button');if(!target)return;
      if(target.matches('.sg-agent-filter')){this.agentsOnly=!this.agentsOnly;this.filterChanged();return;}
      if(target.hasAttribute('data-sg-signal')){this.activityFilter=target.dataset.sgSignal;this.filterChanged();return;}
      if(target.hasAttribute('data-sg-expand')){const id=target.dataset.sgExpand;this.expandedParents.has(id)?this.expandedParents.delete(id):this.expandedParents.add(id);this.autoFit=false;this.draw();this.reveal(id);return;}
      if(target.hasAttribute('data-sg-details')){this.inspected=target.dataset.sgDetails;this.selected=this.inspected;this.draw();return;}
      if(target.hasAttribute('data-sg-close')){const id=this.inspected;this.inspected=null;this.renderInspector();this.element.querySelector(`[data-sg-details="${CSS.escape(id)}"]`)?.focus();return;}
      const id=target.dataset.sessionNode||target.dataset.sgOpen;
      if(id){this.selected=id;this.draw();try{await this.open(id);}catch(error){this.element.querySelector('.sg-status').textContent=error.message;}return;}
      if(target.hasAttribute('data-sg-project')){this.project=target.dataset.sgProject;this.filterChanged();return;}
      if(target.hasAttribute('data-sg-zoom'))this.scale(this.zoom*(Number(target.dataset.sgZoom)>0?1.2:1/1.2));
      if(target.hasAttribute('data-sg-fit'))this.fit();
      if(target.hasAttribute('data-sg-reset'))this.scale(1);
      if(target.hasAttribute('data-sg-arrange')){for(const n of this.graph.nodes)this.positions.delete(n.id);this.savePositions();this.draw();this.fit();}
      if(target.matches('.sg-minimap')){const r=target.getBoundingClientRect(),b=this.graph.bounds;this.pan={x:this.viewport.clientWidth/2-(b.x+(e.clientX-r.left)/r.width*b.width)*this.zoom,y:this.viewport.clientHeight/2-(b.y+(e.clientY-r.top)/r.height*b.height)*this.zoom};this.transform();}
    });
    this.viewport.addEventListener('pointerdown',e=>{
      if(e.button!==0&&e.button!==1)return;
      if(e.target.closest('.sg-node-tools'))return;
      const node=e.target.closest('[data-node-id]'),id=node?.dataset.nodeId,n=this.graph?.nodes.find(n=>n.id===id);
      this.drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,pan:{...this.pan},id:!this.space&&e.button===0?id:null,node:n&&{x:n.x,y:n.y},moved:false};
      if(e.button===1||this.space)e.preventDefault();
    });
    this.viewport.addEventListener('pointermove',e=>{
      const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
      const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.moved&&Math.hypot(dx,dy)<5)return;
      if(!d.moved){d.moved=true;this.viewport.setPointerCapture(e.pointerId);this.viewport.classList.add('dragging');}
      if(d.id){this.positions.set(d.id,{x:d.node.x+dx/this.zoom,y:d.node.y+dy/this.zoom});this.place();}
      else{this.pan={x:d.pan.x+dx,y:d.pan.y+dy};this.transform();}
    });
    const end=e=>{const d=this.drag;if(!d||d.pointer!==e.pointerId)return;this.drag=null;this.viewport.classList.remove('dragging');if(d.moved){this.suppressClick=true;clearTimeout(this.clickTimer);this.clickTimer=setTimeout(()=>this.suppressClick=false,0);if(d.id){const p=this.positions.get(d.id);this.positions.set(d.id,{x:Math.round(p.x/16)*16,y:Math.round(p.y/16)*16});this.savePositions();this.place();}}if(this.viewport.hasPointerCapture(e.pointerId))this.viewport.releasePointerCapture(e.pointerId);};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])this.viewport.addEventListener(type,end);
    this.viewport.addEventListener('wheel',e=>{e.preventDefault();const r=this.viewport.getBoundingClientRect();if(e.ctrlKey||e.metaKey)this.scale(this.zoom*Math.exp(-e.deltaY*.006),{x:e.clientX-r.left,y:e.clientY-r.top});else{const k=e.deltaMode===1?16:e.deltaMode===2?this.viewport.clientHeight:1;this.pan.x-=e.deltaX*k;this.pan.y-=e.deltaY*k;this.transform();}},{passive:false});
    element.addEventListener('keydown',e=>{
      if(e.target.matches('input,select,textarea'))return;
      if(e.code==='Space'&&e.target===this.viewport){e.preventDefault();this.space=true;}
      if(e.key==='Escape'&&this.inspected){this.inspected=null;this.renderInspector();this.viewport.focus();return;}
      const button=e.target.closest('[data-session-node]');
      if(button){const id=adjacentGraphNode(this.graph.nodes,button.dataset.sessionNode,e.key);if(id){e.preventDefault();this.reveal(id);this.element.querySelector(`[data-session-node="${CSS.escape(id)}"]`)?.focus({preventScroll:true});}}
      else if(e.target===this.viewport&&e.key.toLowerCase()==='f'){e.preventDefault();this.fit();}
    });
    element.addEventListener('keyup',e=>{if(e.code==='Space')this.space=false;});
    element.addEventListener('focusin',e=>{const id=e.target.closest('[data-node-id]')?.dataset.nodeId;if(id&&!this.drag)this.reveal(id);});
    this.observer=new ResizeObserver(()=>{if(!this.viewport.clientWidth||!this.state)return;if(!this.graph)this.draw();if(this.autoFit)this.fit();else{this.reveal(this.selected);this.transform(false);}});this.observer.observe(this.viewport);
  }
  savePositions(){try{localStorage.setItem(this.storageKey,JSON.stringify([...this.positions].slice(-2000)));}catch{this.element.querySelector('.sg-status').textContent='Layout could not be saved on this device.';}}
  filterChanged(){this.inspected=null;this.draw();this.home();}
  update(state,host,query='',selected){
    const changed=this.host!==host||this.globalQuery!==query;Object.assign(this,{state,host,globalQuery:query});
    if(!this.inspected&&selected&&state.sessions.some(s=>s.id===selected))this.selected=selected;
    this.element.querySelector('.sg-environment').textContent=host==='all'?'All environments':state.hostNames?.[host]||(host==='local'?'Local':host);
    this.draw();if(changed||!this.initialized){this.home();this.initialized=true;}
  }
  draw(){
    if(!this.state||!this.viewport.clientWidth||this.drag?.moved)return;
    const query=[this.query,this.globalQuery].filter(Boolean).join(' ');
    this.graph=sessionGraph(this.state,this.host,query,this.project,1,this.agentsOnly,this.activityFilter,this.expandedParents);
    const select=this.element.querySelector('select'),options='<option value="">All projects</option>'+this.graph.groups.map(g=>`<option value="${html(g.key)}">${html(g.title+' · '+g.location)}</option>`).join('');
    if(select._markup!==options){select.innerHTML=options;select._markup=options;}select.value=this.project;if(this.project&&!select.value){this.project='';this.draw();return;}
    const toggle=this.element.querySelector('.sg-agent-filter');toggle.textContent=this.agentsOnly?'Agents':'All terminals';toggle.setAttribute('aria-pressed',String(this.agentsOnly));
    const chips=this.element.querySelector('.sg-signals');
    for(const [key,label] of [['','All'],['attention','Needs attention'],['working','Working'],['finished','Just finished'],['idle','Idle'],['unknown','Unknown'],['paused','Paused']]){let button=chips.querySelector(`[data-sg-signal="${key}"]`);if(!button){button=document.createElement('button');button.dataset.sgSignal=key;chips.append(button);}const markup=`<i></i>${label}<strong>${this.graph.counts[key||'all']||0}</strong>`;if(button.innerHTML!==markup)button.innerHTML=markup;button.setAttribute('aria-pressed',String(this.activityFilter===key));}
    const uncertain=this.graph.nodes.filter(n=>n.stale).length;
    this.element.querySelector('.sg-status').textContent=`${this.graph.liveSessions} detected ${this.agentsOnly?'agents':'sessions'}${this.graph.savedChildren?' · '+this.graph.savedChildren+' saved subagents':''} · ${this.graph.sessions} shown${uncertain?' · '+uncertain+' unverified':''}`;
    const container=this.element.querySelector('.sg-nodes'),existing=new Map([...container.children].map(el=>[el.dataset.nodeId,el]));
    for(const node of this.graph.nodes){
      let el=existing.get(node.id);if(!el){el=document.createElement('article');el.dataset.nodeId=node.id;container.append(el);}existing.delete(node.id);
      el.className='sg-node '+(node.kind==='project'?'sg-project':'sg-session')+(node.id===this.selected?' is-selected':'');el.dataset.signal=node.signal?.key||'project';
      let markup;
      if(node.kind==='project')markup=`<button class="sg-project-open" data-sg-project="${html(node.groupKey)}" aria-label="Filter project ${html(node.title)} · ${html(node.location)}"><span class="sg-icon"><span class="sg-provider-mark" aria-hidden="true">⌘</span><small>PROJECT</small><span class="sg-port sg-port-out"></span></span><strong class="sg-name">${html(node.title)}</strong><span class="sg-model">${html(node.location)}</span><span class="sg-project-count">${node.liveCount} agents${node.savedCount?' · '+node.savedCount+' saved':''}</span>${node.statuses.attention?`<span class="sg-project-attention">${node.statuses.attention} need attention</span>`:''}</button>`;
      else{node.selected=node.id===this.selected;markup=nodeMarkup(node,this.expandedParents.has(node.id),node.foldableChildren&&!query&&!this.activityFilter);}
      if(el._markup!==markup){const active=document.activeElement,key=el.contains(active)?['sessionNode','sgExpand','sgDetails','sgProject'].find(key=>active.dataset[key]):null,value=key&&active.dataset[key];el.innerHTML=markup;el._markup=markup;if(key)[...el.querySelectorAll('button')].find(b=>b.dataset[key]===value)?.focus({preventScroll:true});}
    }
    for(const el of existing.values())el.remove();
    this.element.querySelector('.sg-empty').hidden=!!this.graph.sessions;
    this.place();this.renderInspector();
  }
  place(){
    if(!this.graph)return;this.graph=layoutSessionGraph(this.graph,{positions:this.positions});
    const els=new Map([...this.element.querySelector('.sg-nodes').children].map(e=>[e.dataset.nodeId,e]));
    for(const n of this.graph.nodes){const e=els.get(n.id);e.style.left=n.x+'px';e.style.top=n.y+'px';e.style.width=n.width+'px';e.style.height=n.height+'px';}
    this.element.querySelector('.sg-regions').innerHTML=this.graph.regions.map(r=>`<div style="left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px"><span>${html(r.title)} <small>${html(r.location)}</small></span></div>`).join('');
    const byId=new Map(this.graph.nodes.map(n=>[n.id,n]));
    this.element.querySelector('.sg-edges').innerHTML=this.graph.edges.map(edge=>{const a=byId.get(edge.from),b=byId.get(edge.to),active=b.signal?.key==='working',selected=[edge.from,edge.to].includes(this.selected);return `<path class="${edge.kind==='child'?'sg-child ':''}${active?'working ':''}${selected?'selected':''}" d="${graphEdgePath(a,b)}"/>`;}).join('');
    this.transform(false);
  }
  renderInspector(){
    const node=this.graph?.nodes.find(n=>n.id===this.inspected&&n.kind==='session');this.inspector.hidden=!node;if(!node)return;
    const markup=inspectorMarkup(node);if(markup!==this.inspector._markup){const top=this.inspector.querySelector('.sg-inspector-body')?.scrollTop||0,active=document.activeElement,close=active?.hasAttribute('data-sg-close'),open=active?.hasAttribute('data-sg-open');this.inspector.innerHTML=markup;this.inspector._markup=markup;this.inspector.querySelector('.sg-inspector-body').scrollTop=top;if(close)this.inspector.querySelector('[data-sg-close]').focus({preventScroll:true});if(open)this.inspector.querySelector('[data-sg-open]').focus({preventScroll:true});}
  }
  transform(manual=true){
    if(manual)this.autoFit=false;
    this.world.style.transform=`translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;
    this.viewport.style.backgroundSize=`${20*this.zoom}px ${20*this.zoom}px`;this.viewport.style.backgroundPosition=`${this.pan.x}px ${this.pan.y}px`;
    this.element.querySelector('[data-sg-reset]').textContent=Math.round(this.zoom*100)+'%';
    if(this.graph){const b=this.graph.bounds,svg=this.element.querySelector('.sg-minimap svg');svg.setAttribute('viewBox',`${b.x} ${b.y} ${b.width} ${b.height}`);svg.setAttribute('preserveAspectRatio','none');svg.innerHTML=this.graph.nodes.map(n=>`<rect class="${n.id===this.selected?'selected':n.kind}" x="${n.x+n.width/2-40}" y="${n.y+8}" width="80" height="80" rx="12"/>`).join('')+`<rect class="sg-camera" x="${-this.pan.x/this.zoom}" y="${-this.pan.y/this.zoom}" width="${this.viewport.clientWidth/this.zoom}" height="${this.viewport.clientHeight/this.zoom}"/>`;}
  }
  scale(value,anchor={x:this.viewport.clientWidth/2,y:this.viewport.clientHeight/2}){const next=Math.max(.03,Math.min(2,value)),ratio=next/this.zoom;this.pan={x:anchor.x-(anchor.x-this.pan.x)*ratio,y:anchor.y-(anchor.y-this.pan.y)*ratio};this.zoom=next;this.transform();}
  fit(){if(!this.graph||!this.viewport.clientWidth)return;const b=graphBounds(this.graph.nodes,32),width=this.viewport.clientWidth,height=Math.max(80,this.viewport.clientHeight-60);this.zoom=Math.min(1,width/b.width,height/b.height);this.pan={x:(width-b.width*this.zoom)/2-b.x*this.zoom,y:(height-b.height*this.zoom)/2-b.y*this.zoom};this.autoFit=true;this.transform(false);}
  home(){this.fit();if(this.zoom<.65){const b=graphBounds(this.graph.nodes,32);this.zoom=.85;this.pan={x:24-b.x*this.zoom,y:24-b.y*this.zoom};this.autoFit=false;this.transform(false);}}
  reveal(id){if(!this.graph)return;const n=this.graph.nodes.find(n=>n.id===id);if(!n)return;const x=n.x*this.zoom+this.pan.x,y=n.y*this.zoom+this.pan.y,width=this.viewport.clientWidth,height=this.viewport.clientHeight-60;if(x<0||x+n.width*this.zoom>width||y<0||y+n.height*this.zoom>height){this.pan={x:width/2-(n.x+n.width/2)*this.zoom,y:height/2-(n.y+n.height/2)*this.zoom};this.transform();}}
  dispose(){this.observer.disconnect();clearTimeout(this.clickTimer);}
}
