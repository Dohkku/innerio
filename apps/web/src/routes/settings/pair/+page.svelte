<script lang="ts">
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import BackButton from '$lib/components/BackButton.svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import { buildPairPayload } from '$lib/pairing';
  import { cryptoStore } from '$lib/stores/crypto.svelte';
  import { escConfirm, escToast } from '$lib/stores/esc-confirm.svelte';
  import { session } from '$lib/stores/session.svelte';
  import QRCode from 'qrcode';

  const TTL_MS = 60_000;
  const AUTH_BASE = import.meta.env.VITE_AUTH_SERVER ?? '';

  type Phase = 'idle' | 'asking' | 'showing';

  let canvasEl = $state<HTMLCanvasElement | undefined>();
  let passphraseInputEl = $state<HTMLInputElement | undefined>();
  let typedPassphrase = $state('');
  let phase = $state<Phase>('idle');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let expiresAt = $state(0);
  let remainingMs = $state(0);
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  let canPair = $derived(
    session.user !== null && cryptoStore.status === 'unlocked',
  );

  function startGenerate() {
    if (!canPair || busy) return;
    typedPassphrase = '';
    error = null;
    phase = 'asking';
    queueMicrotask(() => passphraseInputEl?.focus());
  }

  function cancelAsking() {
    if (busy) return;
    typedPassphrase = '';
    error = null;
    phase = 'idle';
  }

  async function confirmPassphrase() {
    if (busy || !typedPassphrase) return;
    busy = true;
    error = null;
    const passphrase = typedPassphrase;
    try {
      const ok = await cryptoStore.verifyPassphrase(passphrase);
      if (!ok) {
        error = 'Esa frase no coincide. Inténtalo de nuevo.';
        return;
      }
      // Pre-mintea una URL verify de magic-link en el servidor para meterla
      // en el QR. Así el móvil, al escanear, autentica en un solo paso (sin
      // email). Si el servidor no soporta el endpoint, caemos al flujo
      // legacy (móvil pide magic-link al escanear).
      let verifyUrl: string | undefined;
      try {
        const res = await fetch(`${AUTH_BASE}/api/auth/pair-mint`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data = (await res.json()) as { url: string };
          verifyUrl = data.url;
        } else {
          console.warn('[pair] pair-mint failed:', res.status);
        }
      } catch (err) {
        console.warn('[pair] pair-mint network error:', err);
      }
      // Mover a fase 'showing' ANTES de pintar para que el canvas
      // visible sea el mismo al que llamamos toCanvas. Tick fuerza el
      // ciclo de render de Svelte antes de obtener canvasEl.
      phase = 'showing';
      await tick();
      const endpoint = AUTH_BASE || window.location.origin;
      const payload = buildPairPayload({
        endpoint,
        email: session.user?.email ?? '',
        passphrase,
        ...(verifyUrl ? { verifyUrl } : {}),
      });
      const pairUrl = new URL('/pair', window.location.origin);
      pairUrl.hash = payload;
      if (canvasEl) {
        await QRCode.toCanvas(canvasEl, pairUrl.toString(), {
          width: 280,
          margin: 1,
          color: { dark: '#111111', light: '#ffffff' },
        });
      }
      expiresAt = Date.now() + TTL_MS;
      remainingMs = TTL_MS;
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = setInterval(() => {
        remainingMs = Math.max(0, expiresAt - Date.now());
        if (remainingMs <= 0) clearQR();
      }, 200);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      // Vaciar la passphrase tecleada en cuanto se haya usado.
      typedPassphrase = '';
      busy = false;
    }
  }

  function clearQR() {
    if (canvasEl) {
      const ctx = canvasEl.getContext('2d');
      ctx?.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
    expiresAt = 0;
    remainingMs = 0;
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    phase = 'idle';
  }

  function onPassphraseKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void confirmPassphrase();
    }
  }

  $effect(() => () => {
    if (countdownTimer) clearInterval(countdownTimer);
  });

  // Modal-scope: cuando estamos pidiendo la frase, Esc cancela ese paso
  // sin salir de la página entera.
  useScope({
    name: 'pair-passphrase',
    modal: true,
    active: () => phase === 'asking',
    bindings: [
      {
        key: 'Escape',
        whileEditing: true,
        description: 'cancelar',
        handler: () => cancelAsking(),
      },
    ],
  });

  // Scope top-level: doble Esc vuelve a /settings. El scope modal de
  // arriba captura primero cuando está pidiendo la frase.
  useScope({
    name: 'settings-pair',
    bindings: [
      {
        key: 'Escape',
        description: 'volver',
        handler: () => escConfirm('(dos veces para volver)', () => void goto('/settings')),
      },
    ],
  });
</script>

