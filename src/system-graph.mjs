import { systemGraph, graphLayout, graphId, latestTrace } from '../shared/system-graph.mjs';
import { consoleText, traceMarkup } from './console-format.mjs';

const html=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=value=>value && Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Not recorded';
const plain=value=>typeof value==='object'?JSON.stringify(value,null,2):String(value ?? 'Not recorded');
const detail=(title,body,key=title,open=false)=>`<details class="graph-detail" data-graph-detail="${html(key)}"${open?' open':''}><summary>${html(title)}</summary>${body}</details>`;
const prose=value=>`<div class="graph-prose">${consoleText(value || 'Not recorded',{markdown:true})}</div>`;
const pre=value=>`<pre class="graph-record">${html(plain(value))}</pre>`;
const facts=entries=>`<dl class="graph-facts">${entries.filter(([,value])=>value!==undefined && value!==null && value!=='').map(([label,value])=>`<dt>${html(label)}</dt><dd>${html(plain(value))}</dd>`).join('')}</dl>`;
const tone=status=>/failed|error|unavailable|disconnected/.test(status)?'error':/working|in_progress|collecting|scanning/.test(status)?'working':/blocked|uncertain|stale|unknown|not_run|partial/.test(status)?'warning':/done|complete|executed|acknowledged|responded/.test(status)?'success':'neutral';
const button=(id,label)=>`<button data-graph-select="${html(id)}">${html(label)}</button>`;

