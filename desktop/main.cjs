const { app, BrowserWindow, Menu, dialog, nativeTheme, screen, utilityProcess, ipcMain, Notification } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { startBackend } = require('./backend.cjs');
const { watchActivity } = require('./notifications.cjs');

const root = path.resolve(__dirname, '..');
const dataDir = process.env.SUPER_TERMINAL_DATA || path.join(os.homedir(), '.super-terminal');
const port = Number(process.env.PORT || 4317);
app.setName('Super Terminal');
app.setPath('userData', path.join(dataDir, 'desktop'));
const primary = app.requestSingleInstanceLock();
const windows = new Set(), notifications = new Set();
let backend, watcher, quitting = false, allowQuit = false;
const windowFile = path.join(dataDir, 'desktop-window.json');
if (!primary) app.quit();
const currentWindow = () => BrowserWindow.getFocusedWindow() || [...windows].find(w => !w.isDestroyed());
function readBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowFile));
    if (!Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return {};
    const width = Math.min(3000, Math.max(800, saved.width)), height = Math.min(2200, Math.max(500, saved.height));
    if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return { width, height };
    const visible = screen.getAllDisplays().some(({ workArea: r }) => saved.x < r.x + r.width - 100 && saved.x + width > r.x + 100 && saved.y < r.y + r.height - 100 && saved.y + height > r.y + 100);
    return visible ? { x: saved.x, y: saved.y, width, height } : { width, height };
  } catch { return {}; }
}
function saveBounds(window) {
  if (!window || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(windowFile, JSON.stringify(window.getNormalBounds()), { mode: 0o600 });
  } catch {}
}
async function loginEnvironment() {
  const env = { ...process.env };
  const loginPath = await new Promise(resolve => {
    const shell = env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
    execFile(shell, ['-ilc', 'printf "\\n__SUPER_TERMINAL_PATH__%s" "$PATH"'], { timeout: 4000, maxBuffer: 128 * 1024, env }, (error, stdout) => resolve(error ? '' : stdout.split('__SUPER_TERMINAL_PATH__').at(-1)?.trim()));
  });
  env.PATH = [...new Set([loginPath, env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.grok/bin')].filter(Boolean))].join(':');
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
async function sendAction(action) {
  const window = currentWindow() || await createWindow();
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus(); window.webContents.send('desktop-action', action);
}
function notify(event) {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title: event.kind === 'test' ? 'Super Terminal notifications' : event.title || 'Conductor', body: event.kind === 'test' ? 'Conductor will choose which updates need your attention.' : event.text || '', silent: false });
  notifications.add(notification);
  notification.on('click', () => {
    if (!currentWindow()) createWindow({ view: event.target || 'activity', environment: event.host || 'local' });
    else sendAction(event.target ? { type: 'show-agent', id: event.target, host: event.host } : 'activity');
  });
  const release = () => notifications.delete(notification);
  notification.on('close', release); notification.on('failed', release);
  notification.show(); return true;
}
function trusted(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  try { const url = new URL(event.senderFrame.url); return windows.has(window) && event.senderFrame === event.sender.mainFrame && url.origin === backend.origin && url.pathname === '/'; }
  catch { return false; }
}
function setMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ label: 'Super Terminal', submenu: [{ role: 'about' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendAction('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow({ window: randomUUID(), view: 'conductor' }) },
      { label: 'New Terminal Tab', accelerator: 'CmdOrCtrl+T', click: () => sendAction('new-terminal') },
      { label: 'New Agent', submenu: ['codex', 'claude', 'grok'].map(provider => ({ label: provider, click: () => sendAction('new-agent:' + provider) })) },
      { type: 'separator' }, { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendAction('close-tab') },
      { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => currentWindow()?.close() },
      ...(!isMac ? [{ role: 'quit' }] : [])
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Split Right', accelerator: 'CmdOrCtrl+D', click: () => sendAction('split-right') },
      { label: 'Split Below', accelerator: 'CmdOrCtrl+Shift+D', click: () => sendAction('split-below') },
      { label: 'Next Panel', accelerator: 'CmdOrCtrl+]', click: () => sendAction('next-panel') },
      { type: 'separator' },
      { label: 'Conductor', accelerator: 'CmdOrCtrl+1', click: () => sendAction('conductor') },
      { label: 'Select Environment', accelerator: 'CmdOrCtrl+2', click: () => sendAction('environment') },
      { label: 'Activity', accelerator: 'CmdOrCtrl+3', click: () => sendAction('activity') },
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }
    ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Using Super Terminal', click: () => dialog.showMessageBox(currentWindow(), {
      type: 'info', title: 'Super Terminal', message: 'Your terminals and Conductor.',
      detail: 'Use Split Right or Split Below to see several terminals. Click a panel, then choose an agent from the sidebar. Drag any divider to resize; double-click to restore equal sizes. New Window opens the selected tab in a separate window.\n\nActivity keeps agent completion alerts. Settings controls notifications, text size and startup prompts.\n\nClosing a tab or window detaches its screen. Quitting stops the local service; tmux terminals survive and reconnect next time.'
    }) }] }
  ]));
}
async function createWindow(context = {}) {
  if (!backend || quitting) return;
  const window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 800, minHeight: 500, ...readBounds(),
    title: 'Super Terminal', backgroundColor: '#101214', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, spellcheck: false
    }
  });
  windows.add(window);
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const localPage = value => { try { const url = new URL(value); return url.origin === backend.origin && url.pathname === '/' && !url.search; } catch { return false; } };
  contents.on('will-navigate', (event, url) => { if (!localPage(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!localPage(url)) event.preventDefault(); });
  // The Electron session is shared; accept clipboard requests from any of our own windows.
  const canWriteClipboard = (requester, permission, url) => {
    try { return windows.has(BrowserWindow.fromWebContents(requester)) && permission === 'clipboard-sanitized-write' && new URL(url).origin === backend.origin; }
    catch { return false; }
  };
  contents.session.setPermissionRequestHandler((requester, permission, callback, details) => callback(canWriteClipboard(requester, permission, details.requestingUrl)));
  contents.session.setPermissionCheckHandler((requester, permission, origin) => canWriteClipboard(requester, permission, origin));
  if (!contents.session.superTerminalDownloadsBlocked) { contents.session.on('will-download', event => event.preventDefault()); contents.session.superTerminalDownloadsBlocked = true; }
  window.on('close', () => saveBounds(window));
  window.on('closed', () => windows.delete(window));
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
  const hash = new URLSearchParams(context).toString();
  await window.loadURL(backend.origin + '/' + (hash ? '#' + hash : ''));
  return window;
}
app.on('second-instance', () => { const window = currentWindow(); if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else createWindow(); });
app.on('activate', () => { if (!windows.size) createWindow(); else currentWindow()?.show(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (allowQuit || !primary) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true; saveBounds(currentWindow()); watcher?.stop();
  Promise.resolve(backend?.stop()).finally(() => { allowQuit = true; app.quit(); });
});
if (primary) app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  app.setAboutPanelOptions({ applicationName: 'Super Terminal', applicationVersion: app.getVersion(), copyright: 'Local agent workspace' });
  try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
    backend = await startBackend({ utilityProcess, root, port, dataDir, env: await loginEnvironment(), onExit: async () => {
      if (quitting) return;
      const result = await dialog.showMessageBox(currentWindow(), { type: 'error', message: 'The local service stopped.', detail: 'Your tmux terminals are still running. Restart Super Terminal to reconnect.', buttons: ['Restart app', 'Quit'] });
      if (result.response === 0) app.relaunch();
      app.quit();
    } });
    ipcMain.on('desktop-open-window', (event, context) => {
      if (!trusted(event) || typeof context?.viewId !== 'string' || context.viewId.length > 600 || typeof context.environment !== 'string' || context.environment.length > 300) return;
      createWindow({ window: randomUUID(), view: context.viewId, environment: context.environment });
    });
    ipcMain.handle('desktop-test-notification', event => trusted(event) && notify({ kind: 'test' }));
    watcher = watchActivity({ origin: backend.origin, deliver: notify });
    setMenu(); await createWindow();
  } catch (error) { dialog.showErrorBox('Super Terminal could not start', error.message); app.quit(); }
});
