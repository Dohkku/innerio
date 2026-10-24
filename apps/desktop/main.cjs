// Innerio desktop shell (Electron). Same idea as apps/mobile: the static
// build of apps/web travels inside the app, no remote URL.
//
// The build is served from a privileged custom scheme, `app://innerio`.
// Requests to the sync server leave straight from Chromium, so they carry
// the real Origin and the session cookie; the server allowlists this
// origin next to the Capacitor ones (ADR-039). Intercepting https and
// faking https://localhost was tried first: the main-process proxy drops
// Origin and cookies, which breaks login.
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, protocol, shell } = require('electron');
const { iniciarActualizaciones } = require('./actualizar.cjs');

// User data in ~/.config/Innerio. Without this Electron derives the folder
// from package.json's "name" (@gtd/desktop). 1.0.0 used that path, so its
// folder is moved over once (local data and session survive the update).
app.setName('Innerio');
if (process.env.INNERIO_USERDATA) {
  // Isolated profile for test harnesses and the landing's clip recorder.
  app.setPath('userData', process.env.INNERIO_USERDATA);
} else {
  const appData = app.getPath('appData');
  const nueva = path.join(appData, 'Innerio');
  const vieja = path.join(appData, '@gtd', 'desktop');
  if (!fs.existsSync(nueva) && fs.existsSync(vieja)) {
    try {
      fs.renameSync(vieja, nueva);
    } catch {
      // Falls back to a fresh profile; the old folder stays untouched.
    }
  }
  app.setPath('userData', nueva);
}

const APP_ORIGIN = 'app://innerio';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, '..', 'web', 'build');
const ICON = path.join(__dirname, 'icon.png');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

// Same policy as the web app's Vercel headers, plus the auth origin the
// desktop talks to. The build's own <meta> CSP narrows scripts further to
// hashes (security review 2026-10-24, B-2).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://app.innerio.frederickandrade.com https://innerio-api.dohkku.dev wss://innerio-api.dohkku.dev http://127.0.0.1:11434",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function serveLocal(url) {
  const rel = decodeURIComponent(url.pathname);
  let file = path.normalize(path.join(WEB_ROOT, rel));
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) {
    return new Response('forbidden', { status: 403 });
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // SPA fallback, same as adapter-static's `fallback: 'index.html'`.
    file = path.join(WEB_ROOT, 'index.html');
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return new Response(fs.readFileSync(file), {
    headers: { 'content-type': type, 'content-security-policy': CSP },
  });
}

// Only web and mail links leave the app; file:, smb: and friends would hand
// the OS whatever a page asked for (security review 2026-10-24, B-1).
function abrirFuera(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') {
      void shell.openExternal(url);
    }
  } catch {
    // Malformed URL: ignore.
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 420,
    minHeight: 500,
    title: 'Innerio',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#1b1d1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Read by preload.cjs so Settings shows the desktop version.
      additionalArguments: [`--innerio-version=${app.getVersion()}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();

  // Anything that isn't the app (mailto:, links to other sites) opens in
  // the system handler instead of a second Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    abrirFuera(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) {
      e.preventDefault();
      abrirFuera(url);
    }
  });

  void win.loadURL(`${APP_ORIGIN}/`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', (req) => serveLocal(new URL(req.url)));
    iniciarActualizaciones(createWindow());
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
