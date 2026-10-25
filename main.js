// Pulse – desktop shell.
// Serves the app from a small local web server (the official YouTube and
// SoundCloud players refuse file:// pages) and handles local MP3 files:
// picking them, copying them into the app's own storage, and playing them.
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 47821; // fixed so your saved library survives restarts
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'
};

const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.flac', '.opus'];

let musicDir = '';   // where copied files live

function fileServer() {
  return new Promise((resolve, reject) => {
    const root = __dirname;
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);

      // Copied local music is served from a second, separate root.
      if (p.startsWith('/music/')) {
        const name = path.basename(p);
        const file = path.join(musicDir, name);
        return streamFile(req, res, file);
      }

      if (p === '/media-info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ musicDir: musicDir.replace(/\\/g, '/') }));
      }

      if (p === '/') p = '/index.html';
      const file = path.join(root, path.normalize(p));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      streamFile(req, res, file);
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve());
  });
}

// Range requests matter: without them the player cannot seek inside a file.
function streamFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

// ---- file picker + copy ----
ipcMain.handle('pick-audio', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const r = await dialog.showOpenDialog(win, {
    title: 'Add audio files',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXT.map(e => e.slice(1)) }]
  });
  if (r.canceled || !r.filePaths.length) return { added: [], skipped: [] };

  const added = [], skipped = [];
  for (const src of r.filePaths) {
    const ext = path.extname(src).toLowerCase();
    if (!AUDIO_EXT.includes(ext)) { skipped.push(path.basename(src)); continue; }
    const base = path.basename(src);
    let dest = path.join(musicDir, base);
    // never overwrite an existing copy
    if (fs.existsSync(dest)) {
      const stem = path.basename(base, ext);
      let n = 2;
      while (fs.existsSync(dest)) dest = path.join(musicDir, `${stem} (${n++})${ext}`);
    }
    try {
      await fs.promises.copyFile(src, dest);
      added.push({ name: path.basename(dest), file: path.basename(dest), ext });
    } catch { skipped.push(base); }
  }
  return { added, skipped };
});

ipcMain.handle('open-music-folder', async () => {
  await shell.openPath(musicDir);
  return true;
});

ipcMain.handle('remove-local', async (_e, file) => {
  const target = path.join(musicDir, path.basename(String(file)));
  try { await fs.promises.unlink(target); return true; } catch { return false; }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    title: 'Pulse',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://127.0.0.1:${PORT}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(async () => {
    musicDir = path.join(app.getPath('userData'), 'music');
    await fs.promises.mkdir(musicDir, { recursive: true });
    await fileServer();
    createWindow();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
