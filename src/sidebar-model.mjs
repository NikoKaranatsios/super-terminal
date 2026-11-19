import { agentTitle } from './work-views.mjs';

export function sidebarInventory(state, host, query = '') {
  const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
  const projects=new Map((state.projects || []).map(p=>[p.id,p]));
  const matching=row=>terms.every(term=>[agentTitle(row,state),row.cwd,row.provider,row.model,projects.get(row.projectId)?.name].join(' ').toLowerCase().includes(term));
  const live=(state.sessions || []).filter(s=>(host==='all'||s.host===host) && !(s.kind==='enrolled'&&s.enrollmentRevokedAt) && !['stopped','exited'].includes(s.status));
  const agents=live.filter(s=>!s.runtime && s.provider!=='shell' && matching(s));
  const groups=new Map();
  for(const agent of agents){
    const id=agent.projectId || '',project=projects.get(id);
    if(!groups.has(id))groups.set(id,{id,name:project?.name || 'Unassigned agents',agents:[],tasks:(state.tasks || []).filter(t=>t.projectId===id && !['done','stopped','cancelled','archived'].includes(t.status))});
    groups.get(id).agents.push(agent);
  }
  return {live,groups:[...groups.values()].sort((a,b)=>Number(!a.id)-Number(!b.id)||a.name.localeCompare(b.name)),
    shells:live.filter(s=>!s.runtime && s.provider==='shell' && matching(s)),services:live.filter(s=>s.runtime && matching(s)),
    stopped:(state.sessions || []).filter(s=>(host==='all'||s.host===host) && !s.runtime && s.provider!=='shell' && ['stopped','exited'].includes(s.status) && matching(s)),
    history:(state.history || []).filter(s=>(host==='all'||s.host===host) && matching(s))};
}
