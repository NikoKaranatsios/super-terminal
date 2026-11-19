import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { env, home, which } from './core.mjs';
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;

export const defaultConductorSettings = Object.freeze({model:'',reasoningEffort:'',access:'full',skills:true});
export function validateConductorSettings(patch, previous = defaultConductorSettings) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid Conductor settings.');
  for (const key of Object.keys(patch)) if (!Object.hasOwn(defaultConductorSettings,key)) throw new Error('Unknown Conductor setting.');
  const result = {...previous,...patch};
  if (typeof result.model !== 'string' || (result.model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(result.model))) throw new Error('Enter a valid model ID.');
  if (!['','none','minimal','low','medium','high','xhigh','max','ultra'].includes(result.reasoningEffort)) throw new Error('Unknown reasoning effort.');
  if (!['full','workspace','read-only'].includes(result.access)) throw new Error('Unknown file access setting.');
  if (typeof result.skills !== 'boolean') throw new Error('Skills must be enabled or disabled.');
  return result;
}

export function conductorSettings(state, workSessionId = '') {
  const session = workSessionId ? state.workSessions?.find(s=>s.id===workSessionId) : null;
  if (workSessionId && !session) throw new Error('Working session not found.');
  return {...defaultConductorSettings,...(session ? session.conductorSettings : state.conductor?.settings)};
}

export function conductorDirectory(state, scope, fallback = home) {
  const project = scope?.projectIds?.length===1 ? state.projects?.find(p=>p.id===scope.projectIds[0]) : null;
  // Remote paths belong to the remote host, never to the local filesystem.
  const cwd = project?.host==='local' && project.cwd ? project.cwd : fallback;
  return cwd;
}

// Catalog discovery makes no model request. Return only public configuration fields.
export async function readCodexCatalog(cwd, {spawnProcess = spawn, bin = which('codex'), timeoutMs = 15000} = {}) {
  if (!bin) throw new Error('Conductor needs your installed Codex CLI and login.');
  const child = spawnProcess(bin,['app-server'],{cwd,env,stdio:['pipe','pipe','pipe']});
  const pending = new Map(); let sequence=0,buffer='';
  const fail = error => {for(const {reject} of pending.values())reject(error);pending.clear();};
  const request = (method,params) => new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  child.stdout.on('data',chunk=>{
    buffer+=chunk.toString();let end;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const message=JSON.parse(line),waiter=pending.get(message.id);if(waiter){pending.delete(message.id);message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message.result);}}catch{}}
    if(buffer.length>4*1024*1024)fail(new Error('Codex catalog response exceeded its limit.'));
  });
  child.stderr.resume();
  child.stdin.on('error',fail);child.on('error',fail);child.on('exit',()=>fail(new Error('Codex catalog service exited.')));
  const timeout=setTimeout(()=>{fail(new Error('Codex catalog request timed out.'));child.kill();},timeoutMs);
  try {
    await request('initialize',{clientInfo:{name:'super_terminal',version},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const results=await Promise.allSettled([request('config/read',{cwd,includeLayers:false}),request('model/list',{limit:100}),request('skills/list',{cwds:[cwd],forceReload:true})]);
    const [config,models,skills]=results.map(r=>r.status==='fulfilled'?r.value:null);
    return {cwd,defaultModel:config?.config?.model || models?.data?.find(m=>m.isDefault)?.model || '',defaultReasoningEffort:config?.config?.model_reasoning_effort || '',
      models:(models?.data || []).map(m=>({id:m.model,name:m.displayName,efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort)})),
      skills:(skills?.data || []).flatMap(row=>row.skills.filter(s=>s.enabled).map(s=>({name:s.name,path:s.path,description:s.shortDescription || s.description,pluginId:s.pluginId || null}))),
      errors:[...results.filter(r=>r.status==='rejected').map(r=>r.reason.message),...(skills?.data || []).flatMap(row=>(row.errors || []).map(e=>e.message))]};
  } finally {clearTimeout(timeout);child.stdin.end();child.kill();}
}

export function disabledMcpArgs(configText = '') {
  const names = [...String(configText).matchAll(/^\[mcp_servers\.([^.\]]+)\]/gm)].map(match => match[1]);
  return [...new Set(names)].flatMap(name => ['-c', `mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name)}.enabled=false`]);
}
export function conductorFailure(stderr) {
  const text = String(stderr || '').trim();
  if (/rmcp::transport|Transport channel closed|mcp/i.test(text)) return 'A configured MCP server failed before Conductor produced a reply. The reply was not applied.';
  return text.slice(-1200) || 'Reply cancelled or timed out.';
}
export function conductorCommand(runtime, outputFile, mcpConfig = '') {
  const background = runtime.mode !== 'manual';
  const args=['exec','--ephemeral','--skip-git-repo-check'];
  if(background)args.push('--ignore-user-config','--ignore-rules','--sandbox','read-only',
    '--disable','shell_tool','--disable','unified_exec','--disable','plugins','--disable','remote_plugin','--disable','multi_agent','--disable','skill_search','--enable','skip_host_skill_discovery','-c','web_search="disabled"');
  else {
    args.push('--sandbox',{'full':'danger-full-access',workspace:'workspace-write','read-only':'read-only'}[runtime.access],'-c','approval_policy="never"','--enable','shell_tool','--enable','unified_exec');
    if(runtime.skills)args.push('--disable','skip_host_skill_discovery');
    else args.push('--enable','skip_host_skill_discovery','--disable','skill_search','--disable','plugins','--disable','remote_plugin');
  }
  if(runtime.mode === 'manual') args.push(...disabledMcpArgs(mcpConfig));
  if(runtime.model)args.push('-m',runtime.model);
  if(runtime.reasoningEffort)args.push('-c',`model_reasoning_effort=${JSON.stringify(runtime.reasoningEffort)}`);
  const instructions=fileURLToPath(new URL('./coordinator-instructions.md',import.meta.url));
  // Keep the native coding instructions and add the coordination contract in manual chat.
  args.push('-c',background?`model_instructions_file=${JSON.stringify(instructions)}`:`developer_instructions=${JSON.stringify(fs.readFileSync(instructions,'utf8'))}`);
  args.push('--output-schema',fileURLToPath(new URL('./conductor-schema.json',import.meta.url)),'--json','-o',outputFile,'-');
  return {args,cwd:runtime.cwd};
}
