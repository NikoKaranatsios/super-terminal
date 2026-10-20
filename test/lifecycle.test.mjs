import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'super-terminal-lifecycle-'));
process.env.SUPER_TERMINAL_DATA = dir;
const { AgentBrowsers } = await import('../server/browsers.mjs');
const { Coordinator } = await import('../server/coordinator.mjs');
const { env } = await import('../server/core.mjs');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

for (const wholeServer of [false, true]) {
  test(`closing ${wholeServer ? 'the server' : 'a session'} waits for an in-flight browser launch`, async t => {
    let finishLaunch;
    t.mock.method(chromium, 'launchPersistentContext', () => new Promise(resolve => { finishLaunch = resolve; }));
    const context = new EventEmitter();
    let closed = 0;
    Object.assign(context, {
      route: async () => {}, setDefaultTimeout() {}, pages: () => [{}],
      close: async () => { closed++; context.emit('close'); },
    });
    const browsers = new AgentBrowsers();
    const opening = browsers.get('synthetic-session');
    let done = false;
    const closing = (wholeServer ? browsers.close() : browsers.action('synthetic-session', { action: 'close' })).then(() => { done = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(done, false, 'close must not report success while launch can still create a browser');
    finishLaunch(context);
    await Promise.all([opening, closing]);
    assert.equal(closed, 1);
    assert.equal(browsers.contexts.size, 0);
    if (wholeServer) await assert.rejects(browsers.get('another-session'), /shutting down/);
  });
}

test('cancelling snapshot preparation prevents a later coordinator model invocation', async t => {
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const marker = path.join(dir, 'unexpected-model-process');
  const fakeCli = path.join(bin, 'codex');
  fs.writeFileSync(fakeCli, '#!/bin/sh\nprintf test > "' + marker + '"\nexit 2\n', { mode: 0o700 });
  const priorPath = env.PATH;
  env.PATH = bin;
  t.after(() => { env.PATH = priorPath; });
  const coordinator = new Coordinator({ state: {}, save() {} });
  let finishSnapshot;
  coordinator.snapshot = () => new Promise(resolve => { finishSnapshot = resolve; });
  const result = coordinator.ask('Synthetic test request', '', [], {});
  coordinator.cancel();
  finishSnapshot('Synthetic snapshot');
  await assert.rejects(result, /cancelled before starting/);
  assert.equal(coordinator.running, false);
  assert.equal(fs.existsSync(marker), false);
});


test('missing coordinator output reports an error without crashing the server', async t => {
  const bin = path.join(dir, 'empty-answer-bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const priorPath = env.PATH; env.PATH = bin;
  t.after(() => { env.PATH = priorPath; });
  const coordinator = new Coordinator({ state: {}, save() {} });
  coordinator.snapshot = async () => 'Synthetic snapshot';
  const result = await coordinator.ask('Synthetic test request', '', [], {});
  assert.equal(result.status, 'error');
  assert.match(result.answer, /without a readable answer/);
  assert.equal(coordinator.running, false);
});


test('a working-session briefing omits unrelated team missions', async () => {
  const coordinator = new Coordinator({ state: {
    teams: [
      { name: 'Current team', mission: 'Current synthetic mission', scope: { workSessionId: 'current' } },
      { name: 'Other team', mission: 'Unrelated confidential mission', scope: { workSessionId: 'other' } },
    ],
    workSessions: [{ id: 'current', title: 'Current work', projects: [] }],
  }, save() {} });
  const snapshot = await coordinator.snapshot([], { all: async () => [] }, '', 'current');
  assert.match(snapshot, /Current synthetic mission/);
  assert.doesNotMatch(snapshot, /Unrelated confidential mission/);
});
