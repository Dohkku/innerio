/**
 * Single global keyboard handler with a stack of scopes.
 *
 * Replaces the hand-wired `window.addEventListener('keydown', …)` patterns
 * scattered across pages and components. Per .vault/18-keyboard-refactor-design.md.
 *
 * Usage:
 *   import { useScope } from '$lib/keyboard.svelte';
 *
 *   useScope({
 *     name: 'inbox',
 *     bindings: [
 *       { key: 'n', description: 'capturar', handler: () => focusCapture() },
 *       { key: 'p', description: 'procesar', handler: () => goto('/process') },
 *     ],
 *   });
 *
 * Rules:
 *   - Topmost (latest pushed) scope wins. Walk top-to-bottom looking for a match.
 *   - Bindings without `whileEditing: true` are skipped while focus is in an
 *     editable element (input, textarea, contenteditable).
 *   - `e.repeat` events are dropped — GTD shortcuts shouldn't auto-repeat.
 *   - A scope with `modal: true` blocks fall-through: if no binding in it
 *     matches, the walk stops (does not check scopes below).
 *   - `ctrl: true` means ⌘ on Mac, Ctrl elsewhere — detected once at module init.
 */

export type Binding = {
  /** Letter ('a'–'z', case-insensitive) or named key ('Escape', 'Enter', 'Backspace', 'ArrowUp', …). */
  key: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Free-form label for the binding (for future hint surfaces). Omit to hide. */
  description?: string;
  /** Force the binding to fire even when an input/textarea has focus. Use sparingly (Esc, ⌘Enter). */
  whileEditing?: boolean;
  /** Hide from hint surfaces even with a description. */
  hidden?: boolean;
  handler: (e: KeyboardEvent) => void | Promise<void>;
};

export type Scope = {
  name: string;
  bindings: Binding[];
  /** If true, no fall-through to scopes pushed before this one. */
  modal?: boolean;
  /**
   * Optional visibility predicate. When it returns false, the entire scope
   * is invisible to the keyboard handler — bindings don't match and the
   * modal block doesn't apply. Use for always-mounted overlays whose script
   * registers a scope but whose UI is only shown conditionally (Search,
   * Onboarding, CascadeConfirm). Without this guard the always-on `Enter`
   * + `whileEditing` bindings preventDefault/stopPropagation in every input,
   * including the inbox CaptureBar.
   */
  active?: () => boolean;
};

import { untrack } from 'svelte';

// Plain array — NOT `$state`. Avoids two problems:
//   1. proxy_equality_mismatch when `lastIndexOf(scope)` compares the raw
//      reference passed in by the caller against the proxy stored in the array.
//   2. self-tracking inside the registration effect: with a $state array, any
//      sibling component's push would re-run our effect (because we'd have a
//      dep on it from reading), causing infinite re-pushes across components.
const scopes: Scope[] = [];

// Reactivity signal for consumers' $derived. Bumped inside `untrack` on
// push/pop so the writer doesn't subscribe itself.
let scopesVersion = $state(0);

// Detected once at module init. macOS / iOS use Cmd; everything else uses Ctrl.
function detectCmdKey(): 'metaKey' | 'ctrlKey' {
  if (typeof navigator === 'undefined') return 'ctrlKey';
  const platform =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  return /Mac|iPod|iPhone|iPad/i.test(platform) ? 'metaKey' : 'ctrlKey';
}

const cmdKey: 'metaKey' | 'ctrlKey' = detectCmdKey();

function isEditing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

function keyMatches(b: Binding, e: KeyboardEvent): boolean {
  // Single character: case-insensitive (e.key is already a printable char).
  // Multi-character key names ('Escape', 'Enter', 'Backspace', ...): exact.
  const matchesKey =
    b.key.length === 1
      ? e.key.length === 1 && e.key.toLowerCase() === b.key.toLowerCase()
      : e.key === b.key;
  if (!matchesKey) return false;
  if (!!b.ctrl !== e[cmdKey]) return false;
  if (!!b.shift !== e.shiftKey) return false;
  if (!!b.alt !== e.altKey) return false;
  return true;
}

function onKey(e: KeyboardEvent) {
  if (e.repeat) return;
  const editing = isEditing(e.target);
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope.active && !scope.active()) continue;
    for (const b of scope.bindings) {
      if (editing && !b.whileEditing) continue;
      if (keyMatches(b, e)) {
        e.preventDefault();
        e.stopPropagation();
        void b.handler(e);
        return;
      }
    }
    if (scope.modal) return;
  }
}

// Single global listener. HMR-safe: replace the previous listener if the
// module reloads (Vite hot module replacement keeps `window` alive).
declare global {
  interface Window {
    __gtdKeyboardListener?: (e: KeyboardEvent) => void;
  }
}

if (typeof window !== 'undefined') {
  const previous = window.__gtdKeyboardListener;
  if (previous) window.removeEventListener('keydown', previous, { capture: true });
  window.addEventListener('keydown', onKey, { capture: true });
  window.__gtdKeyboardListener = onKey;
}

/**
 * Register a scope of bindings for the lifetime of the calling component.
 * Pushes on $effect mount, pops on cleanup. Must be called from a component.
 */
export function useScope(scope: Scope): void {
  $effect(() => {
    untrack(() => {
      scopes.push(scope);
      scopesVersion++;
    });
    return () => {
      untrack(() => {
        const i = scopes.lastIndexOf(scope);
        if (i >= 0) scopes.splice(i, 1);
        scopesVersion++;
      });
    };
  });
}

export function activeScopes(): Scope[] {
  // Touch the version so $derived/$effect consumers re-run on push/pop.
  void scopesVersion;
  return scopes;
}

/** Label for the platform's "command" key — for hint surfaces. */
export function cmdLabel(): string {
  return cmdKey === 'metaKey' ? '⌘' : 'Ctrl';
}
