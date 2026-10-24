<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { wipeLocalDatabase } from '$lib/data/wipe-local';
  import { cryptoStore } from '$lib/stores/crypto.svelte';
  import { session } from '$lib/stores/session.svelte';

  let mode = $state<'passphrase' | 'mnemonic' | 'reset'>('passphrase');
  let passphrase = $state('');
  let mnemonic = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let firstField: HTMLInputElement | HTMLTextAreaElement | null = $state(null);

  $effect(() => {
    // Focus the active field when the unlock modal mounts or mode changes.
    if (
      cryptoStore.status === 'unlock-required' &&
      (mode === 'passphrase' || mode === 'mnemonic') &&
      firstField
    ) {
      firstField.focus();
    }
  });

  async function submit(e?: Event): Promise<void> {
    e?.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      if (mode === 'passphrase') {
        if (passphrase.length === 0) {
          error = 'Introduce tu contraseña.';
          busy = false;
          return;
        }
        await cryptoStore.unlockWithPassphrase(passphrase);
      } else {
        const trimmed = mnemonic.trim().replace(/\s+/g, ' ');
        if (trimmed.split(' ').length !== 12) {
          error = 'La frase de recuperación tiene 12 palabras.';
          busy = false;
          return;
        }
        await cryptoStore.unlockWithMnemonic(trimmed);
      }
      passphrase = '';
      mnemonic = '';
    } catch (err) {
      error =
        mode === 'passphrase'
          ? 'Contraseña incorrecta.'
          : 'Frase no válida o no coincide con esta cuenta.';
      // Don't log the original err — it carries crypto detail.
      void err;
    } finally {
      busy = false;
    }
  }

  function switchMode(m: 'passphrase' | 'mnemonic'): void {
    mode = m;
    error = null;
  }

  // Salida de emergencia: el usuario llegó aquí porque perdió la contraseña,
  // borró el IDB local desde DevTools (la cookie cross-origin sobrevivió), o
  // simplemente se equivocó de cuenta. signOut() + wipeLocalDatabase() lo
  // devuelve a estado limpio en este dispositivo; la cuenta y los datos
  // sincronizados en el servidor quedan intactos.
  async function confirmReset(): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await session.signOut();
      await wipeLocalDatabase();
    } catch (err) {
      console.error('[crypto-unlock] reset failed', err);
    }
    // Hard navigation: signOut/wipe reset module-level state in stores, but a
    // full reload guarantees no in-flight subscription, no orphan cryptoStore
    // listener, and no half-decrypted cache survives into /login.
    window.location.replace('/login');
  }
</script>

