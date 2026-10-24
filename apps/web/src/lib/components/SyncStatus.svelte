<script lang="ts">
  import { useConnectionStatus } from '@triplit/svelte';
  import { triplit } from '$lib/triplit';

  const conn = useConnectionStatus(triplit);

  // Sin servidor configurado = modo local puro, nunca hay nada que avisar.
  const hasServer = Boolean(import.meta.env.VITE_TRIPLIT_SERVER);

  // "Con problema" = no estamos sincronizados. OPEN = silencio total (no se
  // pinta nada). UNINITIALIZED es el estado de arranque antes de conectar, no
  // un fallo, así que tampoco avisa.
  let troubled = $derived(
    hasServer && conn.status !== 'OPEN' && conn.status !== 'UNINITIALIZED',
  );

  // Anti-parpadeo: cada arranque pasa por CONNECTING un instante. Solo
  // mostramos el aviso si el estado problemático persiste más de 2s, para no
  // molestar en la conexión normal y delatar solo una sync de verdad caída.
  let visible = $state(false);
  $effect(() => {
    if (!troubled) {
      visible = false;
      return;
    }
    const t = setTimeout(() => {
      visible = true;
    }, 2000);
    return () => clearTimeout(t);
  });

  let label = $derived(conn.status === 'CONNECTING' ? 'conectando…' : 'sin conexión');

  // Auto-reintento mientras el aviso está visible. Triplit reintenta solo, pero
  // con backoff que crece hasta 5 min: si la conexión cayó estando en primer
  // plano (red intermitente) el aviso se quedaría clavado ese rato. Mientras el
  // pill esté a la vista forzamos un intento cada 8s mientras el estado lógico
  // sea CLOSED/CLOSING (en CONNECTING no insistimos: connect() ya está en curso).
  $effect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      if (conn.status === 'CLOSED' || conn.status === 'CLOSING') {
        void triplit.connect();
      }
    }, 8000);
    return () => clearInterval(id);
  });

  function retry() {
    void triplit.connect();
  }
</script>

{#if visible}
  <button
    class="sync-pill"
    data-state={conn.status}
    onclick={retry}
    title="Tu móvil no está al día con la cuenta. Toca para reconectar."
  >
    <span class="dot" aria-hidden="true"></span>
    {label}
  </button>
{/if}

<style>
  .sync-pill {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 0.5rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: 120;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: var(--surface-raised, var(--surface-base));
    color: var(--text-secondary);
    box-shadow: var(--shadow-float-sm);
    font-size: 0.72rem;
    font-family: var(--font-body);
    cursor: pointer;
  }
  .dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 999px;
    background: currentColor;
  }
  /* Conectando: ámbar tenue, transitorio. */
  .sync-pill[data-state='CONNECTING'] {
    color: var(--warning, #b8860b);
  }
  .sync-pill[data-state='CONNECTING'] .dot {
    animation: pulse 1.2s ease-in-out infinite;
  }
  /* Sin conexión: rojo apagado, persistente hasta reconectar. */
  .sync-pill[data-state='CLOSED'],
  .sync-pill[data-state='CLOSING'] {
    color: var(--danger, #b04646);
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sync-pill .dot {
      animation: none;
    }
  }
</style>
