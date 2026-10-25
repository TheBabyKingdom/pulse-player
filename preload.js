// Pulse – the small, safe bridge between the page and the desktop app.
// Only these four things are exposed; the page cannot touch the file system.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulse', {
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  openFolder: () => ipcRenderer.invoke('open-music-folder'),
  removeLocal: (file) => ipcRenderer.invoke('remove-local', file),
  info: () => fetch('/media-info').then(r => r.json())
});
