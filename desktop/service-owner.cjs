const {startBackend}=require('./backend.cjs');
// Reused services are never owned, killed or restarted by this controller.
function superviseBackend(options,{start=startBackend,onRecovered=()=>{},onFailure=()=>{},maxRestarts=3}={}){
  let current,stopped=false,recovery,restarts=0,generation=0;
  async function launch(){
    const active=++generation;
    const next=await start({...options,onExit:()=>{if(active===generation&&!stopped)recover();}});
    if(stopped){await next.stop();return;}current=next;return next;
  }
  async function recover(){
    if(stopped||recovery||!current?.owned)return recovery;
    recovery=(async()=>{
      let error;
      while(!stopped&&restarts<maxRestarts){
        restarts++;
        try{await launch();if(!stopped)await onRecovered(current);return;}catch(cause){error=cause;}
      }
      if(!stopped)await onFailure(error || new Error('The local service repeatedly stopped. Restart the app to retry.'));
    })().finally(()=>{recovery=null;});
    return recovery;
  }
  return {get origin(){return current?.origin;},get owned(){return current?.owned;},start:launch,recover,
    async stop(){stopped=true;await recovery;await current?.stop();}};
}
module.exports={superviseBackend};