{#if cryptoStore.status === 'unlock-required'}
  <div class="backdrop" role="presentation" transition:fade={{ duration: 120 }}></div>
  <div
    class="card"
    role="dialog"
    aria-modal="true"
    aria-label="Desbloquear cifrado"
    transition:scale={{ start: 0.96, duration: 160, opacity: 0 }}
  >
    {#if mode === 'reset'}
      <h1>Empezar de nuevo</h1>
      <p class="lead">
        Vas a cerrar sesión en este dispositivo y borrar los datos locales
        cifrados. Tu cuenta y los datos sincronizados en el servidor no se
        tocan: podrás volver a entrar con tu email.
      </p>
      <p class="warn">
        Si tenías cambios sin sincronizar en este dispositivo, se perderán.
      </p>
      <div class="actions">
        <button
          type="button"
          class="ghost"
          onclick={() => switchMode('passphrase')}
          disabled={busy}
        >
          Volver
        </button>
        <span class="spacer"></span>
        <button type="button" class="primary danger" onclick={confirmReset} disabled={busy}>
          {busy ? 'Limpiando…' : 'Cerrar sesión y borrar'}
        </button>
      </div>
    {:else}
      <h1>Desbloquea tus datos</h1>
      <p class="lead">
        Tus tareas están cifradas en este dispositivo. Introduce tu
        contraseña para descifrarlas.
      </p>

      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class:active={mode === 'passphrase'}
          aria-selected={mode === 'passphrase'}
          onclick={() => switchMode('passphrase')}
        >
          Contraseña
        </button>
        <button
          type="button"
          role="tab"
          class:active={mode === 'mnemonic'}
          aria-selected={mode === 'mnemonic'}
          onclick={() => switchMode('mnemonic')}
        >
          Frase de recuperación
        </button>
      </div>

      <form onsubmit={submit}>
        {#if mode === 'passphrase'}
          <input
            type="password"
            autocomplete="current-password"
            placeholder="Tu contraseña"
            bind:value={passphrase}
            bind:this={firstField}
            disabled={busy}
          />
        {:else}
          <textarea
            bind:value={mnemonic}
            bind:this={firstField}
            disabled={busy}
            rows="3"
            placeholder="abandon ability able about above absent absorb abstract absurd abuse access accident"
          ></textarea>
          <p class="hint">12 palabras separadas por espacios. Las que viste al configurar.</p>
        {/if}

        {#if error}<p class="error">{error}</p>{/if}

        <div class="actions">
          <span class="spacer"></span>
          <button type="submit" class="primary" disabled={busy}>
            {busy ? 'Descifrando…' : 'Desbloquear'}
          </button>
        </div>
      </form>

      <button
        type="button"
        class="link-button"
        onclick={() => {
          mode = 'reset';
          error = null;
        }}
        disabled={busy}
      >
        He perdido el acceso — cerrar sesión y empezar de nuevo
      </button>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in oklab, currentColor 32%, transparent);
    z-index: 95;
    backdrop-filter: blur(2px);
  }
  .card {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(440px, 92vw);
    max-height: 88vh;
    overflow-y: auto;
    z-index: 96;
    background: var(--bg);
    border: 1px solid color-mix(in oklab, currentColor 14%, transparent);
    border-radius: 0.8rem;
    box-shadow: 0 24px 60px color-mix(in oklab, currentColor 24%, transparent);
    padding: 1.3rem 1.3rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 500;
    margin: 0;
  }
  .lead {
    margin: 0;
    font-size: 0.9rem;
    opacity: 0.78;
    line-height: 1.5;
  }
  .tabs {
    display: flex;
    gap: 0.4rem;
    border-bottom: 1px solid color-mix(in oklab, currentColor 12%, transparent);
  }
  .tabs button {
    appearance: none;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    opacity: 0.7;
  }
  .tabs button:hover {
    opacity: 0.95;
  }
  .tabs button.active {
    opacity: 1;
    border-bottom-color: currentColor;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  input,
  textarea {
    appearance: none;
    background: var(--bg);
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    border-radius: 0.4rem;
    padding: 0.5rem 0.65rem;
    font: inherit;
    font-size: 0.95rem;
    color: inherit;
    resize: vertical;
  }
  textarea {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.88rem;
    line-height: 1.55;
  }
  input:focus,
  textarea:focus {
    outline: 2px solid color-mix(in oklab, currentColor 28%, transparent);
    outline-offset: -1px;
  }
  .hint {
    margin: 0;
    font-size: 0.78rem;
    opacity: 0.65;
  }
  .error {
    margin: 0;
    font-size: 0.82rem;
    color: color-mix(in oklab, #ef4444 70%, currentColor);
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.15rem;
    align-items: center;
  }
  .spacer {
    flex: 1;
  }
  .primary {
    appearance: none;
    border: 1px solid color-mix(in oklab, currentColor 30%, transparent);
    background: color-mix(in oklab, currentColor 14%, transparent);
    color: inherit;
    font: inherit;
    font-size: 0.9rem;
    padding: 0.5rem 1rem;
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .primary:hover:not(:disabled) {
    background: color-mix(in oklab, currentColor 22%, transparent);
  }
  .primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .primary.danger {
    border-color: color-mix(in oklab, #ef4444 45%, transparent);
    background: color-mix(in oklab, #ef4444 18%, transparent);
    color: color-mix(in oklab, #ef4444 80%, currentColor);
  }
  .primary.danger:hover:not(:disabled) {
    background: color-mix(in oklab, #ef4444 28%, transparent);
  }
  .ghost {
    appearance: none;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.9rem;
    padding: 0.5rem 0.9rem;
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .ghost:hover:not(:disabled) {
    background: color-mix(in oklab, currentColor 8%, transparent);
  }
  .ghost:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .warn {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    padding: 0.45rem 0.65rem;
    border-radius: 0.4rem;
    background: color-mix(in oklab, #f59e0b 12%, transparent);
    border: 1px solid color-mix(in oklab, #f59e0b 28%, transparent);
    color: color-mix(in oklab, #f59e0b 78%, currentColor);
  }
  .link-button {
    appearance: none;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0;
    margin-top: 0.2rem;
    cursor: pointer;
    opacity: 0.6;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-align: center;
  }
  .link-button:hover:not(:disabled) {
    opacity: 0.95;
  }
  .link-button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
