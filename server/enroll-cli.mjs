#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { localUrl } from './mcp-client.mjs';

const help=`Local Super Terminal MCP enrollment (owner workflow)
  node server/enroll-cli.mjs list [--url http://127.0.0.1:4317]
  node server/enroll-cli.mjs enroll --project PROJECT_ID --name NAME --key STABLE_KEY [--provider codex|claude|grok|shell] [--team TEAM_ID] [--task TASK_ID] [--cwd DIRECTORY]
  node server/enroll-cli.mjs revoke --agent AGENT_ID

Start Super Terminal first. Enrollment prints a private config path and MCP client entry, never its credential.
Use one enrollment per conversation. Use a fresh conversation when changing projects. No process is adopted, signalled or launched.`;

export async function main(args=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:Object.fromEntries(['url','project','name','key','provider','team','task','cwd','agent'].map(k=>[k,{type:'string'}]).concat([['help',{type:'boolean'}]]))});
  const command=positionals[0];
  if(values.help||!command){console.log(help);return;}
  if(!['list','enroll','revoke'].includes(command)||positionals.length!==1)throw new Error(help);
  if(command==='enroll'&&(!values.project||!values.name||!values.key))throw new Error('enroll requires --project, --name and --key.');
  if(command==='revoke'&&!values.agent)throw new Error('revoke requires --agent.');
  const url=localUrl(values.url || 'http://127.0.0.1:4317');
  const request=(route,init={})=>fetch(url+route,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
  const health=await (await request('/desktop-health')).json();
  if(health.product!=='super-terminal'||health.protocol!==2)throw new Error('Expected the local Super Terminal service.');
  const page=await (await request('/')).text(),token=page.match(/name="super-terminal-token" content="([^"]+)"/)?.[1];
  if(!token)throw new Error('Local owner authentication unavailable. Open Super Terminal.');
  const body=command==='enroll'?{projectId:values.project,name:values.name,clientKey:values.key,provider:values.provider,teamId:values.team,taskId:values.task,cwd:values.cwd}:undefined;
  const response=await request('/api/enrollments'+(command==='revoke'?'/'+encodeURIComponent(values.agent):''),{method:command==='enroll'?'POST':command==='revoke'?'DELETE':'GET',headers:{'x-super-terminal':token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error || 'Enrollment request failed.');
  if(command==='enroll' && !result.mcpServers)result.mcpServers={'super_terminal':{command:process.execPath,args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url))],env:{SUPER_TERMINAL_AGENT_CONFIG:result.configPath}}};
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
