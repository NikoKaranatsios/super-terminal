const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

async function saveRuntimePatch({id,patch},{choose,io=fs}={}){
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||typeof patch!=='string'||Buffer.byteLength(patch)>32*1024*1024||!patch.startsWith('diff --git '))throw new Error('A valid runtime patch is required.');
  const result=await choose({title:'Export runtime changes',defaultPath:`agent-${id}.patch`,filters:[{name:'Git patch',extensions:['patch']}],properties:['createDirectory','showOverwriteConfirmation']});
  if(result.canceled||!result.filePath)return {saved:false,canceled:true};
  const temporary=path.join(path.dirname(result.filePath),`.st-export-${randomUUID()}.tmp`);
  try{await io.writeFile(temporary,patch,{mode:0o600,flag:'wx',flush:true});await io.rename(temporary,result.filePath);return {saved:true};}
  finally{await io.rm(temporary,{force:true});}
}
module.exports={saveRuntimePatch};
