<script module lang="ts">
  // Solo un tip abierto a la vez en toda la app — abrir uno cierra los
  // demás. Click fuera del panel cierra. Esc también. Sin esto, los tips
  // se solapaban visualmente y eran ilegibles (issue iter5).
  let openId = $state<number | null>(null);
  let nextId = 0;
  function nextTipId(): number {
    return ++nextId;
  }
  function setOpen(id: number | null): void {
    openId = id;
  }
  function isOpen(id: number): boolean {
    return openId === id;
  }
</script>

<script lang="ts">
  // Botón ⓘ adyacente a una etiqueta. Hover muestra el title nativo
  // (definición corta). Click abre/cierra un panel inline con
  // definición + uso.
  let { what, use }: { what: string; use: string } = $props();
  const myId = nextTipId();
  let wrapEl: HTMLElement | undefined = $state();

  const open = $derived(isOpen(myId));

  function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(open ? null : myId);
  }

  function onWindowClick(e: MouseEvent) {
    if (!open) return;
    const t = e.target as Node | null;
    if (t && wrapEl && wrapEl.contains(t)) return;
    setOpen(null);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      // stopImmediatePropagation: que otros listeners (inspector close,
      // modal del tour, process exit) no se disparen al cerrar el tip.
      e.stopImmediatePropagation();
      setOpen(null);
    }
  }
</script>

<svelte:window onkeydown={onKey} onclick={onWindowClick} />

<span class="wrap" bind:this={wrapEl}>
  <button
    type="button"
    class="info-btn"
    title={what}
    aria-label="Más info"
    aria-expanded={open}
    onclick={toggle}
  >ⓘ</button>
  {#if open}
    <span class="panel" role="tooltip">
      <span class="row"><strong>Qué es:</strong> {what}</span>
      <span class="row use"><strong>Para qué:</strong> {use}</span>
    </span>
  {/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .info-btn {
    appearance: none;
    background: transparent;
    color: inherit;
    border: 0;
    cursor: pointer;
    opacity: 0.45;
    font-size: 0.82rem;
    padding: 0 0.18rem;
    line-height: 1;
    border-radius: 999px;
    transition: opacity 80ms;
  }
  .info-btn:hover,
  .info-btn:focus-visible {
    opacity: 1;
    outline: none;
  }
  .info-btn[aria-expanded='true'] {
    opacity: 1;
  }
  .panel {
    position: absolute;
    top: calc(100% + 6px);
    left: -0.4rem;
    z-index: 1000;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
    width: min(280px, 86vw);
    padding: 0.55rem 0.7rem;
    /* Borde y fondo en términos de tokens, no `currentColor`, para que
       no hereden la atenuación de un padre `.lbl`. */
    border: 1px solid color-mix(in oklab, var(--text-primary) 28%, var(--surface-base));
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--text-primary) 8%, var(--surface-base));
    box-shadow: 0 12px 28px color-mix(in oklab, var(--text-primary) 35%, transparent);
    font-size: 0.78rem;
    line-height: 1.45;
    text-transform: none;
    letter-spacing: normal;
    font-weight: var(--weight-normal);
    text-align: left;
    /* No heredamos `color` del padre: si el padre está atenuado (p.ej.
       `.lbl` con color-mix → currentColor 60% transparent), el panel
       saldría con texto faint. Forzamos el color de texto primario. */
    color: var(--text-primary);
  }
  .panel .row {
    display: block;
  }
  .panel strong {
    font-weight: var(--weight-semibold);
  }
</style>
