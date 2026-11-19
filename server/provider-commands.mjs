// Native interactive arguments, intentionally without approval/sandbox overrides.
// mcp registers the local Super Terminal server for a new managed agent.
export function providerArguments(provider,{sessionId,prompt='',shell=false,mcp=null}={}) {
  if(shell)return ['-l'];
  if(!['codex','claude','grok'].includes(provider))throw new Error('Unknown agent provider.');
  const prefix=[];
  if(mcp?.command && provider==='codex'){
    prefix.push('-c',`mcp_servers.super_terminal.command=${JSON.stringify(mcp.command)}`,'-c',`mcp_servers.super_terminal.args=${JSON.stringify(mcp.args || [])}`);
    for(const [key,value] of Object.entries(mcp.env || {})) prefix.push('-c',`mcp_servers.super_terminal.env.${key}=${JSON.stringify(value)}`);
  } else if(mcp?.configFile && provider==='claude') prefix.push('--strict-mcp-config','--mcp-config',mcp.configFile);
  const tail=sessionId?(provider==='codex'?['resume',sessionId,prompt]:['--resume',sessionId,prompt]):[prompt];
  return [...prefix,...tail];
}
