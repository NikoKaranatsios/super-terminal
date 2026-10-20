const { contextBridge, ipcRenderer } = require('electron');

// One-way, fixed menu actions. The renderer receives no filesystem or IPC access.
contextBridge.exposeInMainWorld('superTerminalDesktop', {
  platform: process.platform,
  onAction(callback) {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('desktop-action', listener);
    return () => ipcRenderer.removeListener('desktop-action', listener);
  }
});
