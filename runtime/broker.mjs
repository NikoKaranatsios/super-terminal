// Scoped transport over docker exec stdio. No host listener or owner credential
// enters the runtime. One instance per agent; requests survive service restarts.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const root='/workspace/bridge',active=new Set();
for(const kind of ['requests','responses'])fs.mkdirSync(root+'/'+kind,{recursive:true,mode:0o700});
const safe=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
function reply(id,result){if(!safe(id))return;const file=root+'/responses/'+id;fs.writeFileSync(file+'.tmp',JSON.stringify(result),{mode:0o600});fs.renameSync(file+'.tmp',file);fs.rmSync(root+'/requests/'+id,{force:true});active.delete(id);}
// A leftover in-flight request has an uncertain external result. Never silently
// repeat a browser click or launch; logical helper IDs can be queried again.
for(const file of fs.readdirSync(root+'/requests'))if(file.endsWith('.working')){const id=file.slice(0,-8);reply(id,{error:'Control service restarted during this request. Inspect the result before retrying; reuse the helper request ID.'});fs.rmSync(root+'/requests/'+file,{force:true});}
function scan(){
  for(const id of fs.readdirSync(root+'/requests').slice(0,64)){
    if(!safe(id)||active.has(id)||active.size>=8)continue;
    const file=path.join(root,'requests',id);
    try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>262144){reply(id,{error:'Invalid scoped request.'});continue;}
      const payload=JSON.parse(fs.readFileSync(file,'utf8'));fs.renameSync(file,file+'.working');active.add(id);process.stdout.write(JSON.stringify({id,payload})+'\n');
    }catch{reply(id,{error:'Invalid scoped request.'});}
  }
}
readline.createInterface({input:process.stdin}).on('line',line=>{try{const {id,result}=JSON.parse(line);if(active.has(id)){reply(id,result);fs.rmSync(root+'/requests/'+id+'.working',{force:true});}}catch{}}).on('close',()=>process.exit(0));
setInterval(scan,250);scan();
