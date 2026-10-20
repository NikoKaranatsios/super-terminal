import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, quote, validHost, createStore } from '../server/core.mjs';
import { readRecords, messagesFromRecords } from '../server/history.mjs';
import { parseTmuxPanes, terminalTty, externalTerminals } from '../server/discovery.mjs';

test('terminal discovery tolerates diagnostic lines, incomplete panes and missing TTYs', async () => {
  const output = [
    'tmux: diagnostic message',
    '$0\twork\t/tmp\tcodex\t/dev/ttys001\t%1\t0',
    '$1\tincomplete',
    '$2\tfinished\t/tmp\t\t\t%3\t1',
    ''
  ].join('\n');
  const panes = parseTmuxPanes(output);
  assert.equal(panes.length, 2);
  assert.equal(panes[0].pane, '%1');
  assert.equal(panes[1].dead, true);
  assert.equal(terminalTty(undefined), null);
  assert.equal(terminalTty(null), null);
  assert.equal(terminalTty(''), null);
  assert.equal(terminalTty('/dev/ttys001'), 'ttys001');
  assert.equal(terminalTty('pts/4'), 'pts/4');
  // This input previously rejected every /api/state request with reading 'replace'.
  assert.ok(Array.isArray(await externalTerminals([undefined, null, '', '/dev/nonexistent'])));
});

test('shell quoting keeps shell metacharacters literal', async () => {
  const values = ["a'b", '$(echo BAD)', '`echo BAD`', 'line\nnext', '; touch /tmp/not-allowed'];
  for (const value of values) {
    const result = await run('/bin/sh', ['-c', `printf %s ${quote(value)}`]);
    assert.equal(result.stdout, value);
  }
});
test('SSH host validation rejects command and option injection', () => {
  assert.equal(validHost('user@192.0.2.157'), 'user@192.0.2.157');
  for (const host of ['-oProxyCommand=bad', 'host;bad', 'host\nbad', 'user@host bad', 'host/other', '']) assert.throws(() => validHost(host));
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
