import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Super Terminal requires local loopback HTTP.');
  return url.origin;
}

export function validateConfig(file) {
  if (!file || !path.isAbsolute(file)) throw new Error('Set an absolute SUPER_TERMINAL_AGENT_CONFIG path from local enrollment.');
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('Agent configuration must be a private file owned by this user (mode 600).');
  const config = JSON.parse(fs.readFileSync(file,'utf8'));
  if(config.transport==='stdio-spool') {
    if(config.spool!=='/workspace/bridge'||path.dirname(file)!==config.spool||!config.id)throw new Error('Invalid container-scoped transport.');
    return config;
  }
  localUrl(config.url);
  if (!config.id || typeof config.token !== 'string' || !config.token) throw new Error('Invalid agent configuration.');
  if (config.hostHeader !== new URL(config.url).host) throw new Error('MCP host header must match the local service.');
  return config;
}

/** Reuse the helper's cross-process flock and flushed outbox; no shell or model. */
export function platformCall(configPath, payload) {
  validateConfig(configPath);
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',[fileURLToPath(new URL('./bridge.py',import.meta.url)),'rpc'],{env:{...process.env,SUPER_TERMINAL_AGENT_CONFIG:configPath,SUPER_TERMINAL_TRANSPORT:'mcp'},stdio:['pipe','pipe','pipe']});
    let out='',err='',overflow=false;
    const timer=setTimeout(()=>child.kill('SIGKILL'),130000);
    const collect=key=>data=>{if(key==='out')out+=data;else err+=data;if(out.length+err.length>4*1024*1024){overflow=true;child.kill('SIGKILL');}};
    child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      clearTimeout(timer);
      if(overflow)return reject(new Error('Platform response exceeded the output limit.'));
      if(code!==0){
        let detail;try{detail=JSON.parse(err.trim());}catch{}
        return reject(Object.assign(new Error(detail?.error || err.trim().slice(0,1600) || 'Platform helper interrupted; inspect pending events before retrying.'),{delivery:detail}));
      }
      try{resolve(JSON.parse(out));}catch{reject(new Error('Invalid platform response.'));}
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
