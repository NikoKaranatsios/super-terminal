import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

test('real PTYs, persistent sessions, scoped mailboxes, and isolated browsers', { timeout: 90000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'super-terminal-integration-'));
  const listener = http.createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), SUPER_TERMINAL_DATA: dir, SUPER_TERMINAL_SOCKET: 'super-terminal-test-' + port, SUPER_TERMINAL_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', d => { logs += d; });
  const sockets = [];
  let auth;
  const api = async (url, method = 'GET', body) => {
    const response = await fetch(base + '/api' + url, { method, headers: { 'x-super-terminal': auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  t.after(async () => {
    for (const s of sockets) s.close();
    if (auth) {
      try { for (const s of (await api('/state')).sessions.filter(s => s.kind === 'managed')) await api('/sessions/' + s.id, 'DELETE'); } catch {}
    }
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('close', resolve); });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 80; i++) {
    try {
      const page = await (await fetch(base)).text();
      auth = page.match(/name="super-terminal-token" content="([^"]+)"/)?.[1];
      if (auth) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(auth, logs);
  await t.test('blocks other websites, unknown hosts and unauthenticated clients', async () => {
    assert.equal((await fetch(base + '/api/state')).status, 403);
    assert.equal((await fetch(base, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const forgedHostStatus = await new Promise((resolve, reject) => {
      const r = http.get(base, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
      r.on('error', reject);
    });
    assert.equal(forgedHostStatus, 403);
    assert.equal((await fetch(base + '/api/sessions', { method: 'POST', headers: { 'x-super-terminal': auth, 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'shell', host: 'unapproved.example' }) })).status, 400);
    const ws = new WebSocket(base.replace('http', 'ws') + '/terminal?token=' + auth, { origin: 'https://evil.example' });
    const code = await new Promise(resolve => { ws.on('unexpected-response', (_, res) => { resolve(res.statusCode); ws.terminate(); }); ws.on('error', () => {}); });
    assert.equal(code, 403);
  });
  const one = await api('/sessions', 'POST', { provider: 'shell', cwd: dir, title: 'test-one', group: 'Test peers' });
  const two = await api('/sessions', 'POST', { provider: 'shell', cwd: dir, title: 'test-two', group: 'Test peers' });
  assert.equal(one.agentToken, undefined);
  function attach(id) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(base.replace('http', 'ws') + '/terminal?token=' + auth + '&id=' + id, { origin: base });
      sockets.push(ws); let output = '';
      ws.on('message', raw => {
        const m = JSON.parse(raw);
        if (m.type === 'output') output += m.data;
        if (m.type === 'error') reject(new Error(m.message));
        if (m.type === 'ready') resolve({ ws, output: () => output });
      });
      ws.on('error', reject);
    });
  }
  await t.test('PTY input executes, resize works, and shell survives detach', async () => {
    const first = await attach(one.id);
    first.ws.send(JSON.stringify({ type: 'resize', cols: 90, rows: 26 }));
    first.ws.send(JSON.stringify({ type: 'input', data: "export ST_TEST_MARKER=persisted; printf '\\nPTY_%s_OK\\n' live\r" }));
    for (let i = 0; i < 60 && !first.output().includes('PTY_live_OK'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(first.output(), /PTY_live_OK/);
    first.ws.close();
    await new Promise(r => setTimeout(r, 150));
    const next = await attach(one.id);
    next.ws.send(JSON.stringify({ type: 'input', data: "printf '\\nSTATE_%s_OK\\n' \"$ST_TEST_MARKER\"\r" }));
    for (let i = 0; i < 60 && !next.output().includes('STATE_persisted_OK'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(next.output(), /STATE_persisted_OK/);
  });
  await t.test('agent tokens can message peers but cannot control terminals', async () => {
    const privateState = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
    const token = privateState.sessions.find(s => s.id === one.id).agentToken;
    const agent = async body => {
      const r = await fetch(base + '/api/agent', { method: 'POST', headers: { 'x-super-terminal-agent': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, data: await r.json() };
    };
    assert.equal((await agent({ command: 'peers' })).data.peers[0].id, two.id);
    assert.equal((await agent({ command: 'send', to: two.id, message: 'Test handoff' })).status, 200);
    assert.equal((await fetch(base + '/api/state', { headers: { 'x-super-terminal-agent': token } })).status, 403);
    await api('/sessions/' + two.id, 'PATCH', { group: 'Other group' });
    assert.equal((await agent({ command: 'send', to: two.id, message: 'Must be blocked' })).status, 400);
    await api('/context', 'PUT', { group: 'Test peers', content: 'Shared test context' });
    assert.equal((await agent({ command: 'context' })).data.content, 'Shared test context');
  });
  await t.test('each browser owns separate cookies and returns screenshots', async () => {
    const fixture = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      if (req.url === '/set') res.setHeader('Set-Cookie', 'agent=one; Path=/');
      res.end(`<html><title>Isolation test</title><body><h1>${req.headers.cookie || 'clean profile'}</h1><button onclick="this.textContent='Clicked'">Test button</button><input id="field" aria-label="Test field"></body></html>`);
    });
    await new Promise(r => fixture.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${fixture.address().port}`;
      await api('/browser/' + one.id, 'POST', { action: 'open', url: url + '/set' });
      const original = await api('/browser/' + one.id, 'POST', { action: 'open', url });
      assert.match(original.snapshot, /agent=one/);
      const isolated = await api('/browser/' + two.id, 'POST', { action: 'open', url });
      assert.match(isolated.snapshot, /clean profile/);
      const clicked = await api('/browser/' + two.id, 'POST', { action: 'click', selector: 'role=button[name="Test button"]' });
      assert.match(clicked.snapshot, /Clicked/);
      await api('/browser/' + two.id, 'POST', { action: 'fill', selector: '#field', text: 'Agent input' });
      const image = await api('/browser/' + two.id, 'POST', { action: 'screenshot' });
      assert.ok(image.image.length > 1000);
      assert.match(Buffer.from(image.image, 'base64').subarray(1, 4).toString(), /PNG/);
      const forbidden = await fetch(base + '/api/browser/' + two.id, { method: 'POST', headers: { 'x-super-terminal': auth, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'open', url: base }) });
      assert.equal(forbidden.status, 400, 'Agent browser must not load the dashboard bootstrap token');
    } finally { fixture.closeAllConnections(); await new Promise(r => fixture.close(r)); }
  });
  await t.test('teams launch role terminals and reject duplicate running roles', async () => {
    const team=await api('/teams','POST',{name:'Verification team',mission:'Check local integration.',cwd:dir,host:'local'});
    await api('/sessions/'+one.id,'PATCH',{group:team.name});
    const briefing=await api('/teams/'+team.id+'/brief','POST',{});
    assert.equal(briefing.count,1);
    const launched=await api('/teams/'+team.id+'/start','POST',{roles:[{name:'Verifier',provider:'shell',assignment:'Verify.'}]});
    assert.equal(launched.launched.length,1);
    assert.equal(launched.errors.length,0);
    const duplicate=await fetch(base+'/api/teams/'+team.id+'/start',{method:'POST',headers:{'x-super-terminal':auth,'content-type':'application/json'},body:JSON.stringify({roles:[{name:'Verifier',provider:'shell'}]})});
    assert.equal(duplicate.status,400);
  });
  await t.test('working sessions support scoped agents, progress, wrap-up and carry-forward', async () => {
    const work=await api('/work-sessions','POST',{title:'Verification work',topics:'Alpha: Finish API\nBeta: Verify interface'});
    const alpha=work.projects[0], beta=work.projects[1];
    await api('/sessions/'+one.id,'PATCH',{scope:{workSessionId:work.id,projectId:alpha.id,goalId:alpha.goals[0].id}});
    await api('/sessions/'+two.id,'PATCH',{scope:{workSessionId:work.id}});
    const privateState=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
    const credential=privateState.sessions.find(s=>s.id===one.id).agentToken;
    const agent=async body=>{const r=await fetch(base+'/api/agent',{method:'POST',headers:{'x-super-terminal-agent':credential,'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
    assert.ok((await agent({command:'peers'})).data.peers.some(s=>s.id===two.id));
    assert.equal((await agent({command:'progress',goal:beta.goals[0].id,status:'done',notes:'Must be blocked'})).status,400);
    assert.equal((await agent({command:'progress',status:'done'})).status,400);
    assert.equal((await agent({command:'progress',status:'done',notes:'Verified in integration test.'})).data.status,'done');
    const wrapped=await api('/work-sessions/'+work.id,'PATCH',{status:'wrapped',notes:'Continue with Beta.'});
    assert.match(wrapped.summary,/1\/2 goals completed/);
    const next=await api('/work-sessions','POST',{title:'Next work',carryFrom:work.id,topics:''});
    assert.equal(next.projects.length,1);
    assert.equal(next.projects[0].name,'Beta');
    assert.equal(next.projects[0].goals[0].status,'todo');
  });
});
