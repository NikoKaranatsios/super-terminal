// One watcher in the main process, shared by every window, including when all are closed.
function watchActivity({ origin, deliver, fetcher = fetch, interval = 3000 }) {
  let token, initialized = false, stopped = false, busy = false;
  const seen = new Set();
  async function poll() {
    if (busy || stopped) return; busy = true;
    try {
      if (!token) {
        const html = await (await fetcher(origin + '/', { signal: AbortSignal.timeout(4000) })).text();
        token = html.match(/name="super-terminal-token" content="([^"]+)"/)?.[1];
        if (!token) return;
      }
      const response = await fetcher(origin + '/api/activity', { headers: { 'X-Super-Terminal': token }, signal: AbortSignal.timeout(4000) });
      if (!response.ok) { token = null; return; }
      const { events, enabled } = await response.json();
      if (stopped) return;
      for (const event of events) {
        if (initialized && !seen.has(event.id) && enabled) deliver(event);
        seen.add(event.id);
      }
      initialized = true;
      if (seen.size > 1000) { seen.clear(); for (const event of events) seen.add(event.id); }
    } catch { /* Reconnect on the next poll; never turn network errors into completion. */ }
    finally { busy = false; }
  }
  const timer = setInterval(poll, interval); timer.unref?.(); poll();
  return { poll, stop() { stopped = true; clearInterval(timer); } };
}
module.exports = { watchActivity };
