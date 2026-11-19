import {run,env,quote,tmuxRun,home,shell} from './core.mjs';
import {prepareBridge,allowedHosts} from './agent-platform.mjs';
import {identifyTmuxPanes} from './discovery.mjs';
const locks=new Map();
export async function reconnectRemote(session,{root,port,runner=run,mux=tmuxRun,bridge=prepareBridge,hosts=allowedHosts}={}){
  if(!session||session.kind!=='managed'||session.host==='local'||!hosts.includes(session.host))throw new Error('Choose an existing managed remote agent.');
  if(session.enrollmentRevokedAt||!session.agentToken)throw new Error('This enrollment ended. Start a fresh managed agent.');
  if(locks.has(session.id))return locks.get(session.id);
  const work=(async()=>{
    const own=command=>session.remoteUser?`sudo -n -u ${quote(session.remoteUser)} sh -lc ${quote(command)}`:command;
    // Reattach only after proving the original remote tmux session still exists.
    await runner('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=6',session.host,own(`tmux has-session -t ${quote(session.tmuxName)}`)],{env,timeout:12000});
    let pane='',panePid;try{[pane,panePid]=(await mux(['display-message','-p','-t',session.tmuxName,'#{pane_current_command}\t#{pane_pid}'])).stdout.trim().split('\t');}catch(error){if(!/no server|can't find|error connecting/.test(error.stderr || error.message))throw error;}
    if(pane==='ssh')return {ok:true,result:'The existing SSH transport is still connected.'};
    if(pane){
      const inspected=(await identifyTmuxPanes([{panePid:Number(panePid)||undefined}],runner))[0];
      if(!inspected.processInspectionHealthy)throw new Error('Cannot inspect the current SSH transport safely. Try again after discovery recovers.');
      if(inspected.processCommands.includes('ssh'))return {ok:true,result:'The existing SSH transport is still connected.'};
    }
    const config=await bridge(session,root,port);
    const ssh=['ssh','-tt','-o','BatchMode=yes','-o','ConnectTimeout=10',...config.sshArgs,session.host,own(`exec tmux attach-session -t ${quote(session.tmuxName)}`)].map(quote).join(' ');
    const command=[shell,'-lc',`${ssh}; printf '\\n[Remote connection ended. Use Reconnect remote.]\\n'; exec ${quote(shell)} -l`].map(quote).join(' ');
    if(pane)await mux(['respawn-pane','-k','-t',session.tmuxName,command]);
    else await mux(['new-session','-d','-s',session.tmuxName,'-c',home,command]);
    return {ok:true,result:'Reconnected the existing remote terminal and helper bridge. Provider acceptance remains visible in its terminal.'};
  })().finally(()=>locks.delete(session.id));locks.set(session.id,work);return work;
}
