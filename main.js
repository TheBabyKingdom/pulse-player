// Pulse – desktop shell.
// Serves the app from a local web server and handles files from the user's PC:
// audio to play, and background images / videos / GIFs.
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 47821;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/opus',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg'
};

const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.flac', '.opus'];
const BACK_EXT  = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.ogv'];

let musicDir = '';
let backDir = '';

function serve() {
  return new Promise((resolve, reject) => {
    const root = __dirname;
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);

      if (p.startsWith('/music/')) {
        return stream(req, res, path.join(musicDir, path.basename(p)));
      }
      if (p.startsWith('/backdrop/')) {
        return stream(req, res, path.join(backDir, path.basename(p)));
      }
      if (p === '/media-info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          musicDir: musicDir.replace(/\\/g, '/'),
          backDir: backDir.replace(/\\/g, '/')
        }));
      }
      if (p === '/') p = '/index.html';
      const file = path.join(root, path.normalize(p));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      stream(req, res, file);
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve());
  });
}

// Range requests matter: without them the player and background video cannot seek.
function stream(req, res, file) {
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
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': end - start + 1
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

async function copyIn(list, dir, extOk) {
  const added = [], skipped = [];
  for (const src of list) {
    const ext = path.extname(src).toLowerCase();
    if (!extOk.includes(ext)) { skipped.push(path.basename(src)); continue; }
    const base = path.basename(src);
    let dest = path.join(dir, base);
    if (fs.existsSync(dest)) {
      const stem = path.basename(base, ext);
      let n = 2;
      while (fs.existsSync(dest)) dest = path.join(dir, `${stem} (${n++})${ext}`);
    }
    try { await fs.promises.copyFile(src, dest); added.push({ name: path.basename(dest), file: path.basename(dest) }); }
    catch { skipped.push(base); }
  }
  return { added, skipped };
}

ipcMain.handle('pick-audio', async () => {
  const r = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], {
    title: 'Add audio files', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXT.map(e => e.slice(1)) }]
  });
  if (r.canceled || !r.filePaths.length) return { added: [], skipped: [] };
  return copyIn(r.filePaths, musicDir, AUDIO_EXT);
});

ipcMain.handle('pick-background', async () => {
  const r = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], {
    title: 'Choose a background', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images, GIFs and video', extensions: BACK_EXT.map(e => e.slice(1)) }]
  });
  if (r.canceled || !r.filePaths.length) return { added: [], skipped: [] };
  return copyIn(r.filePaths, backDir, BACK_EXT);
});

ipcMain.handle('open-folder', async (_e, which) => {
  await shell.openPath(which === 'back' ? backDir : musicDir);
  return true;
});
ipcMain.handle('remove-local', async (_e, file) => {
  try { await fs.promises.unlink(path.join(musicDir, path.basename(String(file)))); return true; }
  catch { return false; }
});
ipcMain.handle('delete-background', async (_e, file) => {
  try { await fs.promises.unlink(path.join(backDir, path.basename(String(file)))); return true; }
  catch { return false; }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 980, minHeight: 640,
    backgroundColor: '#0a0a0a', title: 'Pulse', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
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
    backDir = path.join(app.getPath('userData'), 'backgrounds');
    await fs.promises.mkdir(musicDir, { recursive: true });
    await fs.promises.mkdir(backDir, { recursive: true });
    await serve();
    createWindow();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
