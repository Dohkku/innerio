export function isEditableElement(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function blurIfEditable(el: EventTarget | null): boolean {
  if (!isEditableElement(el)) return false;
  el.blur();
  return true;
}

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Move focus to the next/previous tabbable element in document order.
 * Used to escape textareas where the native Tab key inserts a tab character.
 * Returns true when focus moved.
 */
export function focusNextTabbable(direction: 1 | -1 = 1): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && el.offsetParent !== null,
  );
  const i = all.indexOf(active);
  if (i === -1) return false;
  const next = all[i + direction];
  if (!next) return false;
  next.focus();
  return true;
}
