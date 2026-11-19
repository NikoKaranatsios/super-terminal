import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_ID,installDesktop } from '../scripts/desktop-install.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-terminal-install-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'build.app'),folder=path.join(dir,'Applications'),target=path.join(folder,'Super Terminal.app'),trash=path.join(dir,'Trash');
  for(const [file,version] of [[source,'new'],[target,'old']]){fs.mkdirSync(file,{recursive:true});fs.writeFileSync(path.join(file,'identity'),APP_ID);fs.writeFileSync(path.join(file,'version'),version);}
  const options={source,folder,trash,copy:(a,b)=>fs.cpSync(a,b,{recursive:true}),readBundleId:bundle=>fs.readFileSync(path.join(bundle,'identity'),'utf8'),isRunning:()=>false,stamp:'fixture'};
  return {source,folder,target,trash,options,version:()=>fs.readFileSync(path.join(target,'version'),'utf8')};
}
const fault=(options,method,fail)=>options.io=new Proxy(fs,{get(target,key){if(key!==method)return target[key];return(...args)=>{if(fail(...args))throw new Error('Fixture '+method+' failed');return target[key](...args);};}});

test('installer replaces the authoritative app, preserves previous in Trash and consumes generated output',t=>{
  const f=fixture(t),result=installDesktop(f.options);
  assert.equal(f.version(),'new');assert.equal(fs.existsSync(f.source),false);
  assert.equal(fs.readFileSync(path.join(result.trashedPrevious,'version'),'utf8'),'old');
  assert.deepEqual(fs.readdirSync(f.folder),['Super Terminal.app']);
});
test('installer leaves missing builds, unrelated apps and running apps untouched',async t=>{
  for(const scenario of ['missing','unrelated','source-id','running'])await t.test(scenario,t=>{
    const f=fixture(t);
    if(scenario==='missing')fs.rmSync(f.source,{recursive:true});
    if(scenario==='unrelated')fs.writeFileSync(path.join(f.target,'identity'),'unrelated');
    if(scenario==='source-id')fs.writeFileSync(path.join(f.source,'identity'),'unrelated');
    if(scenario==='running')f.options.isRunning=()=>true;
    assert.throws(()=>installDesktop(f.options));assert.equal(f.version(),'old');assert.deepEqual(fs.readdirSync(f.folder),['Super Terminal.app']);
  });
});
test('copy and replacement failures preserve the previous app and source build',async t=>{
  for(const scenario of ['copy','old-rename','replacement'])await t.test(scenario,t=>{
    const f=fixture(t);
    if(scenario==='copy')f.options.copy=(a,b)=>{fs.mkdirSync(b);throw new Error('Fixture copy failed');};
    else fault(f.options,'renameSync',(from,to)=>scenario==='old-rename'?from===f.target:to===f.target&&path.basename(from)==='Super Terminal.app');
    const error=assert.throws(()=>installDesktop(f.options));
    assert.equal(f.version(),'old');assert.equal(fs.existsSync(f.source),true);assert.deepEqual(fs.readdirSync(f.folder),['Super Terminal.app']);
  });
});
test('failed rollback reports and retains both recovery bundles without deleting the build',t=>{
  const f=fixture(t);fault(f.options,'renameSync',(from,to)=>to===f.target);
  let failure;try{installDesktop(f.options);}catch(error){failure=error;}
  assert.equal(failure.installed,null);assert.match(failure.message,/Restoring the previous app also failed/);
  const previous=failure.retained.find(p=>p.endsWith('previous.app')),next=failure.retained.find(p=>p.includes('.super-terminal-install-')&&p.endsWith('Super Terminal.app'));
  assert.equal(fs.readFileSync(path.join(previous,'version'),'utf8'),'old');assert.equal(fs.readFileSync(path.join(next,'version'),'utf8'),'new');assert.ok(fs.existsSync(f.source));
});
test('Trash and cleanup failures identify the installed app and retained artifacts',async t=>{
  for(const scenario of ['trash','source-cleanup','stage-cleanup'])await t.test(scenario,t=>{
    const f=fixture(t);
    if(scenario==='trash')fault(f.options,'renameSync',(from,to)=>to.startsWith(f.trash+path.sep));
    else fault(f.options,'rmSync',file=>scenario==='source-cleanup'?file===f.source:file.includes('.super-terminal-install-'));
    let failure;try{installDesktop(f.options);}catch(error){failure=error;}
    assert.equal(f.version(),'new');assert.equal(failure.installed,f.target);assert.match(failure.message,/Recovery artifacts retained/);assert.ok(failure.retained.every(p=>fs.existsSync(p)));
    if(scenario==='trash')assert.ok(failure.retained.some(p=>p.endsWith('previous.app')));
    if(scenario==='source-cleanup')assert.ok(failure.retained.includes(f.source));
    if(scenario==='stage-cleanup')assert.equal(fs.existsSync(f.source),false);
  });
});
