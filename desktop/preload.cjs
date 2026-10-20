const { contextBridge, ipcRenderer } = require('electron');

// Narrow desktop actions only. No filesystem or arbitrary IPC access.
contextBridge.exposeInMainWorld('superTerminalDesktop', {
  platform: process.platform,
  openWindow(context) { ipcRenderer.send('desktop-open-window', context); },
  testNotification() { return ipcRenderer.invoke('desktop-test-notification'); },
  onAction(callback) {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('desktop-action', listener);
    return () => ipcRenderer.removeListener('desktop-action', listener);
  }
});
