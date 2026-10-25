// Pulse – the small, safe bridge between the page and the desktop app.
// Only these calls are exposed; the page cannot touch the file system directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulse', {
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  pickBackground: () => ipcRenderer.invoke('pick-background'),
  openFolder: (which) => ipcRenderer.invoke('open-folder', which),
  removeLocal: (file) => ipcRenderer.invoke('remove-local', file),
  deleteBackground: (file) => ipcRenderer.invoke('delete-background', file),
  info: () => fetch('/media-info').then(r => r.json())
});
