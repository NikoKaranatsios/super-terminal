import {run,env,which,shell,quote,localDirectory,validHost} from './core.mjs';
export async function launchPreflight(session,{runner=run,find=which,directory=localDirectory}={}){
  if(!find('tmux'))throw new Error('tmux is required before creating a managed terminal.');
  if(session.host==='local'){
    directory(session.cwd);
    if(!find('python3'))throw new Error('Python 3 is required for the managed agent helper.');
    const bin=session.provider==='shell'?shell:find(session.provider);
    if(!bin)throw new Error(`${session.provider} is not installed or is missing from PATH.`);
    return {persistent:true,providerChecked:true,acceptance:'unverified'};
  }
  const cwd=session.cwd==='~'?'"$HOME"':session.cwd.startsWith('~/')?'"$HOME"/'+quote(session.cwd.slice(2)):quote(session.cwd);
  const dependencies=['tmux','python3',...(session.provider==='shell'?[]:[session.provider])];
  const body=`cd ${cwd} || exit 1; ${dependencies.map(name=>`command -v ${quote(name)} >/dev/null || { printf '%s\\n' ${quote(name+' is required in this account')} >&2; exit 1; }`).join('; ')}`;
  const command=session.remoteUser?`sudo -n -u ${quote(session.remoteUser)} sh -lc ${quote(body)}`:`sh -lc ${quote(body)}`;
  await runner('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=6',validHost(session.host),command],{env,timeout:12000,maxBuffer:32768});
  return {persistent:true,providerChecked:true,acceptance:'unverified'};
}
export function launchState(session,pane,remotePane){
  if(!pane)return 'unavailable';if(pane.sourceStale)return 'unknown';
  if(pane.processInspectionHealthy===false)return 'unknown';
  if(session.host!=='local'&&pane.command!=='ssh'&&!pane.processCommands?.includes('ssh'))return 'connection-lost';
  const command=session.host==='local'?pane.command:remotePane?.command;
  if(session.provider==='shell')return command?'shell-running':'transport-ready';
  if(command===session.provider||remotePane?.provider===session.provider||session.host==='local'&&pane.processCommands?.includes(session.provider))return 'cli-running';
  if(['sh','bash','zsh','fish'].includes(command))return Date.now()-Date.parse(session.createdAt)>5000?'recovery-shell':'starting';
  return 'transport-ready';
}
