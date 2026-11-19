import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import os from 'node:os';
const dataDir = process.env.SUPER_TERMINAL_DATA || path.join(os.homedir(), '.super-terminal');

export class AgentBrowsers {
  contexts = new Map();
  pending = new Map();
  queues = new Map();
  closing = false;
  constructor({ launch = (...args) => chromium.launchPersistentContext(...args), root = dataDir, controlPort = Number(process.env.PORT || 4317), launchOptions = {} } = {}) {
    this.launch = launch; this.root = root; this.controlPort = controlPort; this.launchOptions = launchOptions;
  }
  async get(id) {
    if (this.closing) throw new Error("Browsers are shutting down.");
    if (this.contexts.has(id)) return this.contexts.get(id);
    if (this.pending.has(id)) return this.pending.get(id);
    const create = (async () => {
      const candidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
      const executablePath = process.env.SUPER_TERMINAL_BROWSER || candidates.find(p => fs.existsSync(p));
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid browser session.');
      const dir = path.join(this.root, 'browsers', id);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      let context;
      try { context = await this.launch(dir, {
        executablePath, headless: true, chromiumSandbox: true,
        viewport: { width: 1360, height: 900 }, acceptDownloads: false, serviceWorkers: 'block', ...this.launchOptions
      }); } catch (error) { throw new Error('Could not start the agent browser. Install Chrome or set SUPER_TERMINAL_BROWSER to a working Chromium executable. ' + error.message); }
      try {
      // A mailbox credential must not become a dashboard credential by browsing
      // the dashboard's bootstrap page. Local development on other ports works.
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        const destinationPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        // Playwright routes only the first hop of an HTTP redirect. This marker
        // persists across redirects and the control service rejects it before
        // serving bootstrap credentials, including popup navigations.
        return !['http:', 'https:'].includes(url.protocol) || destinationPort === this.controlPort ? route.abort('accessdenied') : route.continue({headers:{...route.request().headers(),'x-super-terminal-browser':'1'}});
      });
      await context.routeWebSocket(url => Number(url.port || (url.protocol === 'wss:' ? 443 : 80)) === this.controlPort,
        socket => socket.close({ code: 1008, reason: 'Agent browsers cannot access the control service.' }));
      context.setDefaultTimeout(12000);
      const page = context.pages()[0] || await context.newPage();
      const session = { context, page, id };
      this.contexts.set(id, session);
      const track = next => {
        session.page = next;
        next.on('close', () => { if (session.page === next) session.page = context.pages().filter(p => !p.isClosed()).at(-1) || null; });
      };
      track(page); context.on('page', track);
      context.on('close', () => { if (this.contexts.get(id) === session) this.contexts.delete(id); });
      return session;
      } catch (error) { await context.close().catch(() => {}); throw error; }
    })();
    this.pending.set(id, create);
    try { return await create; } finally { this.pending.delete(id); }
  }
  action(id, input) {
    if (this.closing) return Promise.reject(new Error('Browsers are shutting down.'));
    const result = (this.queues.get(id) || Promise.resolve()).catch(() => {}).then(() => this.perform(id, input));
    this.queues.set(id, result);
    result.finally(() => { if (this.queues.get(id) === result) this.queues.delete(id); }).catch(() => {});
    return result;
  }
  async perform(id, input) {
    if (input.action === 'close') {
      // A launch may still be in flight when the user closes this session.
      await this.pending.get(id)?.catch(() => {});
      await this.contexts.get(id)?.context.close();
      return { ok: true };
    }
    const session = await this.get(id);
    if (!session.page || session.page.isClosed()) session.page = session.context.pages().find(p => !p.isClosed()) || await session.context.newPage();
    const { page } = session;
    switch (input.action) {
      case 'open': {
        const url = new URL(input.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http or https URL.');
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      }
      case 'click': await page.locator(input.selector).first().click(); break;
      case 'fill': await page.locator(input.selector).first().fill(String(input.text || '')); break;
      case 'press': await page.keyboard.press(String(input.key || 'Enter')); break;
      case 'scroll': await page.mouse.wheel(0, 700); break;
      case 'screenshot': return { url: page.url(), image: (await page.screenshot()).toString('base64') };
      case 'snapshot': break;
      default: throw new Error('Unknown browser action.');
    }
    const current = session.page;
    if (!current || current.isClosed()) throw new Error('The browser page closed. Open a URL to continue.');
    await current.waitForLoadState('domcontentloaded');
    const destination=new URL(current.url());
    if(Number(destination.port || (destination.protocol==='https:'?443:80))===this.controlPort)throw new Error('Agent browsers cannot access the control service, including through redirects.');
    return {
      url: current.url(), title: await current.title(),
      snapshot: (await current.locator('body').ariaSnapshot()).slice(0, 18000),
      hint: 'Use Playwright selectors: getByRole-equivalent CSS such as role=button[name="Submit"], text=Continue, or #id. Each session owns this browser.'
    };
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.queues.values()]);
    await Promise.allSettled([...this.pending.values()]);
    await Promise.allSettled([...this.contexts.values()].map(s => s.context.close()));
  }
}
