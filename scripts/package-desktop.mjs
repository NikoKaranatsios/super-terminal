import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeIcon } from './icon.mjs';

if (!['darwin','linux'].includes(process.platform)) throw new Error('This terminal backend currently requires macOS or Linux.');
const icon=makeIcon();
const paths=await packager({
  dir:'.',name:'Super Terminal',executableName:'Super Terminal',out:'release',overwrite:true,
  platform:process.platform,arch:process.arch,asar:false,prune:true,
  appBundleId:'com.nikokaranatsios.super-terminal',appCategoryType:'public.app-category.developer-tools',
  icon,ignore:[/^\/(?:\.git|release|build-assets|test|scripts)(?:\/|$)/,/^\/Start Super Terminal\.command$/,/\.map$/],
  extendInfo:{NSHighResolutionCapable:true}
});
for(const output of paths){
  if(process.platform==='darwin'){
    const bundle=path.join(output,'Super Terminal.app');
    const helper=path.join(bundle,'Contents/Resources/app/node_modules/node-pty/prebuilds',`darwin-${process.arch}`,'spawn-helper');
    if(fs.existsSync(helper))fs.chmodSync(helper,0o755);
    execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',bundle],{stdio:'inherit'});
  }
  console.log('Built:',output);
}
