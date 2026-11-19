import {sandboxPolicy} from './sandbox-policy.mjs';
// Validate known persistent shapes without dropping legacy or extension fields.
export const STATE_VERSION=1;
const object=(value,where)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${where} must be an object`);};
const optional=(row,key,type,where)=>{if(row[key]!=null&&typeof row[key]!==type)throw new Error(`${where}.${key} must be ${type}`);};
const strings=(row,keys,where)=>keys.forEach(key=>optional(row,key,'string',where));
function list(row,key,where,check){
  if(row[key]===undefined)return;
  if(!Array.isArray(row[key]))throw new Error(`${where}.${key} must be an array`);
  const ids=new Set();
  row[key].forEach((value,index)=>{const at=`${where}.${key}[${index}]`;check(value,at);if(value?.id){if(ids.has(value.id))throw new Error(`${at}.id is duplicated`);ids.add(value.id);}});
}
function record(row,key,where,check){if(row[key]==null)return;object(row[key],`${where}.${key}`);for(const [id,value] of Object.entries(row[key]))check(value,`${where}.${key}[${JSON.stringify(id)}]`);}
function scope(row,where){object(row,where);strings(row,['workSessionId','projectId','goalId','taskId','teamId'],where);}
function entity(row,where){object(row,where);strings(row,['id','title','name','status','host','cwd','provider','projectId','taskId','teamId','agentId','group'],where);if(row.scope!=null)scope(row.scope,`${where}.scope`);}
function goal(row,where){entity(row,where);strings(row,['notes'],where);list(row,'evidence',where,()=>{});}
function project(row,where){entity(row,where);strings(row,['notes','canonicalProjectId','mergedIntoProjectId'],where);list(row,'goals',where,goal);list(row,'historyRoots',where,(root,at)=>{object(root,at);if(typeof root.host!=='string'||typeof root.cwd!=='string'||!root.cwd.startsWith('/'))throw new Error(`${at} requires a host and absolute directory`);});}
function trace(row,where){if(typeof row!=='string')object(row,where);}
function count(row,key,where){if(row[key]!=null&&(!Number.isSafeInteger(row[key])||row[key]<0))throw new Error(`${where}.${key} must be a nonnegative integer`);}
function runtime(row,where){object(row,where);strings(row,['model','reasoningEffort','access'],where);optional(row,'skills','boolean',where);}

export function validateState(state){
  object(state,'state');
  if(state.stateVersion!==undefined&&(!Number.isInteger(state.stateVersion)||state.stateVersion<0||state.stateVersion>STATE_VERSION))throw new Error('state.stateVersion is unsupported; open it with a compatible Super Terminal build');
  if(!Array.isArray(state.sessions)||!Array.isArray(state.hosts))throw new Error('state.sessions and state.hosts must be arrays');
  list(state,'hosts','state',(value,at)=>{if(typeof value!=='string')throw new Error(`${at} must be a string`);});
  list(state,'sessions','state',(row,at)=>{entity(row,at);if(row.projectAssignment!=null)object(row.projectAssignment,`${at}.projectAssignment`);if(row.execution!=null){object(row.execution,`${at}.execution`);if(row.execution.kind!=='container')throw new Error(`${at}.execution.kind is unsupported`);strings(row.execution,['container','volume','network','image','engine','workspace','state','baseCommit'],`${at}.execution`);}strings(row,['parentAgentId','parentTaskId','delegationRequestId'],at);count(row,'delegationDepth',at);if(row.execution)count(row.execution,'policyRevision',at);});
  list(state,'projects','state',project);list(state,'tasks','state',goal);list(state,'teams','state',entity);
  for(const team of state.teams||[]){if(team.runtime!=null)sandboxPolicy(team.runtime);count(team,'runtimeLaunches','team');count(team,'runtimeRevision','team');count(team,'runtimeStopRevision','team');if(team.delegations!=null)list(team,'delegations','team',entity);}
  list(state,'workSessions','state',(row,at)=>{entity(row,at);list(row,'projects',at,project);if(row.conductorSettings!=null)runtime(row.conductorSettings,`${at}.conductorSettings`);});
  list(state,'messages','state',(row,at)=>{entity(row,at);strings(row,['from','to','text','delivery'],at);optional(row,'read','boolean',at);});
  for(const key of ['activity','taskEvents'])list(state,key,'state',entity);
  record(state,'assignments','state',object);
  record(state,'lifecycle','state',(value,at)=>{if(typeof value!=='string')throw new Error(`${at} must be a string`);});
  record(state,'historyProvenance','state',(value,at)=>{if(!Array.isArray(value)||value.some(id=>typeof id!=='string'))throw new Error(`${at} must be an array of project IDs`);});
  record(state,'remoteIndexes','state',(value,at)=>{object(value,at);if(value.version!==1)throw new Error(`${at}.version is unsupported`);list(value,'rows',at,entity);});
  if(state.preferences!=null){object(state.preferences,'state.preferences');for(const key of ['automaticBriefing','notifyOnFinish'])optional(state.preferences,key,'boolean','state.preferences');if(state.preferences.fontSize!=null&&(!Number.isFinite(state.preferences.fontSize)||state.preferences.fontSize<=0))throw new Error('state.preferences.fontSize must be a positive number');}
  if(state.prompts!=null){object(state.prompts,'state.prompts');for(const [key,value] of Object.entries(state.prompts))if(typeof value!=='string')throw new Error(`state.prompts.${key} must be a string`);}
  if(state.conductor!=null){
    const c=state.conductor;object(c,'state.conductor');strings(c,['memory','progressStartedAt'],'state.conductor');
    list(c,'turns','state.conductor',(turn,at)=>{entity(turn,at);strings(turn,['prompt','answer'],at);list(turn,'trace',at,trace);list(turn,'events',at,trace);list(turn,'actions',at,object);if(turn.runtime!=null)runtime(turn.runtime,`${at}.runtime`);});
    for(const key of ['assessments','actionReceipts'])record(c,key,'state.conductor',object);
    for(const key of ['contextMemory','reviewedProjectSignatures'])record(c,key,'state.conductor',(value,at)=>{if(typeof value!=='string')throw new Error(`${at} must be a string`);});
    for(const key of ['reviewedObservationIds','reviewedFocusObservationIds'])list(c,key,'state.conductor',(value,at)=>{if(typeof value!=='string')throw new Error(`${at} must be a string`);});
    if(c.loop!=null){object(c.loop,'state.conductor.loop');if(c.loop.state!=null&&!['running','paused','stopped'].includes(c.loop.state))throw new Error('state.conductor.loop.state is invalid');}
    if(c.settings!=null)runtime(c.settings,'state.conductor.settings');
  }
  return state;
}
export function migrateState(input){
  validateState(input);
  // Shape-preserving migration: canonical tasks keep their existing dedicated
  // migration, and historical references are never dropped or reassigned here.
  return {...input,stateVersion:STATE_VERSION};
}
export function diagnostics(state,{version,protocol,resources={},sources=[]}={}){
  return {product:'super-terminal',version,protocol,stateVersion:state.stateVersion,
    counts:Object.fromEntries(['sessions','projects','tasks','teams','workSessions','messages','activity'].map(key=>[key,Array.isArray(state[key])?state[key].length:0])),
    conductor:{turns:state.conductor?.turns?.length || 0,loop:['running','paused','stopped'].includes(state.conductor?.loop?.state)?state.conductor.loop.state:'unknown'},
    resources:Object.fromEntries(Object.entries(resources).filter(([key,value])=>['terminalAttachments','browserContexts'].includes(key)&&Number.isFinite(value))),
    sources:sources.map(source=>({kind:source.kind==='local'?'local':'remote',healthy:source.healthy===true,stale:source.stale===true}))};
}
