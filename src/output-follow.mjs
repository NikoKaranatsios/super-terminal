// A view owns its reading position even while hidden or being reparented.
export class OutputFollow {
  constructor(element, {key='',storage=globalThis.localStorage,onChange=()=>{}} = {}) {
    this.element=element;this.onChange=onChange;this.storage=storage;this.key=key;
    this.following=true;this.unread=false;this.lastTop=0;this.scheduled=false;this.disposed=false;
    try{this.pinned=storage?.getItem(key)==='pinned';}catch{this.pinned=false;}
    this.scroll=()=>{
      if(!this.visible())return;
      const top=element.scrollTop;
      if(this.pinned){if(!this.atBottom())this.schedule();}
      else if(this.expectedTop!=null && Math.abs(top-this.expectedTop)<2)this.expectedTop=null;
      else if(this.atBottom()){this.following=true;this.unread=false;}
      else if(top<this.lastTop-1){this.following=false;this.expectedTop=null;}
      this.lastTop=top;this.readingAnchor=this.anchor();this.onChange(this);
    };
    element.addEventListener('scroll',this.scroll,{passive:true});
    this.observer=new ResizeObserver(()=>this.activate());this.observer.observe(element);
  }
  visible(){return this.element.clientHeight>0 && this.element.getClientRects().length>0;}
  atBottom(){return this.element.scrollHeight-this.element.clientHeight-this.element.scrollTop<3;}
  anchor(){
    if(!this.visible())return this.readingAnchor || {top:this.lastTop};
    const rect=this.element.getBoundingClientRect();
    const row=[...this.element.querySelectorAll('[data-output-id]')].find(el=>el.getBoundingClientRect().bottom>rect.top+1);
    return {top:this.element.scrollTop,id:row?.dataset.outputId,offset:row?row.getBoundingClientRect().top-rect.top:0};
  }
  beforeUpdate({earlier=false}={}){
    const anchor=this.anchor();
    if(earlier){this.following=false;this.pinned=false;this.persist();}
    return anchor;
  }
  afterUpdate(anchor,{newOutput=false}={}){
    if(newOutput&&!this.following&&!this.pinned)this.unread=true;
    if(!this.following&&!this.pinned)this.readingAnchor=anchor;
    this.activate();this.onChange(this);
  }
  setTop(top){this.expectedTop=Math.max(0,top);this.element.scrollTop=this.expectedTop;this.lastTop=this.element.scrollTop;}
  activate(){
    if(this.disposed||!this.visible())return;
    if(this.following||this.pinned)this.schedule();
    else if(this.readingAnchor){
      const a=this.readingAnchor,row=a.id?[...this.element.querySelectorAll('[data-output-id]')].find(el=>el.dataset.outputId===a.id):null;
      this.setTop(row?this.element.scrollTop+row.getBoundingClientRect().top-this.element.getBoundingClientRect().top-a.offset:a.top);
    }
  }
  schedule(){if(this.scheduled||this.disposed)return;this.scheduled=true;requestAnimationFrame(()=>{this.scheduled=false;if(this.disposed||!this.visible())return;if(this.following||this.pinned){this.setTop(this.element.scrollHeight-this.element.clientHeight);this.unread=false;this.onChange(this);}});}
  pauseReading(){this.following=false;this.readingAnchor=this.anchor();this.onChange(this);}
  latest(){this.following=true;this.unread=false;this.schedule();this.onChange(this);}
  pin(value){this.pinned=value;this.persist();if(value)this.latest();this.onChange(this);}
  persist(){try{if(this.key)this.storage?.setItem(this.key,this.pinned?'pinned':'auto');}catch{}}
  dispose(){this.disposed=true;this.observer.disconnect();this.element.removeEventListener('scroll',this.scroll);}
}

export function outputControls(){return '<div class="output-controls"><span class="output-follow-status" role="status"></span><button type="button" data-scroll-latest hidden>Jump to latest ↓</button><button type="button" data-scroll-pin aria-pressed="false" title="Keep the newest output visible even while output grows">Pin to bottom</button></div>';}
export function paintFollow(container,follow){
  container.querySelector('.output-follow-status').textContent=follow.pinned?'Pinned to latest':follow.following?'Following latest':'Reading earlier output';
  const latest=container.querySelector('[data-scroll-latest]');latest.hidden=follow.following||follow.pinned;latest.textContent=follow.unread?'New output ↓':'Jump to latest ↓';
  const pin=container.querySelector('[data-scroll-pin]');pin.setAttribute('aria-pressed',String(!!follow.pinned));pin.textContent=follow.pinned?'Unpin from bottom':'Pin to bottom';
}

export class TerminalFollow {
  constructor(term,{key='',storage=globalThis.localStorage,onChange=()=>{}}={}){
    this.term=term;this.key=key;this.storage=storage;this.onChange=onChange;this.following=true;this.unread=false;this.writing=0;
    try{this.pinned=storage?.getItem(key)==='pinned';}catch{this.pinned=false;}
    this.wheel=e=>{if(e.deltaY<0&&!this.pinned){this.following=false;this.onChange(this);}};
    term.element?.addEventListener('wheel',this.wheel,{passive:true});
    this.subscription=term.onScroll(()=>{
      if(this.resizing)return;
      if(this.pinned)this.activate();else this.following=term.buffer.active.viewportY>=term.buffer.active.baseY;
      if(this.following)this.unread=false;onChange(this);
    });
  }
  write(data){this.writing++;this.term.write(data,()=>{this.writing--;if(!this.following&&!this.pinned)this.unread=true;this.activate();this.onChange(this);});}
  activate(){if(this.following||this.pinned){this.term.scrollToBottom();this.unread=false;}}
  latest(){this.following=true;this.unread=false;this.activate();this.onChange(this);}
  pin(value){this.pinned=value;try{this.storage?.setItem(this.key,value?'pinned':'auto');}catch{}if(value)this.latest();this.onChange(this);}
  dispose(){this.subscription.dispose();this.term.element?.removeEventListener('wheel',this.wheel);}
}

// Only changed records are replaced: reading/selection in older turns survives streaming.
export function reconcileOutput(element,records){
  const nodes=new Map([...element.children].map(el=>[el.dataset.outputId,el]));let cursor=element.firstElementChild;
  for(const {id,html,source} of records){
    let node=nodes.get(id);nodes.delete(id);
    if(!node){node=document.createElement('article');node.dataset.outputId=id;}
    node._outputSource=source;
    if(node._outputMarkup!==html){
      const opened=new Set([...node.querySelectorAll('details[open]')].map(d=>d.dataset.detailId || d.dataset.traceId).filter(Boolean));
      const focus=node.contains(document.activeElement)?document.activeElement?.getAttribute('data-detail-id'):null;
      node.innerHTML=html;node._outputMarkup=html;
      for(const detail of node.querySelectorAll('details'))if(opened.has(detail.dataset.detailId || detail.dataset.traceId))detail.open=true;
      if(focus)[...node.querySelectorAll('[data-detail-id]')].find(el=>el.dataset.detailId===focus)?.focus();
    }
    if(node!==cursor)element.insertBefore(node,cursor);cursor=node.nextElementSibling;
  }
  for(const node of nodes.values())node.remove();
}
