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
  fs.renameSync(target,path.join(folder,`Super Terminal backup ${Date.now()}.app`));
}
execFileSync('/usr/bin/ditto',[source,target]);
console.log('Installed:',target);
