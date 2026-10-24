/**
 * Global open/close state for the Search overlay.
 *
 * One overlay instance lives in +layout.svelte. The `/` shortcut (registered
 * at layout level) calls `open()`. Esc / backdrop / row-pick call `close()`.
 *
 * Spec: .vault/20-search-design.md
 */
export const search = $state<{ open: boolean }>({ open: false });

export function open(): void {
  search.open = true;
}

export function close(): void {
  search.open = false;
}
