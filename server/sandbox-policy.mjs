import {occupiesRuntimeSlot} from '../shared/runtime-state.mjs';
// Owner-selected policy. Agent requests may consume this grant, never broaden it.
export const DEFAULT_DOMAINS = ['api.openai.com','chatgpt.com','auth.openai.com','api.anthropic.com','claude.ai','platform.claude.com','api.x.ai','registry.npmjs.org','pypi.org','files.pythonhosted.org','github.com','api.github.com','raw.githubusercontent.com'];
export const DEFAULT_SANDBOX = Object.freeze({mode:'container',image:'super-terminal-agent:1',engine:'docker',network:'restricted',domains:DEFAULT_DOMAINS,cpu:2,memoryMb:3072,pids:512,maxAgents:4,maxLaunches:12,maxDepth:1,delegation:false});
const fields=new Set(Object.keys(DEFAULT_SANDBOX));
export function sandboxPolicy(input={},base=DEFAULT_SANDBOX) {
  if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Runtime policy must be an object.');
  for(const key of Object.keys(input))if(!fields.has(key))throw new Error(`Unknown runtime setting: ${key}`);
  const p={...base,...input};
  if(!['host','container'].includes(p.mode))throw new Error('Runtime mode must be host or container.');
  if(!['docker','runsc'].includes(p.engine))throw new Error('Runtime engine must be docker or runsc.');
  if(typeof p.image!=='string'||!/^[-a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,240}$/.test(p.image))throw new Error('Use a valid prebuilt container image.');
  if(!['restricted','offline'].includes(p.network))throw new Error('Choose restricted or offline networking.');
  if(!Array.isArray(p.domains)||p.domains.length>64||p.domains.some(d=>typeof d!=='string'||! /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)||d.endsWith('.local')||d.endsWith('.internal')))throw new Error('Network destinations must be exact public DNS names, without wildcards or ports.');
  p.domains=[...new Set(p.domains)];
  for(const [key,min,max] of [['cpu',.25,16],['memoryMb',512,32768],['pids',64,2048],['maxAgents',1,6],['maxLaunches',1,100],['maxDepth',0,2]])if(!Number.isFinite(p[key])||p[key]<min||p[key]>max||(key!=='cpu'&&!Number.isInteger(p[key])))throw new Error(`${key} must be ${min}–${max}.`);
  if(typeof p.delegation!=='boolean')throw new Error('Delegation must be enabled or disabled.');
  if(p.delegation&&p.mode!=='container')throw new Error('Automatic helpers require an isolated container team.');
  return p;
}
export function configureTeamRuntime(state,team,input) {
  if(!team)throw new Error('Team not found.');
  if((state.sessions||[]).some(s=>s.teamId===team.id&&occupiesRuntimeSlot(s)))throw new Error('Stop this team’s agents before changing its runtime grant. Existing workspaces are retained.');
  if(team.runtimeServices?.gateway?.state&&!['stopped','offline'].includes(team.runtimeServices.gateway.state))throw new Error('Release this team’s runtime services before changing its runtime grant. Saved workspaces are retained.');
  if(team.delegations?.some(r=>r.status==='launching'))throw new Error('A helper launch is unresolved. Inspect it before changing the grant.');
  team.runtime=sandboxPolicy(input,team.runtime||DEFAULT_SANDBOX);team.runtimeRevision=(team.runtimeRevision||0)+1;
  return team.runtime;
}
export function runtimeSummary(team,sessions=[]) {
  const p=team.runtime||{mode:'host',delegation:false},members=sessions.filter(s=>s.teamId===team.id),active=members.filter(s=>occupiesRuntimeSlot(s));
  return {...p,active:active.length,launches:team.runtimeLaunches||0,requests:(team.delegations||[]).map(({id,parentAgentId,childAgentId,role,provider,status,error})=>({id,parentAgentId,childAgentId,role,provider,status,error}))};
}
