const id = () => crypto.randomUUID();
const leaf = () => ({ id:id(), tabs:[], active:null });
export class Workspace {
  constructor(saved) {
    try {
      const value=typeof saved==='string'?JSON.parse(saved):saved, seen=new Set(); let count=0;
      const validate=(node,depth=0)=>{
        if(!node || typeof node.id!=='string' || !/^[a-f0-9-]{36}$/.test(node.id) || depth>10 || seen.has(node.id))throw new Error();seen.add(node.id);
        if(node.axis){if(!['row','column'].includes(node.axis))throw new Error();node.ratio=Math.max(.15,Math.min(.85,Number(node.ratio)||.5));validate(node.first,depth+1);validate(node.second,depth+1);}
        else {if(++count>6 || !Array.isArray(node.tabs) || node.tabs.length>50)throw new Error();for(const t of node.tabs){if(typeof t!=='string'||t.length>600||seen.has('tab:'+t))throw new Error();seen.add('tab:'+t);}node.active=node.tabs.includes(node.active)?node.active:node.tabs.at(-1)||null;}
      };
      validate(value.root);this.root=value.root;this.activePane=this.panes().some(p=>p.id===value.activePane)?value.activePane:this.panes()[0].id;
    } catch {this.root=leaf();this.activePane=this.root.id;}
  }
  panes(node=this.root){return node.axis?[...this.panes(node.first),...this.panes(node.second)]:[node];}
  nodes(node=this.root){return node.axis?[node,...this.nodes(node.first),...this.nodes(node.second)]:[node];}
  current(){return this.panes().find(p=>p.id===this.activePane)||this.panes()[0];}
  open(viewId){const pane=this.panes().find(p=>p.tabs.includes(viewId))||this.current();if(!pane.tabs.includes(viewId))pane.tabs.push(viewId);pane.active=viewId;this.activePane=pane.id;return pane;}
  focus(paneId){if(this.panes().some(p=>p.id===paneId))this.activePane=paneId;return this.current();}
  split(axis='row'){
    if(!['row','column'].includes(axis))throw new Error('Invalid split direction.');
    if(this.panes().length>=6)throw new Error('Use another window for more than six panels.');
    const target=this.current(),next=leaf(),branch={id:id(),axis,ratio:.5,first:target,second:next};
    const replace=node=>node.id===target.id?branch:node.axis?{...node,first:replace(node.first),second:replace(node.second)}:node;
    this.root=replace(this.root);this.activePane=next.id;return next;
  }
  resize(nodeId,ratio){const node=this.nodes().find(n=>n.id===nodeId);if(node?.axis&&Number.isFinite(ratio))node.ratio=Math.max(.15,Math.min(.85,ratio));}
  close(viewId){
    const pane=this.panes().find(p=>p.tabs.includes(viewId));if(!pane)return;
    pane.tabs=pane.tabs.filter(t=>t!==viewId);if(pane.active===viewId)pane.active=pane.tabs.at(-1)||null;
    if(!pane.tabs.length)this.removeEmpty(pane.id);
  }
  removeEmpty(paneId){
    const pane=this.panes().find(p=>p.id===paneId);
    if(pane&&!pane.tabs.length&&this.panes().length>1){
      const remove=node=>{if(!node.axis)return node;if(node.first.id===pane.id)return node.second;if(node.second.id===pane.id)return node.first;return {...node,first:remove(node.first),second:remove(node.second)};};
      this.root=remove(this.root);if(this.activePane===pane.id)this.activePane=this.panes()[0].id;
    }
  }
  serialize(){return JSON.stringify({root:this.root,activePane:this.activePane});}
}