<header class="topbar">
  <BackButton href="/settings" ariaLabel="Volver a Ajustes" />
  <strong>Emparejar dispositivo</strong>
  {#if escToast.message}
    <span class="hud-text" role="status" aria-live="polite">{escToast.message}</span>
  {/if}
</header>

<main class="page">
  <section class="card">
    <p class="desc">
      Apunta la cámara del móvil al QR de abajo. Al escanearlo abre Innerio
      en el móvil y queda conectado a tu cuenta de un tirón, sin email ni
      contraseñas. Si tu cámara no abre URLs, entra a
      <code>innerio.dohkku.dev/pair</code> en el móvil y enfoca el QR
      desde ahí.
    </p>
    <p class="desc small">
      Tus datos siguen cifrados de punta a punta. La clave de cifrado viaja
      en el QR, nunca por mi servidor. El código caduca en 60 segundos.
    </p>
  </section>

  {#if !canPair}
    <section class="card warn">
      <p>
        Necesitas tener sesión iniciada y la frase de cifrado desbloqueada
        para generar el código. Ve a Cuenta y entra primero.
      </p>
    </section>
  {:else}
    <section class="card qr-card">
      <div class="canvas-wrap" data-active={phase === 'showing'} data-fading={remainingMs < 10_000}>
        <canvas bind:this={canvasEl}></canvas>
      </div>

      {#if phase === 'idle'}
        <button
          type="button"
          class="btn primary"
          onclick={startGenerate}
          disabled={busy}
        >
          Generar código
        </button>
      {:else if phase === 'asking'}
        <div class="ask">
          <label class="ask-label" for="pair-passphrase">
            Confirma tu frase de cifrado para mostrar el QR.
          </label>
          <input
            id="pair-passphrase"
            type="password"
            bind:this={passphraseInputEl}
            bind:value={typedPassphrase}
            autocomplete="current-password"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            disabled={busy}
            onkeydown={onPassphraseKeydown}
            class="ask-input"
            aria-label="Frase de cifrado"
          />
          <div class="btn-row">
            <button type="button" class="btn ghost" onclick={cancelAsking} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn primary"
              onclick={() => void confirmPassphrase()}
              disabled={busy || !typedPassphrase}
            >
              {busy ? 'Comprobando…' : 'Mostrar QR'}
            </button>
          </div>
          <p class="kbd-hint"><kbd>Esc</kbd> cancelar · <kbd>↵</kbd> confirmar</p>
        </div>
      {:else}
        <p class="countdown">
          Caduca en {Math.ceil(remainingMs / 1000)}s
        </p>
        <button type="button" class="btn ghost" onclick={startGenerate} disabled={busy}>
          Mostrar de nuevo
        </button>
      {/if}

      {#if error}
        <p class="err" role="alert">{error}</p>
      {/if}
    </section>
  {/if}
</main>

<style>
  .topbar {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 1rem 1.2rem 0.4rem;
  }
  .hud-text {
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1;
  }
  .page {
    width: 100%;
    max-width: 480px;
    margin: 0.4rem auto 4rem;
    padding: 0 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .card {
    border: 1px solid color-mix(in oklab, currentColor 8%, transparent);
    border-radius: 0.6rem;
    padding: 1.2rem;
  }
  .card.warn {
    border-color: color-mix(in oklab, #f59e0b 30%, transparent);
  }
  .qr-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
  }
  .canvas-wrap {
    padding: 0.7rem;
    border-radius: 0.6rem;
    background: #ffffff;
    transition: opacity 200ms;
    display: none;
  }
  .canvas-wrap[data-active='true'] {
    display: block;
  }
  .canvas-wrap[data-fading='true'] {
    opacity: 0.6;
  }
  .desc {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.55;
    text-align: justify;
    opacity: 0.88;
  }
  .desc.small {
    margin-top: 0.6rem;
    font-size: 0.85rem;
    opacity: 0.7;
  }
  .desc code {
    font-family: ui-monospace, SFMono-Regular, monospace;
    padding: 0.05rem 0.3rem;
    background: color-mix(in oklab, currentColor 7%, transparent);
    border-radius: 0.25rem;
    font-size: 0.88em;
  }
  .countdown {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.65;
    font-variant-numeric: tabular-nums;
  }
  .ask {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .ask-label {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .ask-input {
    appearance: none;
    width: 100%;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    background: color-mix(in oklab, currentColor 4%, transparent);
    color: inherit;
    font: inherit;
    font-size: 0.92rem;
    padding: 0.5rem 0.7rem;
    border-radius: 0.4rem;
  }
  .ask-input:focus {
    outline: 2px solid color-mix(in oklab, var(--accent) 55%, transparent);
    outline-offset: 1px;
    border-color: color-mix(in oklab, var(--accent) 45%, transparent);
  }
  .ask-input:disabled {
    opacity: 0.6;
  }
  .btn-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.2rem;
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
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary {
    background: var(--accent);
    color: var(--surface-base);
    border-color: transparent;
  }
  .btn.ghost {
    background: transparent;
  }
  .kbd-hint {
    margin: 0.1rem 0 0;
    font-size: 0.72rem;
    opacity: 0.55;
  }
  kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    border-radius: 0.3rem;
    padding: 0.05rem 0.32rem;
    margin: 0 0.05rem;
    font-size: 0.68rem;
  }
  .err {
    margin: 0;
    padding: 0.5rem 0.7rem;
    border-radius: 0.4rem;
    background: color-mix(in oklab, #f87171 12%, transparent);
    border: 1px solid color-mix(in oklab, #f87171 30%, transparent);
    color: color-mix(in oklab, #f87171 85%, currentColor);
    font-size: 0.85rem;
    text-align: center;
  }
</style>