export class SystemGraphView {
  constructor(element,{open,api,refresh}) {
    Object.assign(this,{element,open,api,refresh,selected:'conductor',zoom:1,limit:400,query:'',kind:'',projectId:'',output:null});
    element.classList.add('system-graph');
    element.innerHTML=`<div class="graph-toolbar"><strong>System graph</strong><span class="graph-environment"></span><button data-graph-open="conductor">Open Conductor</button><button data-graph-fit>Fit</button><button data-graph-zoom="-1" aria-label="Zoom out">−</button><button data-graph-zoom="1" aria-label="Zoom in">+</button><button data-graph-reset>100%</button></div>
      <div class="graph-filters"><input type="search" aria-label="Search system graph" placeholder="Find agent, task, service…"><select aria-label="Graph node type"><option value="">All types</option>${['conductor','service','project','work','team','agent','terminal','runtime','sandbox','task','action','browser'].map(kind=>`<option>${kind}</option>`).join('')}</select><select class="graph-project" aria-label="Graph project"><option value="">All projects</option></select><button data-graph-clear>Clear filters</button></div>
      <div class="graph-status" role="status"></div><div class="graph-body"><div class="graph-map"><div class="graph-viewport" tabindex="0" role="region" aria-label="System graph canvas. Scroll or drag empty space to pan. Use zoom buttons to scale."><div class="graph-size"><div class="graph-world"><svg class="graph-edges" aria-hidden="true"></svg><div class="graph-nodes"></div></div></div></div><div class="graph-legend"><span>→ relationship</span><span class="graph-message-key">⇢ message / delivery</span><span class="graph-active-key">● working</span><span>Process ≠ task completion</span></div></div><aside class="graph-inspector" aria-label="Selected system node"></aside></div>`;
    this.viewport=element.querySelector('.graph-viewport');this.world=element.querySelector('.graph-world');this.size=element.querySelector('.graph-size');this.inspector=element.querySelector('.graph-inspector');
    element.querySelector('input').addEventListener('input',e=>{this.query=e.target.value;this.draw();});
    element.querySelector('select').addEventListener('change',e=>{this.kind=e.target.value;this.draw();});
    element.querySelector('.graph-project').addEventListener('change',e=>{this.projectId=e.target.value;this.draw();});
    element.addEventListener('click',e=>{
      const target=e.target.closest('button');if(!target)return;
      if(target.hasAttribute('data-graph-node') || target.hasAttribute('data-graph-select'))this.select(target.dataset.graphNode || target.dataset.graphSelect,{reveal:target.hasAttribute('data-graph-select')});
      if(target.dataset.graphOpen)this.open(target.dataset.graphOpen);
      if(target.hasAttribute('data-graph-fit'))this.fit();
      if(target.hasAttribute('data-graph-reset'))this.scale(1);
      if(target.dataset.graphZoom)this.scale(this.zoom*(Number(target.dataset.graphZoom)>0?1.2:1/1.2));
      if(target.hasAttribute('data-graph-more')){this.limit+=400;this.draw();}
      if(target.hasAttribute('data-graph-empty')){this.includeEmpty=true;this.draw();}
      if(target.hasAttribute('data-graph-clear')){this.query='';this.kind='';this.projectId='';element.querySelector('input').value='';for(const select of element.querySelectorAll('select'))select.value='';this.draw();}
      if(target.hasAttribute('data-graph-output-retry')){this.output=null;this.loadOutput();}
      if(target.hasAttribute('data-graph-cancel'))this.api('/coordinator/cancel',{}).then(this.refresh).catch(error=>{this.actionError=error.message;this.inspect();});
    });
    this.viewport.addEventListener('wheel',e=>{if(!e.ctrlKey && !e.metaKey)return;e.preventDefault();this.scale(this.zoom*(e.deltaY<0?1.12:1/1.12));},{passive:false});
    this.viewport.addEventListener('pointerdown',e=>{if(e.button!==0 || e.target.closest('button'))return;this.drag={x:e.clientX,y:e.clientY,left:this.viewport.scrollLeft,top:this.viewport.scrollTop};this.viewport.setPointerCapture(e.pointerId);});
    this.viewport.addEventListener('pointermove',e=>{if(this.drag){this.viewport.scrollLeft=this.drag.left+this.drag.x-e.clientX;this.viewport.scrollTop=this.drag.top+this.drag.y-e.clientY;}});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])this.viewport.addEventListener(type,()=>{this.drag=null;});
    this.viewport.addEventListener('keydown',e=>{if(e.target!==this.viewport)return;if(e.key==='+'||e.key==='='){e.preventDefault();this.scale(this.zoom*1.2);}if(e.key==='-'){e.preventDefault();this.scale(this.zoom/1.2);}if(e.key==='0'){e.preventDefault();this.scale(1);}});
  }
  update(state,environment,receivedAt,{offline=false}={}) {
    if(this.environment!==environment){this.selected='conductor';this.output=null;this.projectId='';this.element.querySelector('.graph-project').value='';}
    Object.assign(this,{state,environment,receivedAt,offline});this.graph=systemGraph(state,environment);
    this.element.querySelector('.graph-environment').textContent=(state.hostNames?.[environment] || (environment==='local'?'Local':environment))+' · selected environment';
    const select=this.element.querySelector('.graph-project'),options='<option value="">All projects</option>'+this.graph.nodes.filter(n=>n.kind==='project').map(n=>`<option value="${html(n.projectId)}">${html(n.title)}</option>`).join('');
    if(select._markup!==options){select.innerHTML=options;select._markup=options;select.value=this.projectId;if(!select.value)this.projectId='';}
    this.draw();if(!this.element.hidden&&!offline){if(!this.fitted){this.scale(Math.max(.55,Math.min((this.viewport.clientWidth-30)/this.layout.width,(this.viewport.clientHeight-30)/this.layout.height,1)),false);this.fitted=true;}this.loadOutput();}
  }
  draw() {
    if(!this.graph)return;
    this.layout=graphLayout(this.graph,this);
    const status=this.element.querySelector('.graph-status'),coverage=this.graph.coverage;
    status.classList.toggle('graph-offline',!!this.offline);
    status.innerHTML=`<span>${this.offline?'Disconnected · showing last received state':`Updated ${html(when(this.receivedAt))} · refresh every ${(this.state.background?.interface?.intervalMs || 5000)/1000}s`} · ${this.layout.matched} matching / ${this.graph.nodes.length} nodes${this.layout.filtered?' · filtered':''}</span>${this.layout.omitted?` <button data-graph-more>Show ${Math.min(400,this.layout.omitted)} more (${this.layout.omitted} hidden)</button>`:''}${this.layout.emptyProjects?`<button data-graph-empty>Show ${this.layout.emptyProjects} projects without observed work</button>`:''}${this.graph.warnings.length?`<span class="graph-warning">${this.graph.warnings.length} source warning${this.graph.warnings.length===1?'':'s'} · inspect discovery</span>`:''}${coverage.messages?.omitted?`<span>Messages: latest ${coverage.messages.shown} of ${coverage.messages.total} across all environments; open conversations for more.</span>`:''}`;
    const container=this.element.querySelector('.graph-nodes'),existing=new Map([...container.children].map(el=>[el.dataset.graphNode,el]));
    for(const node of this.layout.nodes) {
      let el=existing.get(node.id);if(!el){el=document.createElement('button');el.type='button';el.className='graph-node';el.dataset.graphNode=node.id;container.append(el);}existing.delete(node.id);
      const markup=`<span class="graph-node-kind">${html(node.kind)}</span><strong>${html(node.title)}</strong><span class="graph-node-status"><i aria-hidden="true"></i>${html(node.status)}</span><span class="graph-node-summary">${html(node.summary)}</span>`;
      if(el._markup!==markup){el.innerHTML=markup;el._markup=markup;}
      el.style.left=node.x+'px';el.style.top=node.y+'px';el.dataset.tone=tone(node.status);el.classList.toggle('selected',node.id===this.selected);el.setAttribute('aria-pressed',String(node.id===this.selected));el.setAttribute('aria-label',`${node.title} · ${node.kind} · ${node.status}${node.summary?' · '+node.summary:''}`);
    }
    for(const el of existing.values())el.remove();
    const byId=new Map(this.layout.nodes.map(n=>[n.id,n]));
    const neighbors=new Set(this.layout.edges.filter(e=>e.from===this.selected||e.to===this.selected).map(e=>e.id));
    const svg=this.element.querySelector('.graph-edges');svg.setAttribute('width',this.layout.width);svg.setAttribute('height',this.layout.height);
    svg.innerHTML='<defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>'+this.layout.edges.map(e=>{
      const a=byId.get(e.from),b=byId.get(e.to),back=b.x<=a.x,x1=a.x+(back?0:244),x2=b.x+(back?244:0),y1=a.y+50,y2=b.y+50,bend=Math.max(50,Math.abs(x2-x1)/2),direction=back?-1:1;
      return `<path class="graph-edge ${e.type==='message'?'message':''} ${neighbors.has(e.id)?'related':''} ${e.status==='working'||e.status==='started'?'active':''}" d="M${x1},${y1} C${x1+bend*direction},${y1} ${x2-bend*direction},${y2} ${x2},${y2}" marker-end="url(#graph-arrow)"><title>${html(e.label)}</title></path>`;
    }).join('');
    this.scale(this.zoom,false);this.inspect();
  }
  select(id,{reveal=false}={}) {
    if(this.selected!==id){this.selected=id;this.output=null;this.actionError=null;this.inspector.scrollTop=0;this.inspector._node=null;}
    this.draw();this.loadOutput();
    if(reveal){const node=this.layout.nodes.find(n=>n.id===id);if(node){this.viewport.scrollLeft=Math.max(0,node.x*this.zoom-40);this.viewport.scrollTop=Math.max(0,node.y*this.zoom-40);this.element.querySelector(`[data-graph-node="${CSS.escape(id)}"]`)?.focus({preventScroll:true});}}
  }
  scale(value,center=true) {
    if(!this.layout)return;
    const previous=this.zoom;this.zoom=Math.max(.12,Math.min(1.8,value));
    const {scrollLeft,scrollTop,clientWidth,clientHeight}=this.viewport;
    this.size.style.width=this.layout.width*this.zoom+'px';this.size.style.height=this.layout.height*this.zoom+'px';this.world.style.width=this.layout.width+'px';this.world.style.height=this.layout.height+'px';this.world.style.transform=`scale(${this.zoom})`;
    this.world.style.setProperty('--graph-ink',Math.min(2.5,Math.max(1,1/this.zoom)));this.world.dataset.density=this.zoom<.7?'compact':'full';
    if(center){this.viewport.scrollLeft=(scrollLeft+clientWidth/2)*this.zoom/previous-clientWidth/2;this.viewport.scrollTop=(scrollTop+clientHeight/2)*this.zoom/previous-clientHeight/2;}
    this.element.querySelector('[data-graph-reset]').textContent=Math.round(this.zoom*100)+'%';
  }
  fit() {if(this.layout){this.scale(Math.min((this.viewport.clientWidth-30)/this.layout.width,(this.viewport.clientHeight-30)/this.layout.height,1),false);this.viewport.scrollLeft=0;this.viewport.scrollTop=0;}}
  async loadOutput() {
    const node=this.graph?.nodes.find(n=>n.id===this.selected);
    if(!node?.historyId || this.element.hidden || this.offline)return;
    const key=this.environment+':'+node.historyId;
    if(this.output?.key===key && (this.output.loading || Date.now()-this.output.at<5000))return;
    const previous=this.output?.key===key?this.output.data:null;
    const request=this.output={key,loading:true,at:Date.now(),data:previous};this.inspect();
    try {request.data=await this.api('/history/'+encodeURIComponent(node.historyId));request.error=null;}
    catch(error){request.error=error.message;}
    finally{request.loading=false;if(this.output===request && this.selected===node.id)this.inspect();}
  }
  inspect() {
    const node=this.graph?.nodes.find(n=>n.id===this.selected);
    if(!node){this.inspector.innerHTML='<p class="muted">This node is no longer in the observed inventory. Select another node; disappearance does not prove task completion.</p>';return;}
    const related=this.graph.edges.filter(e=>e.from===node.id || e.to===node.id),name=id=>this.graph.nodes.find(n=>n.id===id)?.title || id;
    let body=`<div class="graph-inspector-heading"><small>${html(node.kind)}</small><h2>${html(node.title)}</h2><span class="graph-state" data-tone="${tone(node.status)}">${html(node.status)}</span></div>${node.open?`<button class="graph-open" data-graph-open="${html(node.open)}">${['agent','terminal','runtime'].includes(node.kind)?'Open conversation / terminal':node.kind==='conductor'?'Open Conductor conversation':'Open '+html(node.kind)}</button>`:''}`;
    if(node.kind==='agent'||node.kind==='terminal'||node.kind==='runtime') {
      const {agent,tasks,contact}=node.details;
      body+=facts([['Process',agent.kind==='enrolled'?'Unknown · enrollment does not observe this process':node.status],['Provider',agent.provider],['Directory',agent.cwd],['Role',agent.role],['Started',when(agent.createdAt || agent.startedAt)],['History match',agent.historyMatch],['Last platform contact',contact?.lastFinishedAt?when(contact.lastFinishedAt):'Not observed'],['Last request',contact?`${contact.command} · ${contact.active?'in flight':contact.lastStatus}`:'Not observed'],['Context',agent.contextIsolation || 'Original assignment']]);
      body+=detail('Current work',tasks.length?tasks.map(t=>`<div class="graph-task">${button(graphId('task',t.id),t.title)}<span>${html(t.status)} · reported task state</span>${prose(t.lastReport?.summary || t.lastReport?.notes || t.notes)}${t.lastReport?.blocker?prose('Blocker: '+t.lastReport.blocker):''}${t.lastReport?.nextStep?prose('Next: '+t.lastReport.nextStep):''}</div>`).join(''):'<p>No structured progress report. A live process does not tell us what it is doing.</p>','work',true);
      body+=detail('Initial prompt',agent.initialPrompt?.text?`<p>Recorded at launch · ${html(when(agent.initialPrompt.recordedAt))}${agent.initialPrompt.resumedFrom?' · continuation of an earlier conversation':''}. Provider/system instructions are not captured here.</p>`+pre(agent.initialPrompt.text):'<p>The original launch prompt was not captured for this agent. A current mission is not evidence of its initial prompt.</p>','prompt');
      if(agent.mission)body+=detail('Assigned mission',prose(agent.mission),'mission');
      body+=this.outputMarkup(node);
      if(contact)body+=detail('MCP / helper contact',facts(Object.entries(contact))+'<p>Observed requests prove contact only. The stdio process may have disconnected.</p>','contact');
    } else if(node.kind==='sandbox') {
      const {agent,execution:x}=node.details;
      body+=facts([['Runtime',x.state],['Workspace',x.workspace],['Source commit',x.baseCommit],['Network',x.networkMode],['CPU limit',x.limits?.cpu],['Memory limit',x.limits?.memoryMb+' MiB'],['Process limit',x.limits?.pids],['Engine',x.engine],['Image',x.image],['Observed',when(x.observedAt)]])+prose('Private home, repository copy and browser. Closing a view or quitting the app preserves this runtime. Stopped workspace data remains available for export.');
      if(x.error)body+=prose(x.error);
      body+=button(graphId('agent',agent.id),'Inspect agent');
      if(agent.parentAgentId)body+=button(graphId('agent',agent.parentAgentId),'Inspect parent agent');
    } else if(node.kind==='conductor') {
      const {turn,...status}=node.details;
      body+=prose(this.graph.current.label)+facts([['Mode',turn?.mode],['Request started',when(turn?.createdAt)],['Last phase',status.phase],['Last collection',when(status.loop?.lastCollectedAt)],['Next background round',status.loop?.nextRoundAt?when(status.loop.nextRoundAt):'None scheduled'],['Last error',status.loop?.lastError]]);
      body+=`<div class="graph-controls">${status.loop?.state==='running'?'<button data-loop-control="paused">Pause background</button>':'<button data-loop-control="running">Start background</button>'}${status.loop?.state!=='stopped'?'<button data-loop-control="stopped">Stop background</button>':''}${status.running?'<button data-graph-cancel>Stop current reply</button>':''}</div>`;
      if(this.actionError)body+=`<p role="alert">${html(this.actionError)}</p>`;
      if(turn){body+=detail(status.running?'Current request':'Last request',prose(turn.prompt),'request',true);body+=detail('Visible working details',latestTrace(turn).map(traceMarkup).join('') || '<p>No provider event received yet.</p>','trace',true);if(turn.answer)body+=detail('Latest response',prose(turn.answer),'answer');}
      body+=detail('Background coordination',facts(Object.entries(status.loop || {})),'loop');
    } else if(node.kind==='action') {
      body+=facts([['State',node.status],['Started',when(node.details.startedAt)],['Finished',when(node.details.finishedAt)]])+detail('Requested action',pre(node.details.action),'requested',true)+detail('Receipt / result',pre(node.details.result || 'No result yet. Started does not mean completed.'),'receipt',true);
    } else if(node.kind==='operation')body+=traceMarkup(node.details);
    else if(node.kind==='task') {
      const task=node.details;body+=prose(task.notes)+detail('Latest report',pre(task.lastReport || 'No report'),'report',true)+detail('Evidence (attributed claims)',pre(task.evidence || []),'evidence',true);if(task.agentId)body+=button(graphId('agent',task.agentId),'Inspect assigned agent');
    } else if(node.id==='mcp') {
      body+=prose(node.details.note || (node.details.state?'The platform endpoint is available. Observed requests prove contact, not a permanently connected MCP process.':'This build has not reported MCP endpoint status.'))+facts([['Mode',node.details.mode],['Observed clients',node.details.clients?.length ?? 0]]);
      body+=detail('Coordinate from your terminal',prose('Agents with the `super_terminal` MCP server can use `st_context`, `st_graph`, `st_conductor`, `st_tasks`, `st_report`, `st_send`, `st_inbox` and `st_ack` in their normal conversation. Send to `coordinator` to reach Conductor. Messages are queued; they do not resume a paused loop or grant authority beyond the assignment. Existing external agents require explicit enrollment.'),'workflow',true);
      body+=(node.details.clients || []).map(client=>`<div class="graph-contact">${button(graphId('agent',client.agentId),name(graphId('agent',client.agentId)))}${facts([['Transport',client.transport],['Request',client.command],['Result',client.active?'in flight':client.lastStatus],['Last contact',when(client.lastFinishedAt)]])}</div>`).join('');
    } else body+=detail('Observed details',pre(node.details),'observed',true);
    if(related.length)body+=detail('Connections',related.map(edge=>{const target=edge.from===node.id?edge.to:edge.from;return `<div class="graph-relation"><span>${edge.from===node.id?'→':'←'} ${html(edge.label)}</span>${button(target,name(target))}</div>`;}).join(''),'connections',true);
    const messages=related.filter(e=>e.type==='message').flatMap(e=>e.messages || []);
    if(messages.length)body+=detail('Messages',messages.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).map(m=>`<article class="graph-message"><small>${html(name(['conductor','coordinator'].includes(m.from)?'conductor':m.from==='you'?'owner':graphId('agent',m.from)))} → ${html(name(['conductor','coordinator'].includes(m.to)?'conductor':graphId('agent',m.to)))}</small><span>${html(m.delivery || (m.read?'fetched':'queued'))} · ${html(when(m.createdAt))}</span>${prose(m.text)}</article>`).join(''),'messages',true);
    const timeline=node.id==='conductor'||node.id==='service'?this.graph.timeline:this.graph.timeline.filter(e=>e.nodeId===node.id || e.from===node.id || e.to===node.id);
    body+=detail('Recent activity',timeline.length?timeline.map(e=>`<article class="graph-event"><small>${html(when(e.at))} · ${html(e.status)}</small>${button(e.nodeId,e.kind)}${prose(e.text)}</article>`).join(''):'<p>No recent activity observed in this snapshot.</p>','activity');
    const coverage=this.graph.coverage;
    body+=`<p class="graph-boundary">Discovery is best effort. Reports are actor claims; provider-internal reasoning and unlogged output are unavailable.${coverage.actionsOmitted?` ${coverage.actionsOmitted} older actions are in the Conductor conversation.`:''}${coverage.eventsOmitted?` ${coverage.eventsOmitted} events are outside this activity window.`:''}${coverage.traceOmitted?' The provider trace was bounded.':''}</p>`;
    if(body===this.inspector._markup)return;
    const same=this.inspector._node===node.id,expanded=new Set([...this.inspector.querySelectorAll('details[open]')].map(el=>el.dataset.graphDetail));
    const scroll=this.inspector.scrollTop,active=document.activeElement,focus=active && this.inspector.contains(active)?{select:active.dataset.graphSelect,open:active.dataset.graphOpen,detail:active.parentElement?.dataset.graphDetail}:null;
    this.inspector.innerHTML=body;this.inspector._markup=body;this.inspector._node=node.id;
    if(same){for(const el of this.inspector.querySelectorAll('details'))el.open=expanded.has(el.dataset.graphDetail);this.inspector.scrollTop=scroll;if(focus){const selector=focus.select?`[data-graph-select="${CSS.escape(focus.select)}"]`:focus.open?`[data-graph-open="${CSS.escape(focus.open)}"]`:focus.detail?`[data-graph-detail="${CSS.escape(focus.detail)}"] > summary`:null;if(selector)this.inspector.querySelector(selector)?.focus({preventScroll:true});}}
  }
  outputMarkup(node) {
    if(!node.historyId)return detail('Recent output','<p>No saved conversation is linked. Open the terminal for live output when available. Enrolled external processes may have no observable transcript.</p>','output',true);
    const output=this.output,events=output?.data?.events || output?.data?.messages || [];
    let content=output?.error?`<p role="status">${html(output.error)}${output.data?' · showing the previous snapshot':''}</p><button data-graph-output-retry>Retry output</button>`:output?.loading?'<p>Refreshing saved output…</p>':'';
    content+=events.slice(-6).map(e=>`<article class="graph-event"><small>${html(e.role || e.kind)} · ${html(when(e.timestamp))}</small>${prose(e.text)}</article>`).join('');
    if(output?.data)content+=`<p>Latest ${Math.min(6,events.length)} of ${events.length} events in this page${output.data.nextCursor!==null && output.data.nextCursor!==undefined?' · earlier pages available':''}. Saved output may lag the terminal.</p>`;
    const first=output?.data?.coverage?.from===0?events.find(e=>e.role==='user'):null;
    if(first)content+=detail('First recorded user message',pre(first.text),'first-user');
    content+=`<button data-graph-open="${html(node.historyId)}">Open saved conversation</button>`;
    return detail('Recent output',content,'output',true);
  }
}
