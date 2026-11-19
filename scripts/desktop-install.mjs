import fs from 'node:fs';
import path from 'node:path';

export const APP_ID='com.nikokaranatsios.super-terminal';

// Dependencies are explicit so failure branches run only in disposable fixtures.
export function installDesktop({source,folder,trash,copy,readBundleId,isRunning,io=fs,stamp=Date.now()}){
  const target=path.join(folder,'Super Terminal.app');
  if(!io.existsSync(source))throw new Error('Build the desktop app first: npm run package:desktop');
  if(readBundleId(source)!==APP_ID)throw new Error('The generated bundle has a different application identity. It was left untouched.');
  if(io.existsSync(target)&&readBundleId(target)!==APP_ID)throw new Error('Another app already has that name. It was left untouched.');
  if(isRunning(target))throw new Error('Quit Super Terminal before installing the new build.');
  io.mkdirSync(folder,{recursive:true});
  const staging=io.mkdtempSync(path.join(folder,'.super-terminal-install-'));
  const next=path.join(staging,'Super Terminal.app'),previous=path.join(staging,'previous.app');
  let failure,trashedPrevious;
  try{
    copy(source,next);
    if(readBundleId(next)!==APP_ID)throw new Error('The staged bundle failed its identity check.');
    if(io.existsSync(target))io.renameSync(target,previous);
    try{io.renameSync(next,target);}
    catch(error){
      if(io.existsSync(previous)){
        try{io.renameSync(previous,target);}
        catch(rollback){throw new Error(`Replacement failed: ${error.message}. Restoring the previous app also failed: ${rollback.message}`);}
      }
      throw error;
    }
    if(io.existsSync(previous)){
      io.mkdirSync(trash,{recursive:true});
      trashedPrevious=path.join(trash,`Super Terminal replaced ${stamp}.app`);
      io.renameSync(previous,trashedPrevious);
    }
    io.rmSync(source,{recursive:true});
  }catch(error){failure=error;}
  // Retain both recovery bundles when restoring or moving the old one failed.
  if(!io.existsSync(previous)){
    try{io.rmSync(staging,{recursive:true,force:true});}
    catch(error){failure=new Error([failure?.message,'Staging cleanup failed: '+error.message].filter(Boolean).join('. '));}
  }
  if(failure){
    const retained=[previous,next,source].filter(file=>io.existsSync(file));
    if(io.existsSync(staging)&&!retained.some(file=>file.startsWith(staging+path.sep)))retained.push(staging);
    const installed=io.existsSync(target)?target:null;
    throw Object.assign(new Error(`Installation did not finish: ${failure.message}. ${installed?'Available installed app: '+installed:'No app is installed at '+target}. ${retained.length?'Recovery artifacts retained: '+retained.join(', '):'No staging artifacts remain.'}${trashedPrevious&&io.existsSync(trashedPrevious)?' Previous app in Trash: '+trashedPrevious:''}`),{cause:failure,installed,retained,trashedPrevious});
  }
  return {target,trashedPrevious,retained:[]};
}
