<script lang="ts">
  import { useQuery } from '@triplit/svelte';
  import { triplit } from '$lib/triplit';
  import { page } from '$app/state';
  import Nav from '$lib/components/Nav.svelte';
  import SearchOverlay from '$lib/components/SearchOverlay.svelte';
  import ReloadPrompt from '$lib/components/ReloadPrompt.svelte';
  import HelpFab from '$lib/components/HelpFab.svelte';
  import SettingsFab from '$lib/components/SettingsFab.svelte';
  import CryptoSetupModal from '$lib/components/CryptoSetupModal.svelte';
  import CryptoUnlockModal from '$lib/components/CryptoUnlockModal.svelte';
  import DecryptErrorBanner from '$lib/components/DecryptErrorBanner.svelte';
  import DemoBanner from '$lib/components/DemoBanner.svelte';
  import { pwa } from '$lib/pwa.svelte';
  import SyncStatus from '$lib/components/SyncStatus.svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import { open as openSearch } from '$lib/stores/search.svelte';
  import { runMigrations } from '$lib/migrations';
  // Side-effect imports.
  import '$lib/appearance/appearance.css';
  import '$lib/stores/appearance.svelte';
  import '$lib/stores/theme-pack.svelte';
  // Side-effect: bootstraps Better Auth session resolution + Triplit token
  // rotation on login/logout. Solo arranca si VITE_TRIPLIT_SERVER está
  // definido (modo sync); en anonymous local es no-op silencioso.
  import { session } from '$lib/stores/session.svelte';
  import { cryptoStore } from '$lib/stores/crypto.svelte';
  import { Capacitor } from '@capacitor/core';
  import type { Item } from '@gtd/schema';
  import { isInbox, isReminderPending } from '$lib/item-state';
  import { now } from '$lib/stores/now.svelte';
  import { dailyReminder, syncReminderFromInbox } from '$lib/stores/daily-reminder.svelte';

  let { children } = $props();

  // E2EE boot overlay — cubre los children mientras crypto resuelve estado
  // inicial. Sin esto, Triplit emite ciphertext desde IDB local antes del
  // DEK cacheado y produce un flash de base64 en titles. Overlay solo si:
  //   - usuario logueado (sync mode)
  //   - no estamos en /login (que debe renderizar pronto sin DEK)
  //   - cryptoStore aún cargando
  let cryptoBooting = $derived(
    !page.url.pathname.startsWith('/login') &&
      session.ready &&
      session.user !== null &&
      (cryptoStore.status === 'idle' || cryptoStore.status === 'loading'),
  );

  // Hide global nav on focused single-task pages (process wizard) y en /login.
  let isFocused = $derived(
    page.url.pathname.startsWith('/process') || page.url.pathname.startsWith('/login'),
  );
  let showNav = $derived(!isFocused);

  // Local IDB readiness gate para las migraciones one-shot.
  const itemsCountSub = useQuery(triplit, triplit.query('items').Select(['id']).Limit(1));

  $effect(() => {
    if (itemsCountSub.fetching) return;
    void runMigrations();
  });

  // Modelo B (doc 48): solo en la app nativa, suscribe items para reprogramar
  // el aviso diario según el conteo real de Bandeja. En web no se monta (la
  // query no se crea), coste cero. El cálculo es on-device, respeta E2EE.
  const isNative = Capacitor.isNativePlatform();
  const reminderItemsSub = isNative ? useQuery(triplit, triplit.query('items')) : null;

  $effect(() => {
    if (!reminderItemsSub || reminderItemsSub.fetching || !dailyReminder.enabled) return;
    const items = (reminderItemsSub.results ?? []) as Item[];
    const count = items.filter(
      (it) => isInbox(it) && !it.parent_id && !isReminderPending(it, now.value),
    ).length;
    void syncReminderFromInbox(count);
  });

  // Recuperación de sync tras background. ColorOS y otras ROMs congelan el
  // WebView en segundo plano: los timers paran (el refresh de token no corre)
  // y el WebSocket puede morir sin que Triplit lo note hasta agotar su backoff.
  //
  // Ojo: `triplit.connectionStatus` NO es el estado real del WebSocket, es un
  // estado lógico (`session.status`). Tras congelarse, ese estado lógico se
  // desincroniza del socket real de dos formas: (a) el `close` retrasado de un
  // socket viejo pisa `session.status = CLOSED` aunque el socket nuevo ya
  // sincronice (Triplit reutiliza la misma sesión al reconectar) → el aviso
  // "sin conexión" se queda clavado mientras los cambios SÍ viajan; (b) queda
  // un socket "zombie" lógicamente OPEN pero muerto. Por eso al volver de un
  // rato en background no basta con reconectar si no está abierta: forzamos un
  // ciclo limpio `disconnect()` + `connect()` que tira cualquier socket previo
  // y vuelve a sincronizar el indicador con la realidad. Para ausencias cortas
  // (cambiar de pestaña en escritorio) mantenemos el reconnect condicional para
  // no cortar una conexión sana. El `refreshHandler` de startSession renueva el
  // JWT en el handshake si caducó. Solo en modo sync y con sesión activa.
  $effect(() => {
    if (!import.meta.env.VITE_TRIPLIT_SERVER) return;
    // Fuera más de esto = el WebView pudo congelarse y el socket morir sin que
    // Triplit lo note. Por debajo, asumimos que la conexión sigue sana.
    const STALE_AWAY_MS = 3000;
    let hiddenSince = 0;

    // Socket nuevo + estado lógico resincronizado con la realidad. No-op si aún
    // no hay sesión sync (evita el warning de connect() sin sesión).
    const hardReconnect = () => {
      if (!session.user || triplit.connectionStatus === 'UNINITIALIZED') return;
      triplit.disconnect();
      void triplit.connect();
    };

    const wake = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!session.user) return;
      const awayMs = hiddenSince ? Date.now() - hiddenSince : 0;
      hiddenSince = 0;
      if (awayMs > STALE_AWAY_MS) {
        hardReconnect();
        return;
      }
      const s = triplit.connectionStatus;
      if (s === 'OPEN' || s === 'CONNECTING') return;
      void triplit.connect();
    };

    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now();
      } else {
        wake();
      }
    };
    // Cambio de red: reconexión limpia para no arrastrar un socket medio-muerto.
    const onOnline = () => hardReconnect();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  });

  // Fullscreen interno (doc 40). Shift+F.
  async function toggleAppFullscreen() {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.error('[fullscreen] toggle failed:', err);
    }
  }

  useScope({
    name: 'global-app',
    bindings: [
      { key: '/', description: 'buscar', handler: openSearch },
      {
        key: 'f',
        shift: true,
        description: 'pantalla completa',
        handler: () => void toggleAppFullscreen(),
      },
    ],
  });

  // PWA: service worker + install prompt (browser only, see $lib/pwa.svelte).
  $effect(() => {
    pwa.start();
  });
