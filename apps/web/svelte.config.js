import { execSync } from 'node:child_process';
import adapter from '@sveltejs/adapter-static';

// Build-time version: total commit count + short SHA.
// SvelteKit emite `_app/version.json` con este string; el store `updated`
// lo compara cada `pollInterval` ms con la versión cargada en memoria.
// Cloudflare Pages ejecuta el build con git presente, así que el helper
// resuelve correctamente; en sandboxes sin git devolvemos 'dev'.
function getVersion() {
  try {
    const count = execSync('git rev-list --count HEAD').toString().trim();
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    return `${count}-${sha}`;
  } catch {
    return 'dev';
  }
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
    runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
  },
  kit: {
    // SPA mode: all routes resolved client-side. `index.html` is what
    // Cloudflare Pages serves by default for any unmatched path. Works because
    // the app sets `ssr=false` in +layout.ts, so nothing pre-renders.
    adapter: adapter({ fallback: 'index.html' }),
    // Hash-based CSP in a <meta> for SvelteKit's own inline bootstrap, so
    // scripts don't need 'unsafe-inline'. The hosting header CSP (Vercel,
    // desktop app://) still allows it, but browsers enforce both policies and
    // this one is stricter (security review 2026-10-24).
    // Registered by hand in $lib/pwa.svelte.ts, only in real browsers.
    serviceWorker: { register: false },
    csp: {
      mode: 'hash',
      directives: { 'script-src': ['self'] },
    },
    version: {
      name: getVersion(),
      pollInterval: 5 * 60 * 1000,
    },
  },
};

export default config;
