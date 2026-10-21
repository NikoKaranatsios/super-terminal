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
