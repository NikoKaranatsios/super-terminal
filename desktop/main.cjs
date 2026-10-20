const { app, BrowserWindow, Menu, dialog, nativeTheme, screen, utilityProcess } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { startBackend } = require('./backend.cjs');

const root = path.resolve(__dirname, '..');
const dataDir = process.env.SUPER_TERMINAL_DATA || path.join(os.homedir(), '.super-terminal');
const port = Number(process.env.PORT || 4317);
app.setName('Super Terminal');
app.setPath('userData', path.join(dataDir, 'desktop'));
const primary = app.requestSingleInstanceLock();
let window, backend, quitting = false, allowQuit = false;
const windowFile = path.join(dataDir, 'desktop-window.json');
if (!primary) app.quit();

function readBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowFile));
    if (!Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return {};
    const width = Math.min(3000, Math.max(960, saved.width)), height = Math.min(2200, Math.max(640, saved.height));
    if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return { width, height };
    const visible = screen.getAllDisplays().some(({ workArea: r }) => saved.x < r.x + r.width - 100 && saved.x + width > r.x + 100 && saved.y < r.y + r.height - 100 && saved.y + height > r.y + 100);
    return visible ? { x: saved.x, y: saved.y, width, height } : { width, height };
  } catch { return {}; }
}
function saveBounds() {
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
function sendAction(action) {
  if (!window || window.isDestroyed()) createWindow().then(() => window.webContents.send('desktop-action', action));
  else { window.show(); window.focus(); window.webContents.send('desktop-action', action); }
}
function setMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ label: 'Super Terminal', submenu: [{ role: 'about' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendAction('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'New Terminal', accelerator: 'CmdOrCtrl+N', click: () => sendAction('new-terminal') },
      { label: 'New Agent', submenu: ['codex', 'claude', 'grok'].map(provider => ({ label: provider, click: () => sendAction('new-agent:' + provider) })) },
      { type: 'separator' }, { role: isMac ? 'close' : 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Conductor', accelerator: 'CmdOrCtrl+1', click: () => sendAction('conductor') },
      { label: 'Select Environment', accelerator: 'CmdOrCtrl+2', click: () => sendAction('environment') },
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }
    ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Using Super Terminal', click: () => dialog.showMessageBox(window, {
      type: 'info', title: 'Super Terminal', message: 'Your terminals and Conductor.',
      detail: 'Choose an environment, then select a terminal. New terminals and agents open in the selected environment. Conductor reads saved conversations across all three locations.\n\nClosing the window keeps the app and mailboxes running. Quitting stops the local service; tmux terminals survive and reconnect next time.\n\nPreferences and chat stay in ~/.super-terminal. AI requests use your existing agent CLI accounts.'
    }) }] }
  ]));
}
async function createWindow() {
  if (!backend || quitting) return;
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 960, minHeight: 640, ...readBounds(),
    title: 'Super Terminal', backgroundColor: '#161616', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, spellcheck: false
    }
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (url !== backend.origin + '/') event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (url !== backend.origin + '/') event.preventDefault(); });
  const canWriteClipboard = (requester, permission, url) => {
    try { return requester?.id === contents.id && permission === 'clipboard-sanitized-write' && new URL(url).origin === backend.origin; }
    catch { return false; }
  };
  contents.session.setPermissionRequestHandler((requester, permission, callback, details) => callback(canWriteClipboard(requester, permission, details.requestingUrl)));
  contents.session.setPermissionCheckHandler((requester, permission, origin) => canWriteClipboard(requester, permission, origin));
  contents.session.on('will-download', event => event.preventDefault());
  window.on('close', saveBounds);
  window.on('closed', () => { window = null; });
  window.once('ready-to-show', () => { window?.show(); });
  await window.loadURL(backend.origin + '/');
}

app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); createWindow(); });
app.on('activate', () => createWindow());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (allowQuit || !primary) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true; saveBounds();
  Promise.resolve(backend?.stop()).finally(() => { allowQuit = true; app.quit(); });
});
if (primary) app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  app.setAboutPanelOptions({ applicationName: 'Super Terminal', applicationVersion: app.getVersion(), copyright: 'Local agent workspace' });
  try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
    backend = await startBackend({ utilityProcess, root, port, dataDir, env: await loginEnvironment(), onExit: async () => {
      if (quitting) return;
      const result = await dialog.showMessageBox(window, { type: 'error', message: 'The local service stopped.', detail: 'Your tmux terminals are still running. Restart Super Terminal to reconnect.', buttons: ['Restart app', 'Quit'] });
      if (result.response === 0) app.relaunch();
      app.quit();
    } });
    setMenu(); await createWindow();
  } catch (error) { dialog.showErrorBox('Super Terminal could not start', error.message); app.quit(); }
});
