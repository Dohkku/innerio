<script lang="ts">
  /**
   * FAB de ajustes abajo-izquierda. Simétrico al `HelpFab.svelte`
   * (abajo-derecha) y con el mismo trato visual: botón redondo a 0.55
   * opacity, sube a 1 en hover. Va directo a `/settings/appearance`
   * sin panel intermedio.
   *
   * Oculto en `/process` (modo focused) y en `/settings/*` (no tiene
   * sentido mostrarlo cuando ya estás en ajustes).
   */
  import { page } from '$app/state';

  const hidden = $derived(
    page.url.pathname.startsWith('/process') ||
      page.url.pathname.startsWith('/settings'),
  );
</script>

{#if !hidden}
  <a
    class="btn"
    href="/settings"
    aria-label="Ajustes"
    title="Ajustes"
  >
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </svg>
  </a>
{/if}

<style>
  .btn {
    position: fixed;
    bottom: var(--space-5);
    left: var(--space-5);
    z-index: 40;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 999px;
    background: var(--surface-raised);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-float-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    transition:
      opacity var(--dur-quick) ease,
      color var(--dur-quick) ease,
      background var(--dur-quick) ease,
      box-shadow var(--dur-base) ease;
  }
  .btn:hover,
  .btn:focus-visible {
    opacity: 1;
    color: var(--text-primary);
    outline: none;
  }
  .btn:active {
    box-shadow: var(--shadow-inset-sm);
  }
  /* Móvil: sube por encima de la bottom-nav + barra de gestos. */
  @media (max-width: 40rem) {
    .btn {
      bottom: calc(var(--space-3) + 3.75rem + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
