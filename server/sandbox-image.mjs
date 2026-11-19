import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execute,dockerCommand} from './sandbox-runtime.mjs';

export async function buildSandboxImage(root,{host='local',command=execute}={}){
  const staging=fs.mkdtempSync(path.join(os.tmpdir(),'st-runtime-build-'));
  try{
    for(const file of fs.readdirSync(path.join(root,'runtime')).filter(f=>!f.startsWith('.')))fs.copyFileSync(path.join(root,'runtime',file),path.join(staging,file));
    for(const file of ['browsers.mjs','provider-commands.mjs','mcp.mjs','mcp-client.mjs','mcp-workflows.mjs','bridge.py'])fs.copyFileSync(path.join(root,'server',file),path.join(staging,file));
    const archive=await command('tar',['-C',staging,'-cf','-','.'],{binary:true,maxBytes:2*1024*1024});
    const cmd=dockerCommand(host,['build','--tag','super-terminal-agent:1','-']);
    await command(cmd.bin,cmd.args,{input:archive,timeout:1200000,maxBytes:16*1024*1024});
    return {image:'super-terminal-agent:1',status:'ready'};
  }finally{fs.rmSync(staging,{recursive:true,force:true});}
}
