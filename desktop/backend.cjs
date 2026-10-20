const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function probeBackend(origin, dataDir) {
  let response;
  try {
    response = await fetch(origin + '/desktop-health', { signal: AbortSignal.timeout(1500) });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw new Error('The local service is not responding. Close the old Super Terminal service and try again.');
  }
  let value;
  try { value = await response.json(); } catch {}
  const dataKey = createHash('sha256').update(path.resolve(dataDir)).digest('hex');
  if (!response.ok || value?.product !== 'super-terminal' || value.protocol !== 1 || value.dataKey !== dataKey) {
    throw new Error(`Port ${new URL(origin).port} is occupied by another service or an older Super Terminal version. Stop that service before reopening this app. Your agent terminals can keep running.`);
  }
  return value;
}

async function startBackend({ utilityProcess, root, port, dataDir, env, onExit }) {
  const origin = `http://127.0.0.1:${port}`;
  if (await probeBackend(origin, dataDir)) return { origin, owned: false, stop: async () => {} };
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const logPath = path.join(dataDir, 'desktop-service.log');
  if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) fs.renameSync(logPath, logPath + '.previous');
  const log = fs.createWriteStream(logPath, { flags: 'a', mode: 0o600 });
  const child = utilityProcess.fork(path.join(root, 'desktop/service.cjs'), [], {
    cwd: root, env: { ...env, PORT: String(port), SUPER_TERMINAL_DATA: dataDir },
    stdio: 'pipe', serviceName: 'Super Terminal Service'
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  let expectedExit = false, alive = true, ready = false;
  child.on('exit', code => {
    alive = false; log.end();
    if (ready && !expectedExit) onExit?.(code);
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('The local service took too long to start. See desktop-service.log in your local data folder.')), 20000);
      const exited = code => finish(new Error(`The local service exited (${code}). See desktop-service.log in your local data folder.`));
      const message = value => { if (value?.type === 'ready' && value.port === port) finish(); };
      function finish(error) {
        clearTimeout(timer); child.removeListener('exit', exited); child.removeListener('message', message);
        error ? reject(error) : resolve();
      }
      child.on('exit', exited); child.on('message', message);
    });
    await probeBackend(origin, dataDir);
    ready = true;
  } catch (error) { expectedExit = true; child.kill(); throw error; }
  return {
    origin, owned: true,
    async stop() {
      expectedExit = true;
      if (!alive) return;
      await new Promise(resolve => {
        const timeout = setTimeout(() => { child.kill(); resolve(); }, 5000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
        child.postMessage({ type: 'shutdown' });
      });
    }
  };
}
module.exports = { probeBackend, startBackend };
