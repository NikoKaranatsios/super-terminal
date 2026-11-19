import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installDesktop } from './desktop-install.mjs';

if(process.platform!=='darwin')throw new Error('Automatic installation currently supports macOS. Use the bundle in release/ on Linux.');
const result=installDesktop({
  source:path.resolve(`release/Super Terminal-darwin-${process.arch}/Super Terminal.app`),
  folder:path.join(os.homedir(),'Applications'),trash:path.join(os.homedir(),'.Trash'),
  copy:(source,next)=>execFileSync('/usr/bin/ditto',[source,next]),
  readBundleId:bundle=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print CFBundleIdentifier',path.join(bundle,'Contents/Info.plist')],{encoding:'utf8'}).trim(),
  isRunning:target=>execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8'}).includes(path.join(target,'Contents/MacOS/Super Terminal')),
});
console.log('Installed:',result.target);
