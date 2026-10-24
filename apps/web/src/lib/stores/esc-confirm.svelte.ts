/**
 * Double-tap Esc confirmation. Prevents accidental loss of work in long-form
 * flows like /process and the Detalles panel. The pattern:
 *
 *   1st Esc (if input focused) → blur the input + arm + show inline hint.
 *   1st Esc (no input)         → arm + show inline hint.
 *   2nd Esc within 2.5s        → fire the action.
 *
 * Arm decays automatically after 2.5s, on any mouse click, or when the user
 * focuses an editable element again (interpreted as "I want to keep working").
 *
 * Each call site passes the action + a contextual message ("(dos veces para
 * salir)", "(dos veces para volver)"). The page renders `escToast.message`
 * inline next to its BackButton — there is no floating fallback.
 */

const TIMEOUT_MS = 2500;

type Armed = { action: () => void; expiresAt: number };

let armed: Armed | null = null;
let listenersAttached = false;
let timeoutId: number | undefined;

export const escToast = $state<{ message: string | null }>({
  message: null,
});

function clearArm(): void {
  armed = null;
  escToast.message = null;
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    timeoutId = undefined;
  }
}

function onMouseDown(): void {
  clearArm();
}

function onFocusIn(e: FocusEvent): void {
  const t = e.target as HTMLElement | null;
  if (!t) return;
  if (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable
  ) {
    clearArm();
  }
}

function ensureListeners(): void {
  if (listenersAttached || typeof document === 'undefined') return;
  listenersAttached = true;
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('focusin', onFocusIn, true);
}

/**
 * Two-stage Esc handler. First call arms (and shows the toast). Second call
 * within the timeout fires the action.
 *
 * If the message changes between calls (e.g. moving across scopes), the new
 * message replaces the old one and the timeout resets — but the arm stays
 * active, so the next Esc still fires. Conservative: in practice all the
 * sites that call this share the same scope at a time.
 */
export function escConfirm(message: string, action: () => void): void {
  ensureListeners();
  const now = Date.now();
  if (armed && now < armed.expiresAt) {
    const fn = armed.action;
    clearArm();
    fn();
    return;
  }
  armed = { action, expiresAt: now + TIMEOUT_MS };
  escToast.message = message;
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  timeoutId = window.setTimeout(() => {
    clearArm();
  }, TIMEOUT_MS);
}

/**
 * Public reset — useful when a parent flow exits programmatically (e.g. user
 * navigates via a button) and the toast should disappear immediately.
 */
export function resetEscConfirm(): void {
  clearArm();
}
