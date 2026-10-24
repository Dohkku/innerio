/**
 * Theme store. Solo Día / Noche / Auto.
 *
 * Resides in localStorage as `gtd:appearance:theme`. The Svelte runtime
 * syncs `<html>` `data-theme`; the actual visual change happens in CSS
 * (see `lib/appearance/appearance.css`).
 *
 * FOUC: `app.html` runs an inline script that reads the same key BEFORE
 * first paint and applies the attribute. Si renombras la clave, hazlo
 * también en `app.html`.
 *
 * (2026-05-18: paletas built-in, custom palette y font picker fuera —
 *  tijera Musk 🟡. Reducción de ~1.3k LOC.)
 */

const KEY = 'gtd:appearance:theme';

export type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  let v = localStorage.getItem(KEY);
  // One-time migration from the old `gtd:theme` key.
  if (!v) {
    const legacy = localStorage.getItem('gtd:theme');
    if (legacy === 'light' || legacy === 'dark') {
      try {
        localStorage.setItem(KEY, legacy);
        localStorage.removeItem('gtd:theme');
      } catch {
        // non-fatal
      }
      v = legacy;
    }
  }
  // Default = light. 'system' es opcional, no fallback — el usuario tiene
  // que elegirlo explícitamente.
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'light';
}

function applyTheme(t: Theme): void {
  if (typeof document === 'undefined') return;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export const appearance = $state<{ theme: Theme }>({ theme: readTheme() });

if (typeof window !== 'undefined') {
  // Boot-time normalization. The inline FOUC script in app.html should have
  // already applied attrs, pero re-run para cubrir cambios cross-tab.
  applyTheme(appearance.theme);
}

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => unknown;
};

export function setTheme(next: Theme): void {
  const run = () => {
    appearance.theme = next;
    try {
      // Siempre persistimos la elección — incluyendo 'system'. Si lo
      // borráramos al elegir system, el default (light) lo sobreescribiría
      // en el siguiente reload.
      localStorage.setItem(KEY, next);
    } catch {
      // Quota / disabled — non-fatal.
    }
    applyTheme(next);
  };
  // View Transitions API: el browser snapshota antes/después y hace
  // crossfade global. Duración via CSS (`::view-transition-old/new(root)`).
  // Firefox / Safari estable → fallback a cambio instantáneo.
  const doc = typeof document !== 'undefined' ? (document as DocWithVT) : null;
  const start = doc?.startViewTransition;
  if (doc && start) {
    start.call(doc, run);
  } else {
    run();
  }
}
