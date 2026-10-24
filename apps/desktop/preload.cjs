// Minimal bridge for the web app. Read by apps/web/src/lib/platform.ts.
const { contextBridge } = require('electron');

const version =
  (process.argv.find((a) => a.startsWith('--innerio-version=')) ?? '').split('=')[1] ?? '';

contextBridge.exposeInMainWorld('innerioDesktop', {
  version,
});
