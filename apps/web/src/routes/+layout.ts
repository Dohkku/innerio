// Local-first app: data lives on the device. SSR has nothing useful to
// render and breaks Triplit's IndexedDB storage init. Marketing pages
// can opt back in by overriding this in their own +page.ts.
export const ssr = false;

// Flag value bumped to '2' because the previous '1' version (inline module
// script in app.html, since reverted) could leave the flag set after a
// hung await without ever completing the clear. Forcing a fresh attempt.
const RESET_FLAG = 'innerio_audit_v2_idb_reset';
const RESET_FLAG_VALUE = '2';
const RESET_TIMEOUT_MS = 1500;

/**
 * Boot-time recovery: clear the local Triplit cache once after the audit
 * deploy regression. Runs on first navigation only (gated by a localStorage
 * flag). Sits in `+layout.ts` `load` so SvelteKit awaits this before the
 * layout renders any component — i.e. before any other module imports
 * Triplit and starts emitting from the cache.
 *
 * Defensive: capped by a short timeout. If `triplit.clear` hangs (rare —
 * usually only when another tab has the DB open with an active txn), we
 * still let the app boot. Worse-case the user keeps seeing a corrupt
 * cached row, which they can fix by closing other tabs and refreshing.
 */
export const load = async () => {
  if (typeof window === 'undefined') return {};
  try {
    if (localStorage.getItem(RESET_FLAG) === RESET_FLAG_VALUE) return {};
  } catch {
    return {};
  }
  try {
    const { triplit } = await import('$lib/triplit');
    await Promise.race([
      triplit.clear({ full: true }),
      new Promise((res) => setTimeout(res, RESET_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn('[boot] triplit cache reset failed (continuing)', err);
  }
  try {
    localStorage.setItem(RESET_FLAG, RESET_FLAG_VALUE);
  } catch {
    // localStorage write failed (private mode quota?). Don't loop —
    // the user will just resync from the server every load until the
    // flag sticks; functionally fine.
  }
  return {};
};
