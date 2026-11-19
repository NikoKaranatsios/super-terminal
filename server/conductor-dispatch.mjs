import { PROJECT_CONTENT } from './conductor-access.mjs';
import { OWNER_CREATION } from './owner-intent.mjs';

export const needsProjectDispatch = action => PROJECT_CONTENT.has(action.type) && !OWNER_CREATION.has(action.type) && !(action.type==='work_session_state' && !action.text);

// Routing carries validated identities only. Never use the owner's generated
// draft, name, mission, member prompts, paths or summaries as project input.
export function projectDispatchRoute(state, action, selection, histories = []) {
  const project = id => (state.projects || []).find(p=>p.id===id)?.id || (state.workSessions || []).flatMap(s=>s.projects || []).find(p=>p.id===id)?.canonicalProjectId;
  const targetKinds = {
    message_agent:'sessions',prompt_agent:'sessions',rename_agent:'sessions',
    update_task:'tasks',update_goal:'tasks',goal_progress:'tasks',
    configure_team_runtime:'teams',update_team:'teams',brief_team:'teams',add_team_members:'teams',update_project:'projects',resume_conversation:'histories',work_session_state:'workSessions'
  };
  const kind=targetKinds[action.type], target=action.target || (kind==='tasks'?action.taskId:kind==='teams'?action.teamId:'');
  const record=kind && (kind==='histories'?histories:state[kind] || []).find(r=>r.id===target);
  if(kind && !record)throw new Error('Project dispatch target was not found.');
  const ids=[];
  const add=id=>{if(!id)return;const canonical=project(id);if(!canonical)throw new Error('Project dispatch requires an existing project.');ids.push(canonical);};
  add(action.projectId);
  if(kind==='projects')add(record.id);
  else if(kind==='workSessions')for(const p of record.projects || [])add(p.canonicalProjectId || p.id);
  else if(record)add(record.projectId);
  for(const [field,rows] of [['taskId','tasks'],['goalId','tasks'],['teamId','teams']]) {
    if(!action[field])continue;
    const row=(state[rows] || []).find(r=>r.id===action[field]);
    if(!row)throw new Error('Project dispatch assignment was not found.');
    add(row.projectId);
    if((rows===kind) && target && row.id!==target)throw new Error('Project dispatch has conflicting targets.');
  }
  if(!ids.length && action.cwd) {
    const matches = (state.projects || []).filter(row => row.cwd === action.cwd && (!action.host || row.host === action.host));
    if (matches.length === 1) add(matches[0].id);
  }
  if(!ids.length && selection?.projectIds?.length===1) {
    const selected = (state.projects || []).find(row => row.id === selection.projectIds[0]);
    if (!action.host || !selected?.host || selected.host === action.host) add(selection.projectIds[0]);
  }
  const projects=[...new Set(ids)];
  if(projects.length!==1)throw new Error('Project dispatch needs one unambiguous destination project.');
  const route={type:action.type,projectId:projects[0]};
  if(target)route.target=target;
  for(const field of ['taskId','goalId','teamId','workSessionId'])if(action[field])route[field]=action[field];
  if(route.workSessionId && !(state.workSessions || []).some(s=>s.id===route.workSessionId && s.projects?.some(p=>(p.canonicalProjectId || p.id)===route.projectId)))throw new Error('Project dispatch working session does not contain the destination.');
  return route;
}

export function projectDispatchScope(state, live, projectId) {
  const tasks=(state.tasks || []).filter(t=>t.projectId===projectId);
  return {layer:'project',projectIds:[projectId],taskIds:tasks.map(t=>t.id),workSessionIds:[],agentIds:live.filter(a=>a.projectId===projectId).map(a=>a.id)};
}

export function validateDispatchedAction(state, action, route, histories) {
  if(!needsProjectDispatch(action) || action.type!==route.type)throw new Error('Project dispatch cannot change the requested operation.');
  const resolved=projectDispatchRoute(state,{...action,projectId:action.projectId || route.projectId},null,histories);
  for(const key of ['projectId','target','taskId','goalId','teamId','workSessionId'])if((route[key] || resolved[key]) && route[key]!==resolved[key])throw new Error('Project dispatch cannot change destination or assignment.');
  return {...action,projectId:route.projectId};
}
