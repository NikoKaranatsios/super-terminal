const fields=['id','provider','sessionId','host','kind','cwd','title','owner','updatedAt','createdAt','repository','repositoryVerified','canonicalCwd','file','model','modelSource','modelObservedAt','repositoryProjectRoot','repositoryCommonDir','repositoryGroupVerified','branch','worktreeRoot','parentSessionId','nativeSubagent','readOnly','agentRole'];
export function persistRemoteIndex(state,host,rows,indexedAt){
  state.remoteIndexes ||= {};
  state.remoteIndexes[host]={version:1,indexedAt,rows:rows.filter(row=>row.host===host&&typeof row.id==='string'&&typeof row.provider==='string'&&typeof row.sessionId==='string').map(row=>Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])))};
}
export function restoreRemoteIndexes(state,allowedHosts){
  const cache=new Map();
  for(const host of allowedHosts){const saved=state.remoteIndexes?.[host];if(saved?.version!==1||!Array.isArray(saved.rows))continue;cache.set(host,{host,sessions:[],processes:[],history:saved.rows.filter(row=>row.host===host).map(row=>({...row,sourceStale:true})),indexedAt:0,cachedAt:saved.indexedAt,healthy:false,error:'Saved index; waiting for this environment to reconnect.'});}
  return cache;
}
