import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { dataDir } from './core.mjs';

export class AgentBrowsers {
  contexts = new Map();
  pending = new Map();
  async get(id) {
    if (this.contexts.has(id)) return this.contexts.get(id);
    if (this.pending.has(id)) return this.pending.get(id);
    const create = (async () => {
      const candidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
      const executablePath = process.env.SUPER_TERMINAL_BROWSER || candidates.find(p => fs.existsSync(p));
      const dir = path.join(dataDir, 'browsers', id);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const context = await chromium.launchPersistentContext(dir, {
        executablePath, headless: true, chromiumSandbox: true,
        viewport: { width: 1360, height: 900 }, acceptDownloads: false, serviceWorkers: 'block'
      });
      // A mailbox credential must not become a dashboard credential by browsing
      // the dashboard's bootstrap page. Local development on other ports works.
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        const destinationPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        return destinationPort === Number(process.env.PORT || 4317) ? route.abort('accessdenied') : route.continue();
      });
      context.setDefaultTimeout(12000);
      const page = context.pages()[0] || await context.newPage();
      const session = { context, page, id };
      this.contexts.set(id, session);
      context.on('page', next => { session.page = next; });
      context.on('close', () => this.contexts.delete(id));
      return session;
    })();
    this.pending.set(id, create);
    try { return await create; } finally { this.pending.delete(id); }
  }
  async action(id, input) {
    if (input.action === 'close') {
      await this.contexts.get(id)?.context.close();
      return { ok: true };
    }
    const { page } = await this.get(id);
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
    return {
      url: page.url(), title: await page.title(),
      snapshot: (await page.locator('body').ariaSnapshot()).slice(0, 18000),
      hint: 'Use Playwright selectors: getByRole-equivalent CSS such as role=button[name="Submit"], text=Continue, or #id. Each session owns this browser.'
    };
  }
  async close() { await Promise.allSettled([...this.contexts.values()].map(s => s.context.close())); }
}
