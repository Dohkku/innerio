<script lang="ts">
  /**
   * DateInput — text input DD/MM/YYYY + native calendar picker.
   *
   * Why not solo `<input type="date">`? Chrome ignora `lang` y usa la
   * UI del navegador → English-Chrome muestra `mm/dd/yyyy`. Mantenemos
   * el text input para formato consistente y añadimos un botón al lado
   * que dispara el picker nativo via `showPicker()`.
   *
   * Behavior:
   *  - Display / parse DD/MM/YYYY only.
   *  - Auto-inserta slashes al teclear dígitos.
   *  - Commit on blur y on Enter; revierte al último valor válido si la
   *    entrada es inválida.
   *  - Empty string → emite `undefined` (limpia la fecha).
   *  - Click en el botón calendario → abre picker nativo. Al elegir, se
   *    sincroniza el text input y se hace commit.
   *  - `onEnter` se dispara tras commit en Enter.
   */
  import { onMount } from 'svelte';

  let {
    value,
    onChange,
    onEnter,
    ariaLabel,
    placeholder = 'dd/mm/aaaa',
    autofocus = false,
  }: {
    value: Date | undefined | null;
    onChange: (next: Date | undefined) => void;
    onEnter?: () => void;
    ariaLabel?: string;
    placeholder?: string;
    autofocus?: boolean;
  } = $props();

  let text = $state('');
  let lastSyncedKey = $state<string>('__init__');
  let inputEl = $state<HTMLInputElement | undefined>(undefined);
  let pickerEl = $state<HTMLInputElement | undefined>(undefined);

  function format(d: Date | null | undefined): string {
    if (!d) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    return `${day}/${mo}/${y}`;
  }

  function toIso(d: Date | null | undefined): string {
    if (!d) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    return `${y}-${mo}-${day}`;
  }

  function parse(s: string): Date | undefined {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return undefined;
    const day = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return undefined;
    const d = new Date(y, mo - 1, day, 0, 0, 0, 0);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return undefined;
    return d;
  }

  function parseIso(s: string): Date | undefined {
    if (!s) return undefined;
    const [y, mo, day] = s.split('-').map(Number);
    if (!y || !mo || !day) return undefined;
    const d = new Date(y, mo - 1, day, 0, 0, 0, 0);
    return d;
  }

  function valueKey(v: Date | null | undefined): string {
    return v ? String(v.getTime()) : '';
  }

  $effect(() => {
    const k = valueKey(value);
    if (k !== lastSyncedKey) {
      lastSyncedKey = k;
      text = format(value);
    }
  });

  onMount(() => {
    if (autofocus) inputEl?.focus();
  });

  function commit() {
    const trimmed = text.trim();
    if (!trimmed) {
      if (value) {
        lastSyncedKey = '';
        onChange(undefined);
      }
      text = '';
      return;
    }
    const parsed = parse(trimmed);
    if (!parsed) {
      text = format(value);
      return;
    }
    text = format(parsed);
    if (value && parsed.getTime() === value.getTime()) return;
    lastSyncedKey = String(parsed.getTime());
    onChange(parsed);
  }

  function onInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const digits = el.value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) text = digits;
    else if (digits.length <= 4) text = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    else text = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      onEnter?.();
    }
  }

  function openPicker() {
    if (!pickerEl) return;
    // showPicker() requiere user-gesture; el click del botón cuenta.
    // Fallback a focus() + click() para navegadores antiguos.
    if (typeof pickerEl.showPicker === 'function') {
      try {
        pickerEl.showPicker();
        return;
      } catch {
        // Algunos navegadores tiran si el input no es visible.
      }
    }
    pickerEl.focus();
    pickerEl.click();
  }

  function onPickerChange(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const parsed = parseIso(el.value);
    if (!parsed) {
      if (value) {
        lastSyncedKey = '';
        onChange(undefined);
      }
      text = '';
      return;
    }
    text = format(parsed);
    if (value && parsed.getTime() === value.getTime()) return;
    lastSyncedKey = String(parsed.getTime());
    onChange(parsed);
  }
</script>

<span class="wrap">
  <input
    bind:this={inputEl}
    class="date-input"
    type="text"
    inputmode="numeric"
    {placeholder}
    value={text}
    oninput={onInput}
    onblur={commit}
    onkeydown={onKey}
    aria-label={ariaLabel}
    autocomplete="off"
    spellcheck="false"
    maxlength="10"
  />
  <button
    type="button"
    class="picker-btn"
    onclick={openPicker}
    aria-label="Abrir calendario"
    title="Abrir calendario"
    tabindex="-1"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  </button>
  <input
    bind:this={pickerEl}
    class="picker-native"
    type="date"
    value={toIso(value)}
    onchange={onPickerChange}
    aria-hidden="true"
    tabindex="-1"
  />
</span>

<style>
  .wrap {
    display: flex;
    align-items: center;
    gap: 2px;
    position: relative;
    width: 100%;
  }
  .date-input {
    appearance: none;
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    line-height: 1.4;
  }
  .date-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: var(--accent);
  }
  .picker-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    transition: color 80ms;
  }
  .picker-btn:hover {
    color: var(--text-primary);
  }
  /* El input nativo queda invisible pero clicable como ancla del picker.
     Posicionado bajo el botón para que showPicker() (cuando no se
     soporta) lo abra junto al botón. */
  .picker-native {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
    border: 0;
    padding: 0;
  }
</style>
