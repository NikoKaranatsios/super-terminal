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
  assert.equal(validHost('user@192.0.2.10'), 'user@192.0.2.10');
  for (const host of ['-oProxyCommand=bad', '-Fprivate@host', '-luser@host', 'host;bad', 'host\nbad', 'user@host bad', 'host/other', '']) assert.throws(() => validHost(host));
});
test('state persists, and malformed state is not overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'super-terminal-store-'));
  try {
    const store = createStore(dir); store.state.hosts.push('host'); store.state.projects=[{id:'p',name:'Example',host:'local',cwd:'/example',notes:'Keep this note'}]; store.save();
    const reloaded = createStore(dir);
    assert.deepEqual(reloaded.state.hosts, ['host']);
    assert.equal(reloaded.state.projects[0].notes, 'Keep this note');
    assert.equal(fs.existsSync(path.join(dir, 'state.json')), false);
    assert.match(fs.readFileSync(path.join(dir, 'workspaces', 'local', 'projects', 'p.md'), 'utf8'), /Keep this note/);
    assert.equal(reloaded.state.directories.local, path.join(dir, 'workspaces', 'local'));
    const remote = path.join(dir, 'remote-directory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'directories.json'), JSON.stringify({ local: path.join(dir, 'workspaces', 'local'), remote }));
    store.state.hosts.push('remote'); store.state.projects.push({ id:'r', name:'Remote', host:'remote', notes:'Remote note' }); store.save();
    assert.match(fs.readFileSync(path.join(remote, 'projects', 'r.md'), 'utf8'), /Remote note/);
    assert.equal(createStore(dir).state.directories.remote, remote);
    const runtime = path.join(dir, 'runtime', 'runtime.json');
    const saved = fs.readFileSync(runtime, 'utf8');
    fs.writeFileSync(runtime, 'broken');
    assert.throws(() => createStore(dir), /left untouched/);
    assert.equal(fs.readFileSync(runtime, 'utf8'), 'broken');
    fs.writeFileSync(runtime, saved);
    const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'super-terminal-legacy-'));
    fs.writeFileSync(path.join(legacy, 'state.json'), 'broken');
    assert.throws(() => createStore(legacy), /left untouched/);
    assert.equal(fs.readFileSync(path.join(legacy, 'state.json'), 'utf8'), 'broken');
    fs.rmSync(legacy, { recursive: true, force: true });
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
