import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {providerArguments} from '../server/provider-commands.mjs';
import {writeGrokProjectMcp} from '../server/mcp-launch.mjs';
test('local and remote launches share native new/resume arguments without permission overrides',()=>{
 const prompt='Task with spaces\nand a second line';
 for(const provider of ['codex','claude','grok']){
  assert.deepEqual(providerArguments(provider,{prompt}),[prompt]);
  assert.deepEqual(providerArguments(provider,{sessionId:'fixture',prompt}),[provider==='codex'?'resume':'--resume','fixture',prompt]);
 }
 assert.deepEqual(providerArguments('shell',{shell:true}),['-l']);assert.throws(()=>providerArguments('unknown'),/Unknown/);
 const mcp={command:'node',args:['/fixture/mcp.mjs'],env:{SUPER_TERMINAL_AGENT_CONFIG:'/fixture/agent.json'},configFile:'/fixture/agent.mcp.json'};
 const codex=providerArguments('codex',{prompt,mcp});
 assert.equal(codex.at(-1),prompt);assert.ok(codex.includes('mcp_servers.super_terminal.command="node"'));
 assert.deepEqual(providerArguments('claude',{prompt,mcp}).slice(0,3),['--strict-mcp-config','--mcp-config','/fixture/agent.mcp.json']);
 assert.deepEqual(providerArguments('grok',{prompt,mcp}),[prompt]);
 assert.deepEqual(providerArguments('grok',{sessionId:'fixture',prompt}),['--resume','fixture',prompt]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'st-grok-mcp-'));
 fs.writeFileSync(path.join(dir,'.git'),'');
 const written=writeGrokProjectMcp(dir,{command:'node',args:['/fixture/mcp.mjs'],env:{SUPER_TERMINAL_AGENT_CONFIG:'/fixture/agent.json'}});
 assert.equal(written,path.join(dir,'.grok','config.toml'));
 const again=writeGrokProjectMcp(dir,{command:'node',args:['/fixture/mcp.mjs'],env:{SUPER_TERMINAL_AGENT_CONFIG:'/fixture/other.json'}});
 const text=fs.readFileSync(again,'utf8');
 assert.equal(text.match(/\[mcp_servers\.super_terminal\]/g).length,1);
 assert.match(text,/other\.json/);
 assert.equal(writeGrokProjectMcp(os.homedir(),{command:'node',args:[],env:{}}),null);
 fs.rmSync(dir,{recursive:true,force:true});
});
