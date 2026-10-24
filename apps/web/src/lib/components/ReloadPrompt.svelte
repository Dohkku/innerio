<script lang="ts">
  // SvelteKit pollea `_app/version.json` cada `kit.version.pollInterval` ms.
  // Cuando detecta una versión distinta a la que se cargó en esta sesión,
  // `updated.current` pasa a true (irreversible — sólo se limpia con reload).
  import { updated } from '$app/state';

  function reload() {
    location.reload();
  }
</script>

{#if updated.current}
  <div class="toast" role="status" aria-live="polite">
    <span class="text">Nueva versión disponible</span>
    <button class="cta" type="button" onclick={reload}>Recargar</button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 150;
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.7rem 0.55rem 0.95rem;
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-mix-medium);
    color: var(--text-primary);
    font-size: var(--text-sm);
    box-shadow: var(--shadow-float-sm);
    animation: slide-up 220ms ease-out;
  }
  .text {
    opacity: 0.85;
  }
  .cta {
    appearance: none;
    border: 1px solid color-mix(in oklab, var(--accent) 50%, transparent);
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: inherit;
    font: inherit;
    font-size: var(--text-xs);
    padding: 0.25rem 0.7rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--dur-quick);
  }
  .cta:hover {
    background: color-mix(in oklab, var(--accent) 24%, transparent);
  }
  @keyframes slide-up {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