</script>

<svelte:head>
  <title>Innerio</title>
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fafafa" />
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
</svelte:head>

<div class="app" class:nav-bottom={showNav}>
  <DecryptErrorBanner />
  {#if !isFocused}
    <DemoBanner />
  {/if}
  {#if showNav}
    <Nav />
  {/if}
  <div class="page-shell">
    {@render children()}
  </div>
</div>

{#if session.user}
  <SyncStatus />
{/if}
<SearchOverlay />
<ReloadPrompt />
<HelpFab />
<SettingsFab />
<CryptoSetupModal />
{#if !page.url.pathname.startsWith('/pair')}
  <!-- En /pair el desbloqueo es automático (passphrase del QR); ocultar el
       modal global evita el parpadeo de "pon la contraseña" durante el pairing. -->
  <CryptoUnlockModal />
{/if}

{#if cryptoBooting}
  <div class="crypto-boot" role="status" aria-live="polite">
    <div class="spinner" aria-hidden="true"></div>
    <p>Cargando…</p>
  </div>
{/if}

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
    background: var(--surface-base);
    color: var(--text-primary);
    color-scheme: light dark;
    /* Móvil/WebView: el recuadro azul que pinta el motor al tocar un elemento
       (bounding box del tap) queda feo. Lo quitamos en toda la app; el feedback
       de pulsación ya lo dan los estados :active/:hover propios. */
    -webkit-tap-highlight-color: transparent;
  }
  :global(::selection) {
    background: var(--accent);
    color: var(--surface-base);
  }
  :global(img::selection) {
    background: transparent;
  }
  :global(h1, h2, h3, h4, h5, h6) {
    font-family: var(--font-headings);
  }
  :global(*) {
    box-sizing: border-box;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(*),
    :global(*::before),
    :global(*::after) {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  :global(button) {
    font: inherit;
    color: inherit;
  }
  .app {
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }
  /* Móvil: el notch superior no debe tapar el contenido (safe-area-top), y
     cuando el Nav está abajo (fixed) hay que reservar su alto + la barra de
     gestos para que la última fila no quede oculta. */
  @media (max-width: 40rem) {
    .app {
      padding-top: env(safe-area-inset-top, 0px);
    }
    .app.nav-bottom .page-shell {
      padding-bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px));
    }
  }
  .crypto-boot {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.9rem;
    background: var(--surface-base);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .crypto-boot p {
    margin: 0;
    font-size: 0.92rem;
    opacity: 0.7;
  }
  .spinner {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    border: 2px solid color-mix(in oklab, currentColor 18%, transparent);
    border-top-color: currentColor;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      opacity: 0.5;
    }
  }
</style>
