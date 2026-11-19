import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

export function providerProcessArguments(provider,args,tty) {
  const flagId=flag=>args.match(new RegExp(`(?:^|\\s)${flag}(?:\\s+|=)(${uuid})(?:\\s|$)`,'i'))?.[1] || null;
  const runtime=/\sapp-server(?:\s|$)/.test(args) || provider==='codex' && ['?','??'].includes(tty) && !/\s(?:exec|resume|fork)(?:\s|$)/.test(args) ||
    provider==='claude' && (/\sdaemon(?:\s|$)/.test(args) || /\s--bg-pty-host(?:\s|$)/.test(args));
  const resumeId=provider==='claude' ? flagId('--session-id') || (!/\s--fork-session(?:\s|$)/.test(args) ? flagId('(?:--resume|resume|-r)') : null) : flagId('(?:--resume|resume|-r)');
  return {runtime,resumeId:runtime ? null : resumeId};
}

// Read only public session identity, never keys or the provider's messaging
// socket. PID reuse and mismatched directories cannot attach a private history.
export function claudeProcessSession(row,root=process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(),'.claude')) {
  if(!Number.isSafeInteger(row.pid) || row.pid<2 || !row.startedAt)return null;
  let fd;
  try {
    fd=fs.openSync(path.join(root,'sessions',row.pid+'.json'),fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);
    const stat=fs.fstatSync(fd);if(!stat.isFile() || stat.size>65536)return null;
    const bytes=Buffer.alloc(stat.size);fs.readSync(fd,bytes,0,bytes.length,0);
    const metadata=JSON.parse(bytes.toString('utf8'));
    if(metadata.pid!==row.pid || metadata.pidDomain!=='darwin' || metadata.cwd!==row.cwd || !new RegExp(`^${uuid}$`,'i').test(metadata.sessionId || ''))return null;
    // The native Darwin session registry stores ps lstart in UTC.
    const start=Date.parse(String(metadata.procStart || '')+' UTC');
    if(!Number.isFinite(start) || start!==Date.parse(row.startedAt))return null;
    return {sessionId:metadata.sessionId,title:['user','auto'].includes(metadata.nameSource) && typeof metadata.name==='string' ? metadata.name.replace(/[\r\n\0]/g,' ').slice(0,180) : null};
  } catch {return null;} finally {if(fd!==undefined)fs.closeSync(fd);}
}
