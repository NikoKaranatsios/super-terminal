import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import {AgentBrowsers} from './browsers.mjs';
import {providerArguments} from './provider-commands.mjs';

for(const dir of ['home','bridge/requests','bridge/responses','browsers'])fs.mkdirSync('/workspace/'+dir,{recursive:true,mode:0o700});
const setup=JSON.parse(fs.readFileSync('/workspace/launch.json','utf8'));
const mcp={command:'node',args:['/opt/st/mcp.mjs'],env:{SUPER_TERMINAL_AGENT_CONFIG:'/workspace/bridge/config.json'},configFile:'/workspace/bridge/mcp.json'};
fs.writeFileSync(mcp.configFile,JSON.stringify({mcpServers:{super_terminal:{command:mcp.command,args:mcp.args,env:mcp.env}}}),{mode:0o600});
const command=setup.provider==='shell'?'/bin/bash':setup.provider;
const args=providerArguments(setup.provider,{prompt:setup.prompt,shell:setup.provider==='shell',mcp});
// An exited provider leaves a recovery shell inside the same container.
fs.writeFileSync('/workspace/start.sh',`#!/bin/sh\n${[command,...args].map(v=>"'"+String(v).replaceAll("'","'\\''")+"'").join(' ')}\nprintf '\\n[Provider exited. Runtime shell; workspace retained.]\\n'\nexec /bin/bash -l\n`,{mode:0o700});
const launched=spawnSync('tmux',['new-session','-d','-s','agent','-c','/workspace/repo','-x','140','-y','40','/bin/sh /workspace/start.sh']);
if(launched.status!==0)throw new Error('Container terminal could not start: '+launched.stderr);
spawnSync('tmux',['set-option','-t','agent','status','off']);
spawnSync('tmux',['set-option','-t','agent','history-limit','50000']);
const browsers=new AgentBrowsers({root:'/workspace',controlPort:-1,launchOptions:process.env.HTTP_PROXY?{proxy:{server:process.env.HTTP_PROXY,bypass:'localhost,127.0.0.1,*.st-team'}}:{}});
const server=http.createServer(async(req,res)=>{
  try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>262144)throw new Error('Request too large.');}
    const input=JSON.parse(raw),result=await browsers.action('agent',input);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}
});
server.listen(4100,'127.0.0.1');
process.on('SIGTERM',()=>{browsers.close().finally(()=>server.close(()=>process.exit(0)));});
