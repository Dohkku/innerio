// Apply persisted theme synchronously to avoid FOUC. Loaded as a file (not
// inline) so the CSP can drop 'unsafe-inline' for scripts (security review
// 2026-10-24). Mirrors $lib/stores/appearance.svelte.ts; si cambias la clave
// aquí, cámbiala allí también.
(function () {
  try {
    var d = document.documentElement;
    // Migration: prior versions stored theme under `gtd:theme`.
    var t = localStorage.getItem('gtd:appearance:theme') || localStorage.getItem('gtd:theme');
    if (t === 'light' || t === 'dark') d.dataset.theme = t;
  } catch (_e) {}
})();
