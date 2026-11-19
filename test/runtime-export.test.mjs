import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {saveRuntimePatch}=createRequire(import.meta.url)('../desktop/export-patch.cjs');
const input={id:'12345678-1234-1234-1234-123456789abc',patch:'diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n'};

test('native patch export writes only an explicitly selected file and retains existing files on failure',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'st-export-')),target=path.join(directory,'fixture.patch');
  try{
    const canceled=await saveRuntimePatch(input,{choose:async()=>({canceled:true}),io:{writeFile(){throw Error('Must not write');}}});assert.equal(canceled.canceled,true);
    await assert.rejects(saveRuntimePatch({...input,patch:'not a patch'},{choose:async()=>{throw Error('Must not prompt');}}),/valid runtime patch/);
    assert.deepEqual(await saveRuntimePatch(input,{choose:async()=>({filePath:target})}),{saved:true});assert.equal(fs.readFileSync(target,'utf8'),input.patch);assert.equal(fs.statSync(target).mode&0o777,0o600);
    await assert.rejects(saveRuntimePatch(input,{choose:async()=>({filePath:target}),io:{...fs.promises,rename:async()=>{throw Error('Synthetic disk failure');}}}),/disk failure/);assert.equal(fs.readFileSync(target,'utf8'),input.patch);assert.deepEqual(fs.readdirSync(directory),['fixture.patch']);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
