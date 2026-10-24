<script lang="ts">
  /**
   * Botón "volver" canónico. Circular, icon-only (chevron izquierda).
   * El padre ata el binding de Escape vía `useScope` — este componente sólo
   * pinta el indicador visual. Cuando el `escConfirm` del padre está armado,
   * el chevron pasa a `.armed` (color secondary) y el padre pinta el mensaje
   * `escToast.message` inline en la topbar.
   */
  import { escToast } from '$lib/stores/esc-confirm.svelte';

  let {
    href,
    onclick,
    ariaLabel = 'Volver',
  }: {
    href?: string;
    onclick?: () => void;
    ariaLabel?: string;
  } = $props();

  const armed = $derived(escToast.message != null);
</script>

{#snippet chev()}
  <svg
    class="chev-icon"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
{/snippet}

{#if href}
  <a class="back" class:armed {href} aria-label={ariaLabel} title="Esc">
    {@render chev()}
  </a>
{:else}
  <button class="back" class:armed type="button" {onclick} aria-label={ariaLabel} title="Esc">
    {@render chev()}
  </button>
{/if}

<style>
  /* Mismo patrón circular que `.recurring-filter` en /work y `.process-cta`
   * en bandeja: tap-target fijo (--control-md), border-radius 999px,
   * idle transparente. Armed sube el color a warning sin pintar texto. */
  .back {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
    width: var(--control-md);
    height: var(--control-md);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    line-height: 0;
    transition:
      color 80ms,
      background 80ms,
      box-shadow var(--dur-base) ease;
  }
  .back:hover {
    color: var(--text-primary);
    background: var(--press-bg-subtle);
  }
  .back:active {
    color: var(--text-primary);
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
    transform: translateY(1px);
  }
  /* Armed (1ª Esc): tinte sutil sobre el chevron. El hint visible lo
   * pinta el padre como sibling en la topbar para alinearse al counter. */
  .back.armed {
    color: var(--text-secondary);
  }
  .chev-icon {
    display: inline-block;
    flex-shrink: 0;
  }
</style>
