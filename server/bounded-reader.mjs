import {fork} from 'node:child_process';

export class BoundedReader {
  constructor({file=new URL('./reader-process.mjs',import.meta.url),timeout=8000,environment=process.env}={}){Object.assign(this,{file,timeout,environment});this.requests=new Map();this.sequence=0;}
  start(){
    if(this.closed)throw new Error('Reader has stopped.');if(this.child)return;
    const child=fork(this.file,[],{execArgv:[],env:{...this.environment,ELECTRON_RUN_AS_NODE:'1'},silent:true});this.child=child;
    child.stdout.resume();child.stderr.resume();
    child.on('message',message=>{const pending=this.requests.get(message.id);if(!pending)return;this.requests.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(new Error(message.error)):pending.resolve(message.result);});
    child.on('error',error=>this.fail(child,error));child.on('exit',()=>this.fail(child,new Error('Reader stopped before completing its request.')));
  }
  fail(child,error){
    if(this.child!==child)return;this.child=null;
    for(const pending of this.requests.values()){clearTimeout(pending.timer);pending.reject(error);}this.requests.clear();
    child.kill('SIGKILL');
  }
  call(operation,input){
    this.start();const id=++this.sequence,child=this.child;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(child,new Error(`${operation} reader timed out; retained data may be stale.`)),this.timeout);this.requests.set(id,{resolve,reject,timer});child.send({id,operation,input},error=>{if(error)this.fail(child,error);});});
  }
  close(){this.closed=true;if(this.child)this.fail(this.child,new Error('Reader stopped.'));}
}

export class IsolatedHistory {
  constructor(reader=new BoundedReader()){this.reader=reader;this.cache=[];this.warnings=[];this.refreshed=0;}
  async all(force=false){
    if(!force&&Date.now()-this.refreshed<15000)return this.cache;
    if(this.pending)return this.pending;
    this.pending=(async()=>{try{const result=await this.reader.call('history-index',{force});const present=new Set(result.rows.map(row=>row.id));this.cache=[...result.rows,...(result.warnings?.length?this.cache.filter(row=>!present.has(row.id)).map(row=>({...row,sourceStale:true})):[])];this.warnings=result.warnings;}catch(error){this.warnings=[error.message];this.cache=this.cache.map(row=>({...row,sourceStale:true}));}finally{this.refreshed=Date.now();this.pending=null;}return this.cache;})();return this.pending;
  }
  async transcript(id,cursor){return this.reader.call('history-transcript',{id,cursor});}
  async markers(rows,since){return this.reader.call('history-markers',{rows,since});}
}
