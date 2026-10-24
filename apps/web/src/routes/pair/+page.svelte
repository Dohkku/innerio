<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import {
    type PairPayload,
    clearPendingPairing,
    parsePairPayload,
    readPendingPairing,
    storePendingPairing,
  } from '$lib/pairing';
  import { cryptoStore } from '$lib/stores/crypto.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { Capacitor } from '@capacitor/core';
  import QrScanner from 'qr-scanner';

  let videoEl = $state<HTMLVideoElement | undefined>();
  let scanner: QrScanner | null = null;
  let status = $state<
    | 'idle'
    | 'scanning'
    | 'paired'
    | 'sending'
    | 'sent'
    | 'unlocking'
    | 'done'
    | 'error'
  >('idle');
  let error = $state<string | null>(null);
  let detectedEmail = $state<string | null>(null);
  let lastPayload = $state<PairPayload | null>(null);

  // Si llegamos a /pair con un payload en el hash (generado por
  // settings/pair que mete el payload en la URL), lo decodificamos
  // directamente sin pasar por la cámara.
  function tryConsumeHash(): PairPayload | null {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return null;
    return parsePairPayload(hash);
  }

  async function handlePayload(payload: PairPayload) {
    status = 'paired';
    detectedEmail = payload.email;
    lastPayload = payload;
    storePendingPairing(payload);
    if (scanner) {
      scanner.stop();
      scanner.destroy();
      scanner = null;
    }
    // Asegura que session.refresh() del boot del layout ya completó antes
    // de chequear session.user — sin esto, el primer hit a /pair lee
    // session.ready=false y dispara una segunda autenticación inútil.
    if (!session.ready) await session.refresh();
    // Si ya hay sesión activa con el mismo email, vamos directo a unlock.
    if (session.user && session.user.email === payload.email) {
      await tryUnlock(payload);
      return;
    }
    // Flujo nuevo (WhatsApp Web-style): el PC pre-minteó una verify URL.
    if (payload.verifyUrl) {
      status = 'unlocking';
      // App nativa (Capacitor): NO podemos navegar a la verifyUrl porque
      // redirige a WEB_ORIGIN y sacaría al WebView fuera de la app (perdiendo
      // este sessionStorage). En su lugar la pedimos con fetch para que Better
      // Auth ponga la cookie de sesión sin movernos de localhost, y luego
      // refrescamos la sesión aquí mismo. (ADR-036)
      if (Capacitor.isNativePlatform()) {
        try {
          await fetch(payload.verifyUrl, { credentials: 'include', redirect: 'manual' });
        } catch {
          // La respuesta del 302 es opaca y fetch puede "rechazar"; la cookie
          // se aplica igualmente. Seguimos y comprobamos con refresh.
        }
        await session.refresh();
        if (session.user && session.user.email === payload.email) {
          await tryUnlock(payload);
          return;
        }
        status = 'error';
        error =
          'No se pudo entrar con el QR. Genera uno nuevo en el PC e inténtalo otra vez.';
        return;
      }
      // Web: navegación directa; al volver a /pair?resume=1 el sessionStorage
      // del mismo origen sobrevive y completamos el unlock.
      window.location.href = payload.verifyUrl;
      return;
    }
    // Fallback legacy (QR sin verifyUrl, e.g. PC con build viejo): pedimos
    // un magic link normal al email.
    await sendMagicLink(payload.email);
  }

  async function sendMagicLink(email: string) {
    status = 'sending';
    error = null;
    try {
      await session.sendMagicLink(email, '/pair?resume=1');
      status = 'sent';
    } catch (err) {
      status = 'error';
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function tryUnlock(payload: PairPayload) {
    status = 'unlocking';
    try {
      // Si la sesión está en unlock-required, este path completa el flujo.
      // Si está en setup-required (primera vez en este device), también
      // serviría — pero asumimos que el dispositivo origen ya hizo setup;
      // si llega como setup-required en B es que el envelope no se ha
      // propagado todavía: pedimos al usuario refrescar.
      if (cryptoStore.status === 'unlock-required') {
        await cryptoStore.unlockWithPassphrase(payload.passphrase);
        clearPendingPairing();
        status = 'done';
        setTimeout(() => goto('/'), 700);
        return;
      }
      if (cryptoStore.status === 'unlocked') {
        clearPendingPairing();
        status = 'done';
        setTimeout(() => goto('/'), 700);
        return;
      }
      // unlock-required aún no llegó (envelope cargando). Esperamos hasta 3s
      // a que el crypto store complete el fetch de la envelope tras login.
      status = 'unlocking';
      for (let i = 0; i < 10; i++) {
        await new Promise((res) => setTimeout(res, 300));
        const s: string = cryptoStore.status;
        if (s === 'unlock-required') {
          await cryptoStore.unlockWithPassphrase(payload.passphrase);
          clearPendingPairing();
          status = 'done';
          setTimeout(() => goto('/'), 700);
          return;
        }
        if (s === 'unlocked') {
          clearPendingPairing();
          status = 'done';
          setTimeout(() => goto('/'), 700);
          return;
        }
      }
      throw new Error(`Estado inesperado tras esperar: ${cryptoStore.status}`);
    } catch (err) {
      status = 'error';
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function startScanner() {
    if (!videoEl) return;
    try {
      scanner = new QrScanner(
        videoEl,
        (result) => {
          const payload = parsePairPayload(result.data);
          if (!payload) {
            // Try with hash-style URL.
            try {
              const u = new URL(result.data);
              const hash = u.hash.replace(/^#/, '');
              const fromHash = parsePairPayload(hash);
              if (fromHash) {
                void handlePayload(fromHash);
                return;
              }
            } catch {
              // not a URL
            }
            return; // keep scanning
          }
          void handlePayload(payload);
        },
        { highlightScanRegion: true, highlightCodeOutline: true },
      );
      await scanner.start();
      status = 'scanning';
    } catch (err) {
      status = 'error';
      error =
        err instanceof Error
          ? `Cámara no disponible: ${err.message}`
          : 'Cámara no disponible.';
    }
  }

  onMount(async () => {
    // Hash directo (caso normal cuando A muestra QR + B abre en navegador):
    const fromHash = tryConsumeHash();
    if (fromHash) {
      await handlePayload(fromHash);
      return;
    }
    // Resumir tras login (B vuelve aquí con ?resume=1):
    const params = new URLSearchParams(window.location.search);
    if (params.get('resume') === '1') {
      const pending = readPendingPairing();
      if (pending) {
        detectedEmail = pending.email;
        lastPayload = pending;
        // Espera al refresh inicial del boot — al volver del callback
        // de Better Auth la cookie está, pero session.refresh() es async
        // y onMount llega antes de que ready sea true.
        if (!session.ready) await session.refresh();
        if (session.user) {
          await tryUnlock(pending);
          return;
        }
        // Si el usuario llegó aquí con resume=1 pero todavía no hay
        // sesión (poco común — significa que el magic link expiró o se
        // abrió en otro navegador), reenviamos otro link.
        await sendMagicLink(pending.email);
        return;
      }
    }
    // Modo cámara activa.
    await startScanner();
  });

  onDestroy(() => {
    if (scanner) {
      scanner.stop();
      scanner.destroy();
      scanner = null;
    }
  });
</script>

<main class="page">
  <header class="topbar">
    <h1>Emparejar</h1>
  </header>

  {#if status === 'idle' || status === 'scanning'}
    <p class="hint">Apunta la cámara al QR del otro dispositivo.</p>
    <div class="video-wrap">
      <video bind:this={videoEl} playsinline></video>
    </div>
  {:else if status === 'paired'}
    <p class="hint">Código leído. Preparando…</p>
  {:else if status === 'sending'}
    <p class="hint">Enviando enlace a {detectedEmail ?? 'tu email'}…</p>
    <div class="spinner" aria-hidden="true"></div>
  {:else if status === 'sent'}
    <div class="sent">
      <strong>Revisa el correo en este móvil.</strong>
      <p class="sent-body">
        Te envié un enlace a <code>{detectedEmail}</code>. Ábrelo
        <strong>en este móvil</strong> (no en el PC) y volverás aquí
        ya conectado. Caduca en 5 minutos.
      </p>
      <button
        type="button"
        class="btn ghost"
        onclick={() => detectedEmail && void sendMagicLink(detectedEmail)}
      >
        Reenviar enlace
      </button>
    </div>
  {:else if status === 'unlocking'}
    <p class="hint">Desbloqueando cifrado…</p>
    <div class="spinner" aria-hidden="true"></div>
  {:else if status === 'done'}
    <p class="hint ok">Listo. Llevándote a la app…</p>
  {:else if status === 'error'}
    <p class="err" role="alert">{error ?? 'Error desconocido.'}</p>
    <div class="btn-row">
      {#if lastPayload}
        <button
          type="button"
          class="btn"
          onclick={() => lastPayload && void sendMagicLink(lastPayload.email)}
        >
          Reintentar enlace
        </button>
      {/if}
      <button type="button" class="btn ghost" onclick={() => void goto('/')}>
        Volver al inicio
      </button>
    </div>
  {/if}
</main>

<style>
  .page {
    width: 100%;
    max-width: 480px;
    margin: 1.5rem auto 4rem;
    padding: 0 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
  }
  .topbar h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .hint {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    text-align: center;
  }
  .hint.ok {
    color: var(--accent);
  }
  .video-wrap {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 0.6rem;
    overflow: hidden;
    background: #000000;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .err {
    margin: 0;
    padding: 0.6rem 0.8rem;
    border-radius: 0.4rem;
    background: color-mix(in oklab, #f87171 12%, transparent);
    border: 1px solid color-mix(in oklab, #f87171 30%, transparent);
    color: color-mix(in oklab, #f87171 85%, currentColor);
    font-size: 0.9rem;
    text-align: center;
  }
  .btn {
    appearance: none;
    border: 1px solid color-mix(in oklab, currentColor 20%, transparent);
    background: color-mix(in oklab, currentColor 7%, transparent);
    color: inherit;
    font: inherit;
    font-size: 0.9rem;
    padding: 0.55rem 1.1rem;
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .btn.ghost {
    background: transparent;
  }
  .btn-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
  }
  .sent {
    width: 100%;
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    border: 1px solid color-mix(in oklab, var(--accent) 28%, transparent);
    border-radius: 0.6rem;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    text-align: center;
  }
  .sent-body {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.55;
    opacity: 0.92;
  }
  .sent code {
    font-family: ui-monospace, SFMono-Regular, monospace;
    background: color-mix(in oklab, currentColor 9%, transparent);
    padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
    font-size: 0.92em;
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
    to { transform: rotate(360deg); }
  }
</style>
