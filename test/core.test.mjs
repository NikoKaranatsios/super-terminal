import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, quote, validHost, createStore } from '../server/core.mjs';
import { readRecords, messagesFromRecords } from '../server/history.mjs';

test('shell quoting keeps shell metacharacters literal', async () => {
  const values = ["a'b", '$(echo BAD)', '`echo BAD`', 'line\nnext', '; touch /tmp/not-allowed'];
  for (const value of values) {
    const result = await run('/bin/sh', ['-c', `printf %s ${quote(value)}`]);
    assert.equal(result.stdout, value);
  }
});
test('SSH host validation rejects command and option injection', () => {
  assert.equal(validHost('user@192.0.2.157'), 'user@192.0.2.157');
  for (const host of ['-oProxyCommand=bad', '-Fprivate@host', '-luser@host', 'host;bad', 'host\nbad', 'user@host bad', 'host/other', '']) assert.throws(() => validHost(host));
});
test('state persists, and malformed state is not overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'super-terminal-store-'));
  try {
    const store = createStore(dir); store.state.hosts.push('host'); store.save();
    assert.deepEqual(createStore(dir).state.hosts, ['host']);
    fs.writeFileSync(path.join(dir, 'state.json'), 'broken');
    assert.throws(() => createStore(dir));
    assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), 'broken');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('transcripts ignore tool output and partial JSONL writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'super-terminal-history-'));
  try {
    const file = path.join(dir, 'chat.jsonl');
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'user', message: { content: 'Please fix the bug.' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', name: 'secret' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'private raw output' }] } }),
      '{"partial":'
    ].join('\n'));
    const messages = messagesFromRecords('claude', readRecords(file));
    assert.deepEqual(messages.map(m => m.text), ['Please fix the bug.', 'Done.']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
