import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

if(process.platform!=='darwin')throw new Error('Automatic installation currently supports macOS. Use the bundle in release/ on Linux.');
const source=path.resolve(`release/Super Terminal-darwin-${process.arch}/Super Terminal.app`);
if(!fs.existsSync(source))throw new Error('Build the desktop app first: npm run package:desktop');
const folder=path.join(os.homedir(),'Applications'),target=path.join(folder,'Super Terminal.app');
fs.mkdirSync(folder,{recursive:true});
if(fs.existsSync(target)){
  const id=execFileSync('/usr/libexec/PlistBuddy',['-c','Print CFBundleIdentifier',path.join(target,'Contents/Info.plist')],{encoding:'utf8'}).trim();
  if(id!=='com.nikokaranatsios.super-terminal')throw new Error('Another app already has that name. It was left untouched.');
  const processes=execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8'});
  if(processes.includes(path.join(target,'Contents/MacOS/Super Terminal')))throw new Error('Quit Super Terminal before installing the new build.');
}
// Stage the complete replacement before moving the installed app. Keep rollback
// available until the new bundle is in place, then send the old copy to Trash.
const staging=fs.mkdtempSync(path.join(folder,'.super-terminal-install-'));
const next=path.join(staging,'Super Terminal.app'),previous=path.join(staging,'previous.app');
try {
  execFileSync('/usr/bin/ditto',[source,next]);
  if(fs.existsSync(target))fs.renameSync(target,previous);
  try { fs.renameSync(next,target); }
  catch(error) { if(fs.existsSync(previous))fs.renameSync(previous,target); throw error; }
  if(fs.existsSync(previous)){
    const trash=path.join(os.homedir(),'.Trash');fs.mkdirSync(trash,{recursive:true});
    fs.renameSync(previous,path.join(trash,`Super Terminal replaced ${Date.now()}.app`));
  }
  // The installed copy is now authoritative; consume the generated build copy.
  fs.rmSync(source,{recursive:true});
} finally {
  // Never discard a rollback bundle if moving it to Trash failed.
  if(!fs.existsSync(previous))fs.rmSync(staging,{recursive:true,force:true});
}
console.log('Installed:',target);
