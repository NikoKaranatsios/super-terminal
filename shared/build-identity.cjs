const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
function buildIdentity(root){
  const hash=createHash('sha256');
  const packageInfo=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  hash.update(JSON.stringify({version:packageInfo.version,dependencies:packageInfo.dependencies}));
  const visit=relative=>{
    const folder=path.join(root,relative);if(!fs.existsSync(folder))return;
    for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=path.join(relative,entry.name);
      if(entry.isDirectory())visit(file);
      else if(entry.name==='Dockerfile'||/\.(?:cjs|mjs|js|css|html|py|json|md)$/.test(entry.name)){hash.update(file.replaceAll(path.sep,'/'));hash.update(fs.readFileSync(path.join(root,file)));}
    }
  };
  for(const directory of ['server','desktop','shared','dist','runtime'])visit(directory);
  return hash.digest('hex');
}
module.exports={buildIdentity};
