import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../server/core.mjs';
import { readRecordPage, eventsFromRecords } from '../server/transcript.mjs';

test('paged output retains complete records without gaps or duplicates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-output-'));
  try {
    const file = path.join(dir, 'output.jsonl');
    const source = Array.from({length: 90}, (_, i) => ({i, content: 'Unicode λ ' + 'x'.repeat(i * 11)}));
    fs.writeFileSync(file, source.map(r => JSON.stringify(r)).join('\n') + '\n{"incomplete":');
    let cursor, found = [], iterations = 0;
    do {
      const page = readRecordPage(file, cursor, 500);
      assert.ok(page.nextCursor === null || page.nextCursor < (cursor ?? Infinity));
      found = [...page.records, ...found]; cursor = page.nextCursor;
      assert.ok(++iterations < 150);
    } while (cursor !== null);
    assert.deepEqual(found, source);
    assert.throws(() => readRecordPage(file, -1));
    assert.throws(() => readRecordPage(file, 'not-an-offset'));
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

const codex = [
  {type:'response_item', payload:{type:'message',role:'assistant',channel:'commentary',content:[{type:'output_text',text:'Checking the implementation.'}]}},
  {type:'response_item', payload:{type:'function_call',name:'exec_command',arguments:'{"cmd":"npm test"}'}},
  {type:'response_item', payload:{type:'function_call_output',call_id:'call1',output:'Tests passed.'}},
  {type:'response_item', payload:{type:'reasoning',encrypted_content:'opaque private value'}},
  {type:'response_item', payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Finished.'}]}}
];
const claude = [
  {type:'assistant',message:{content:[{type:'text',text:'Checking.'},{type:'tool_use',name:'Bash',input:{command:'npm test'}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'call1',content:[{type:'text',text:'Tests passed.'}]}]}},
  {type:'assistant',message:{content:[{type:'thinking',thinking:'private'},{type:'text',text:'Finished.'}]}}
];
test('output includes commentary, tool calls and results without decoding internal reasoning', () => {
  assert.deepEqual(eventsFromRecords('codex',codex).map(e=>e.kind),['commentary','tool_call','tool_result','message']);
  assert.deepEqual(eventsFromRecords('claude',claude).map(e=>e.kind),['message','tool_call','tool_result','message']);
  assert.equal(eventsFromRecords('codex',codex)[2].text,'Tests passed.');
});

test('remote reader renders the same provider output as the local reader',async()=>{
  // Load only function definitions; never execute remote discovery in this test.
  const source=fs.readFileSync(new URL('../server/remote-reader.py',import.meta.url),'utf8').split('\nresult=discover()')[0];
  for(const [provider,records] of [['codex',codex],['claude',claude]]){
    const script=source+'\nprint(json.dumps(output_events('+JSON.stringify(provider)+',json.loads('+JSON.stringify(JSON.stringify(records))+'))))\n';
    const result=await run('python3',['-c',script]);
    assert.deepEqual(JSON.parse(result.stdout),eventsFromRecords(provider,records));
  }
});
