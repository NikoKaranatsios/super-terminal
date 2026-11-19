export const NODE_WIDTH=224;
export const NODE_HEIGHT=268;
export const COLUMN_GAP=120;
export const ROW_GAP=38;

/** Left-to-right forest. Each subtree owns a vertical interval, so branches do
 * not cross unrelated nodes. Viewport size never reshuffles the topology. */
export function layoutSessionGraph(graph,{positions=new Map()}={}){
  const nodes=[],regions=[];let top=40;
  for(const group of graph.groups){
    const source=graph.nodes.filter(n=>n.groupKey===group.key);if(!source.length)continue;
    const project=source.find(n=>n.kind==='project'),agents=source.filter(n=>n.kind==='session'),ids=new Set(agents.map(n=>n.id));
    const children=new Map();for(const agent of agents){const parent=ids.has(agent.session.parentAgentId)?agent.session.parentAgentId:null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(agent);}
    const visited=new Set(),trees=[];
    const tree=agent=>{if(visited.has(agent.id))return null;visited.add(agent.id);const branches=(children.get(agent.id)||[]).map(tree).filter(Boolean);return {agent,branches,span:Math.max(NODE_HEIGHT,branches.reduce((n,c)=>n+c.span+ROW_GAP,0)-ROW_GAP)};};
    for(const agent of [...(children.get(null)||[]),...agents]){const result=tree(agent);if(result)trees.push(result);}
    const span=Math.max(NODE_HEIGHT,trees.reduce((n,c)=>n+c.span+ROW_GAP,0)-ROW_GAP),start=top;
    const place=(branch,depth,y)=>{nodes.push({...branch.agent,depth,x:40+depth*(NODE_WIDTH+COLUMN_GAP),y,width:NODE_WIDTH,height:NODE_HEIGHT});let next=y;for(const child of branch.branches){place(child,depth+1,next);next+=child.span+ROW_GAP;}};
    nodes.push({...project,depth:0,x:40,y:top,width:NODE_WIDTH,height:NODE_HEIGHT});
    for(const branch of trees){place(branch,1,top);top+=branch.span+ROW_GAP;}
    top=start+span+120;
  }
  // Dragging changes only local display coordinates, never relationships.
  for(const node of nodes){const saved=positions.get(node.id);if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)){node.x=saved.x;node.y=saved.y;}}
  for(const group of graph.groups){const members=nodes.filter(n=>n.groupKey===group.key);if(!members.length)continue;const bounds=graphBounds(members,28);regions.push({key:group.key,title:group.title,location:group.location,...bounds});}
  const bounds=graphBounds(nodes,40);
  return {...graph,nodes,regions,bounds,width:bounds.width,height:bounds.height};
}
export function graphBounds(nodes,padding=0){
  if(!nodes.length)return {x:0,y:0,width:640,height:400};
  const x=Math.min(...nodes.map(n=>n.x))-padding,y=Math.min(...nodes.map(n=>n.y))-padding;
  return {x,y,width:Math.max(...nodes.map(n=>n.x+n.width))-x+padding,height:Math.max(...nodes.map(n=>n.y+n.height))-y+padding};
}
export function graphEdgePath(a,b){
  const start={x:a.x+a.width/2+40,y:a.y+48},end={x:b.x+b.width/2-40,y:b.y+48};
  const bend=Math.max(64,Math.abs(end.x-start.x)*.5);
  return `M ${start.x} ${start.y} C ${start.x+bend} ${start.y}, ${end.x-bend} ${end.y}, ${end.x} ${end.y}`;
}
export function adjacentGraphNode(nodes,id,key){
  const ordered=nodes.filter(n=>n.kind==='session').sort((a,b)=>a.y-b.y||a.x-b.x);
  if(key==='Home')return ordered[0]?.id;if(key==='End')return ordered.at(-1)?.id;
  const origin=ordered.find(n=>n.id===id);if(!origin)return null;
  const horizontal=['ArrowLeft','ArrowRight'].includes(key),direction=['ArrowLeft','ArrowUp'].includes(key)?-1:1;
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key))return null;
  return ordered.filter(n=>n.id!==id).map(n=>{const along=(horizontal?n.x-origin.x:n.y-origin.y)*direction,across=Math.abs(horizontal?n.y-origin.y:n.x-origin.x);return {id:n.id,along,score:Math.hypot(along,across)+across*2};}).filter(n=>n.along>1).sort((a,b)=>a.score-b.score)[0]?.id||null;
}
