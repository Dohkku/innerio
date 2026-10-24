/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * Service worker for the installable web app (PWA). Its only job is to let
 * Innerio open without a network: the data already lives in IndexedDB
 * (Triplit), so caching the app shell is enough.
 *
 * - Build assets (hashed, immutable) and static files: cache-first.
 * - Navigations: network-first, falling back to the cached SPA shell, so a
 *   new deploy is picked up as soon as there is a connection.
 * - Never touches /api, /email, non-GET requests or other origins: auth,
 *   sync and the Vercel proxy always go to the network.
 *
 * Registered manually from +layout.svelte and only in a real browser
 * (Electron's app:// and Capacitor ship the build inside the app already).
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `innerio-${version}`;
const SHELL = '/';
const ASSETS = [
  ...build,
  ...files.filter((f) => !f.endsWith('vercel.json') && !f.endsWith('_headers')),
];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([SHELL, ...ASSETS]);
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/email/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          await cache.put(SHELL, fresh.clone());
          return fresh;
        } catch {
          return (await caches.match(SHELL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (ASSETS.includes(url.pathname)) {
    event.respondWith((async () => (await caches.match(url.pathname)) ?? fetch(req))());
  }
});
