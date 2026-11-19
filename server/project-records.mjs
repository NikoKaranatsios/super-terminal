import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { text, localDirectory, home, validHost } from './core.mjs';
import { initializeTasks } from './tasks.mjs';

function location(input, previous, allowedHosts) {
  const host=input.host || previous?.host || 'local';
  if(host!=='local'&&!allowedHosts.includes(validHost(host)))throw new Error('Environment is not enabled.');
  if(previous?.host && host!==previous.host && !input.cwd)throw new Error('Choose a directory in the new environment.');
  const cwd=input.cwd || previous?.cwd || (host==='local'?home:'~');
  return {host,cwd:host==='local'?localDirectory(cwd):text(cwd,2000)};
}
export function appendWorkProject(state,workSessionId,input,allowedHosts=[]) {
  const session=state.workSessions.find(s=>s.id===workSessionId);if(!session)throw new Error('Working session not found.');
  const name=text(input.name || '',120);if(!name)throw new Error('Project name is required.');
  const project={id:randomUUID(),name,...location(input,null,allowedHosts),goals:[]};
  if(session.projects.some(p=>p.name.toLowerCase()===name.toLowerCase()&&p.host===project.host))throw new Error('That topic already exists in this working session.');
  session.projects.push(project);initializeTasks(state);return project;
}
export function updateProjectRecord(state,id,input,allowedHosts=[]) {
  const project=state.projects.find(p=>p.id===id);if(!project)throw new Error('Project not found.');
  if(project.mergedIntoProjectId)throw new Error('This project was consolidated; edit its destination project.');
  const next={...project,...(input.cwd!==undefined || input.host!==undefined ? location(input,project,allowedHosts) : {})};
  if(input.name!==undefined){next.name=text(input.name,120);if(!next.name)throw new Error('Project name is required.');}
  if(input.notes!==undefined){if(typeof input.notes!=='string'||input.notes.length>6000||input.notes.includes('\0'))throw new Error('Project notes must be text of up to 6,000 characters.');next.notes=input.notes.trim();}
  if(input.status!==undefined){if(!['active','archived'].includes(input.status))throw new Error('Project status must be active or archived.');next.status=input.status;}
  if(input.historyRoots!==undefined){
    if(!Array.isArray(input.historyRoots)||input.historyRoots.length>100)throw new Error('History roots must be a bounded list of locations.');
    next.historyRoots=input.historyRoots.map(root=>{const host=root.host || next.host,cwd=text(root.cwd,2000);if(host!=='local'&&!allowedHosts.includes(validHost(host)))throw new Error('Environment is not enabled.');if(!path.posix.isAbsolute(cwd))throw new Error('History roots must be absolute paths.');return {host,cwd:path.posix.normalize(cwd)};});
  }
  if(project.cwd!==next.cwd || project.host!==next.host)next.historyRoots=[...(next.historyRoots || []),{host:project.host,cwd:project.cwd}];
  if(state.projects.some(p=>p.id!==id&&!p.mergedIntoProjectId&&p.host===next.host&&p.name.toLowerCase()===next.name.toLowerCase()) && input.name!==undefined && input.name!==project.name)throw new Error('That project name already exists in this environment.');
  Object.assign(project,next);
  for(const work of state.workSessions)for(const nested of work.projects)if(nested.canonicalProjectId===id)Object.assign(nested,{name:next.name,host:next.host,cwd:next.cwd});
  return project;
}

/** Owner-directed consolidation of empty duplicate tracking records only.
 * Original IDs, paths and transcripts remain; this never moves files or agents.
 */
export function consolidateProjectRecord(state,sourceId,targetId) {
  const source=state.projects.find(p=>p.id===sourceId),target=state.projects.find(p=>p.id===targetId);
  if(!source || !target || source===target || target.mergedIntoProjectId)throw new Error('Choose distinct source and canonical projects.');
  if(source.mergedIntoProjectId===target.id)return {source,target};
  if(source.mergedIntoProjectId || source.host!==target.host)throw new Error('Projects must be unconsolidated and in the same environment.');
  if((state.sessions || []).some(a=>a.projectId===source.id || a.contextProjectId===source.id) || (state.tasks || []).some(t=>t.projectId===source.id) || (state.teams || []).some(t=>t.projectId===source.id) || (state.workSessions || []).some(w=>w.projects.some(p=>(p.canonicalProjectId || p.projectId || p.id)===source.id)))throw new Error('This project has agents, tasks, teams or working-session topics. Reconcile those assignments before consolidating it.');
  source.status='archived';source.mergedIntoProjectId=target.id;
  for(const assignment of Object.values(state.assignments || {}))if(assignment.projectId===source.id){assignment.previousProjectId=source.id;assignment.projectId=target.id;}
  return {source,target};
}
