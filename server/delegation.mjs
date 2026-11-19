import {occupiesRuntimeSlot} from '../shared/runtime-state.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { sandboxPolicy } from './sandbox-policy.mjs';
import { allowedProjectIds, canReadProjectContent } from './project-access.mjs';

const locks=new WeakMap();
export function reconcileHelperRequests(state){
  for(const team of state.teams||[])for(const request of team.delegations||[])if(request.status==='launching'){
    const child=state.sessions.find(s=>s.delegationRequestId===request.id);
    if(child&&child.execution?.state==='running')Object.assign(request,{status:'started',childAgentId:child.id});
    else Object.assign(request,{status:'uncertain',...(child?{childAgentId:child.id}:{}),error:'Control service restarted before this launch was confirmed. Inspect the runtime before requesting another helper.'});
  }
}
export async function withTeamLock(store,teamId,operation) {
  let rows=locks.get(store);if(!rows){rows=new Map();locks.set(store,rows);}
  const prior=rows.get(teamId)||Promise.resolve(),current=prior.catch(()=>{}).then(operation);rows.set(teamId,current);
  try{return await current;}finally{if(rows.get(teamId)===current)rows.delete(teamId);}
}
export async function requestHelper(store,parent,input,{createSession,liveSessions}) {
  const team=store.state.teams?.find(t=>t.id===parent.teamId);
  if(!team)throw new Error('An explicit team and owner-enabled helper allowance are required.');
  return withTeamLock(store,team.id,async()=>{
    const p=sandboxPolicy(team.runtime||{mode:'host'}),state=store.state;
    if(!p.delegation||p.mode!=='container'||parent.execution?.kind!=='container')throw new Error('Automatic helpers are not enabled for this isolated team. Ask Conductor to configure its allowance.');
    if(parent.contextIsolation||parent.enrollmentRevokedAt||parent.status!=='running')throw new Error('The parent assignment is inactive.');
    if(input.assignmentRevision!==parent.assignmentRevision||input.attemptId!==(parent.attemptId||parent.id))throw new Error('Assignment changed; read context before requesting a helper.');
    if(parent.projectId!==team.projectId||parent.host!==team.host||parent.execution.policyRevision!==team.runtimeRevision)throw new Error('The parent no longer matches this runtime grant.');
    const allowed=new Set(['command','requestId','role','task','provider','assignmentRevision','attemptId']);
    if(Object.keys(input).some(k=>!allowed.has(k)))throw new Error('A helper request cannot change location, credentials, team, permissions or runtime.');
    const clean=(key,max)=>{const value=input[key];if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`Provide ${key} (1–${max} characters).`);return value.trim();};
    const requestId=clean('requestId',160),role=clean('role',100),task=clean('task',6000),provider=input.provider||parent.provider;
    if(!['codex','claude','grok','shell'].includes(provider))throw new Error('Unsupported helper provider.');
    const fingerprint=createHash('sha256').update(JSON.stringify({role,task,provider,revision:parent.assignmentRevision,attempt:parent.attemptId})).digest('hex');
    team.delegations||=[];
    const prior=team.delegations.find(r=>r.parentAgentId===parent.id&&r.requestId===requestId);
    if(prior){if(prior.fingerprint!==fingerprint)throw new Error('This request ID already identifies different work.');return {...prior,duplicate:true};}
    if((parent.delegationDepth||0)>=p.maxDepth)throw new Error('This team’s delegation depth limit has been reached.');
    if(team.delegations.length>=100)throw new Error('The retained helper-request limit has been reached.');
    if((team.runtimeLaunches||0)>=p.maxLaunches)throw new Error('The team’s launch allowance is exhausted.');
    const live=await liveSessions();
    if(parent.contextIsolation||parent.enrollmentRevokedAt||parent.status!=='running'||parent.assignmentRevision!==input.assignmentRevision||parent.attemptId!==input.attemptId||!live.some(s=>s.id===parent.id&&s.status==='running'))throw new Error('The parent assignment changed or its runtime is not running.');
    if(live.filter(s=>s.teamId===team.id&&occupiesRuntimeSlot(s)).length>=p.maxAgents)throw new Error('The team’s concurrent-agent limit has been reached. Reuse an existing peer.');
    if((parent.contentProjectIds||[]).some(id=>!allowedProjectIds(state,parent).has(id)))throw new Error('Parent context is outside its team grant.');
    const assigned=state.tasks?.find(t=>t.id===parent.taskId);
    if(assigned&&!canReadProjectContent(state,parent,assigned))throw new Error('Task is outside the parent’s current assignment.');
    const receipt={id:randomUUID(),requestId,parentAgentId:parent.id,parentAssignmentRevision:input.assignmentRevision,parentAttemptId:input.attemptId,role,provider,fingerprint,status:'launching',createdAt:new Date().toISOString()};
    team.delegations.push(receipt);store.save();
    try {
      const child=await createSession({provider,projectId:parent.projectId,teamId:team.id,host:parent.host,cwd:team.cwd,scope:parent.scope,role,title:role,task,parentAgentId:parent.id,parentTaskId:parent.taskId,delegationDepth:(parent.delegationDepth||0)+1,delegationRequestId:receipt.id});
      Object.assign(receipt,{status:'started',childAgentId:child.id});
    }catch(error){Object.assign(receipt,{status:'failed',error:error.message.slice(0,1000)});}
    store.save();return receipt;
  });
}
