// Self-update for the Linux desktop app (ADR-040).
//
// The landing publishes https://innerio.frederickandrade.com/version.json:
//   { "version": "1.0.1", "paquetes": { "linux": { "url": "...tar.xz", "sha256": "..." } } }
// On start (and every 6 h) we compare it with app.getVersion(). If there is a
// newer one we ask; on yes we download next to the install dir, check the
// sha256, unpack, swap the folders and relaunch. Linux keeps the running
// binary alive through the rename, so the swap is safe while we run.
//
// Only runs when packaged and installed in a folder we can write to (the
// one install.sh uses, ~/.local/share/innerio). Dev runs and read-only
// installs never touch anything.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { app, dialog, net, shell } = require('electron');

const VERSION_URL = 'https://innerio.frederickandrade.com/version.json';
const WEB = 'https://innerio.frederickandrade.com/novedades/';
const CADA = 6 * 60 * 60 * 1000;

// version.json is signed (security review 2026-10-24, M-2). Taking over the
// landing (Vercel or its repo) is not enough to push code to installed apps:
// the release must be signed with the private key that only lives on the
// maintainer's machine (~/Documents/Claves/innerio-actualizaciones.pem, see
// scripts/release-desktop.sh). Packages can only come from our own server.
const CLAVE_PUBLICA = crypto.createPublicKey({
  key: Buffer.from('MCowBQYDK2VwAyEAf+GZo395tPr7/cC9zO5+yyyqgbRt3oAsrSSFVNl+fpc=', 'base64'),
  format: 'der',
  type: 'spki',
});
const DESCARGAS = 'https://innerio-api.dohkku.dev/descargas/';

function firmaValida(version, paquete) {
  try {
    if (typeof paquete.firma !== 'string' || !paquete.url.startsWith(DESCARGAS)) return false;
    if (!/^[0-9a-f]{64}$/.test(paquete.sha256)) return false;
    const mensaje = Buffer.from(`innerio-linux\n${version}\n${paquete.url}\n${paquete.sha256}`);
    return crypto.verify(null, mensaje, CLAVE_PUBLICA, Buffer.from(paquete.firma, 'base64'));
  } catch {
    return false;
  }
}

function mayor(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function instalacion() {
  if (!app.isPackaged || process.platform !== 'linux') return null;
  const dir = path.dirname(process.execPath);
  const padre = path.dirname(dir);
  try {
    fs.accessSync(padre, fs.constants.W_OK);
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return null;
  }
  return { dir, padre, nombre: path.basename(dir) };
}

// Leftover from the previous update, removed on the next start.
function limpiar(inst) {
  fs.rmSync(path.join(inst.padre, `${inst.nombre}.anterior`), { recursive: true, force: true });
  fs.rmSync(path.join(inst.padre, `${inst.nombre}.nueva`), { recursive: true, force: true });
  fs.rmSync(path.join(inst.padre, `.${inst.nombre}-actualizacion.tar.xz`), { force: true });
}

async function descargar(url, destino, win) {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(destino);
  let hecho = 0;
  const lector = res.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    hash.update(value);
    hecho += value.length;
    if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    if (total && win && !win.isDestroyed()) win.setProgressBar(hecho / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  return hash.digest('hex');
}

function tar(args) {
  return new Promise((resolve, reject) =>
    execFile('tar', args, (err, _o, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(),
    ),
  );
}

async function instalar(inst, paquete, win) {
  const tmp = path.join(inst.padre, `.${inst.nombre}-actualizacion.tar.xz`);
  const nueva = path.join(inst.padre, `${inst.nombre}.nueva`);
  const anterior = path.join(inst.padre, `${inst.nombre}.anterior`);
  limpiar(inst);
  try {
    const sha = await descargar(paquete.url, tmp, win);
    if (sha !== paquete.sha256) throw new Error('la descarga no coincide con la firma publicada');
    fs.mkdirSync(nueva);
    await tar(['-xJf', tmp, '-C', nueva]);
    if (!fs.existsSync(path.join(nueva, path.basename(process.execPath)))) {
      throw new Error('el paquete no trae el ejecutable');
    }
    fs.renameSync(inst.dir, anterior);
    fs.renameSync(nueva, inst.dir);
    fs.rmSync(tmp, { force: true });
  } finally {
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }
  app.relaunch({ execPath: process.execPath, args: process.argv.slice(1) });
  app.exit(0);
}

let preguntado = null;

async function comprobar(win) {
  const inst = instalacion();
  if (!inst) return;
  let info;
  try {
    const res = await net.fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return;
    info = await res.json();
  } catch {
    return; // Sin red: ya se mirará más tarde.
  }
  const paquete = info?.paquetes?.linux;
  if (!info?.version || !paquete?.url || !paquete?.sha256) return;
  if (!firmaValida(info.version, paquete)) return;
  if (!mayor(info.version, app.getVersion()) || preguntado === info.version) return;
  preguntado = info.version;

  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Innerio',
    message: `Hay una versión nueva de Innerio (${info.version})`,
    detail: `Tienes la ${app.getVersion()}. Se descarga, se instala y la app se reinicia sola. Tus tareas no se tocan.`,
    buttons: ['Actualizar ahora', 'Ver qué cambia', 'Más tarde'],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 1) {
    void shell.openExternal(WEB);
    preguntado = null;
    return;
  }
  if (response !== 0) return;
  try {
    await instalar(inst, paquete, win);
  } catch (err) {
    await dialog
      .showMessageBox(win, {
        type: 'error',
        title: 'Innerio',
        message: 'No se pudo actualizar',
        detail: `${err.message}. Puedes instalar la versión nueva desde la web, con el mismo comando de siempre.`,
        buttons: ['Abrir la web', 'Cerrar'],
      })
      .then(
        ({ response: r }) =>
          r === 0 && shell.openExternal('https://innerio.frederickandrade.com/#descargar'),
      );
  }
}

function iniciarActualizaciones(win) {
  const inst = instalacion();
  if (!inst) return;
  limpiar(inst);
  setTimeout(() => void comprobar(win), 8000);
  setInterval(() => void comprobar(win), CADA);
}

module.exports = { iniciarActualizaciones, mayor, instalar, firmaValida };
