<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { cryptoStore } from '$lib/stores/crypto.svelte';

  // Local UI state — driven by `cryptoStore.status === 'setup-required'`.
  // Two-step flow:
  //   1. Passphrase entry (twice, validated).
  //   2. Recovery mnemonic shown ONCE; user must check the confirmation
  //      box before "Continuar" enables.
  let p1 = $state('');
  let p2 = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let mnemonic = $state<string | null>(null);
  let confirmedStored = $state(false);
  let copied = $state(false);

  let mismatch = $derived(p2.length > 0 && p1 !== p2);
  let tooShort = $derived(p1.length > 0 && p1.length < 12);
  let canSubmit = $derived(!busy && !mismatch && !tooShort && p1.length >= 12 && p1 === p2);

  async function submit(e?: Event): Promise<void> {
    e?.preventDefault();
    if (!canSubmit) return;
    busy = true;
    error = null;
    try {
      const result = await cryptoStore.setup(p1);
      mnemonic = result.mnemonic;
      // Wipe entered passphrase from local state — DEK is cached now.
      p1 = '';
      p2 = '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function copyMnemonic(): Promise<void> {
    if (!mnemonic) return;
    try {
      await navigator.clipboard.writeText(mnemonic);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      // Clipboard write blocked (no permission) — user can still select-all manually.
    }
  }

  function close(): void {
    if (!confirmedStored) return;
    // The store is already in 'unlocked' status by this point. We just
    // dismiss the modal — the next render of +layout will hide it.
    mnemonic = null;
    confirmedStored = false;
  }
</script>

{#if cryptoStore.status === 'setup-required' || mnemonic !== null}
  <div class="backdrop" role="presentation" transition:fade={{ duration: 120 }}></div>
  <div
    class="card"
    role="dialog"
    aria-modal="true"
    aria-label="Configurar cifrado end-to-end"
    transition:scale={{ start: 0.96, duration: 160, opacity: 0 }}
  >
    {#if !mnemonic}
      <h1>Configura tu cifrado</h1>
      <p class="lead">
        A partir de ahora todo lo que escribas (tareas, notas, áreas,
        objetivos) se cifra <strong>en tu dispositivo</strong> antes de
        salir hacia el servidor. Nadie puede leerlo, ni siquiera nosotros.
      </p>
      <p class="lead small">
        Necesitas una <strong>contraseña maestra</strong> que solo conozcas
        tú. Se usa para cifrar tu clave de datos. Si la pierdes, te
        damos también una frase de recuperación de 12 palabras para
        recuperar el acceso.
      </p>

      <form onsubmit={submit}>
        <label class="row">
          <span>Contraseña</span>
          <input
            type="password"
            autocomplete="new-password"
            bind:value={p1}
            disabled={busy}
            minlength={12}
            required
          />
        </label>
        <label class="row">
          <span>Repítela</span>
          <input
            type="password"
            autocomplete="new-password"
            bind:value={p2}
            disabled={busy}
            minlength={12}
            required
          />
        </label>

        {#if tooShort}
          <p class="hint err">Mínimo 12 caracteres.</p>
        {:else if mismatch}
          <p class="hint err">No coinciden.</p>
        {:else}
          <p class="hint">
            Mínimo 12 caracteres. Una frase larga (4–5 palabras separadas por
            espacios) es más segura y más fácil de recordar que una contraseña
            corta con símbolos.
          </p>
        {/if}

        {#if error}<p class="error">{error}</p>{/if}

        <div class="actions">
          <span class="spacer"></span>
          <button type="submit" class="primary" disabled={!canSubmit}>
            {busy ? 'Generando…' : 'Crear clave'}
          </button>
        </div>
      </form>

      <details class="learn-more">
        <summary>¿Cómo funciona?</summary>
        <p>
          Tu contraseña deriva una clave que cifra (a su vez) una clave
          aleatoria de 256 bits, llamada DEK. Esa DEK es la que cifra
          realmente tus datos. Nosotros guardamos en el servidor la DEK
          envuelta, un blob inútil sin tu contraseña.
        </p>
        <p>
          Si pierdes la contraseña, la frase de 12 palabras desbloquea la
          misma DEK. Si pierdes <em>ambas</em>, no hay forma de recuperar
          tus datos. Es el precio de que nadie pueda mirarlos.
        </p>
      </details>
    {:else}
      <h1>Tu frase de recuperación</h1>
      <p class="lead">
        <strong>Solo se muestra una vez.</strong> Cópiala y guárdala donde
        guardas tus contraseñas. Si pierdes la contraseña principal, esta
        frase es la única forma de recuperar tu cuenta.
      </p>

      <div class="mnemonic" aria-label="Frase de recuperación">
        {mnemonic}
      </div>
      <button type="button" class="copy" onclick={() => void copyMnemonic()}>
        {copied ? '✓ Copiada' : 'Copiar al portapapeles'}
      </button>

      <p class="warn">
        ⚠ Si pierdes <em>la contraseña</em> y <em>la frase</em>, tus datos
        no se pueden recuperar. Ni por nosotros ni por nadie. Asegúrate de
        guardarla bien antes de continuar.
      </p>

      <label class="confirm">
        <input type="checkbox" bind:checked={confirmedStored} />
        <span>He guardado mi frase de recuperación en un sitio seguro.</span>
      </label>

      <div class="actions">
        <span class="spacer"></span>
        <button type="button" class="primary" disabled={!confirmedStored} onclick={close}>
          Continuar
        </button>
      </div>
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
    width: min(520px, 92vw);
    max-height: 88vh;
    overflow-y: auto;
    z-index: 96;
    background: var(--bg);
    border: 1px solid color-mix(in oklab, currentColor 14%, transparent);
    border-radius: 0.8rem;
    box-shadow: 0 24px 60px color-mix(in oklab, currentColor 24%, transparent);
    padding: 1.4rem 1.4rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  h1 {
    font-size: 1.3rem;
    font-weight: 500;
    margin: 0;
  }
  .lead {
    margin: 0;
    line-height: 1.55;
    opacity: 0.85;
    font-size: 0.92rem;
  }
  .lead.small {
    font-size: 0.85rem;
    opacity: 0.7;
  }
  .lead strong {
    font-weight: 600;
    opacity: 0.95;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.2rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }
  .row span {
    width: 6rem;
    flex-shrink: 0;
    font-size: 0.85rem;
    opacity: 0.75;
  }
  .row input {
    flex: 1;
    appearance: none;
    background: var(--bg);
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    border-radius: 0.4rem;
    padding: 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.95rem;
    color: inherit;
  }
  .row input:focus {
    outline: 2px solid color-mix(in oklab, currentColor 28%, transparent);
    outline-offset: -1px;
  }
  .hint {
    margin: 0;
    font-size: 0.78rem;
    opacity: 0.65;
  }
  .hint.err {
    color: color-mix(in oklab, #ef4444 70%, currentColor);
    opacity: 1;
  }
  .error {
    margin: 0;
    font-size: 0.82rem;
    color: color-mix(in oklab, #ef4444 70%, currentColor);
  }
  .warn {
    margin: 0.2rem 0 0;
    padding: 0.55rem 0.7rem;
    font-size: 0.83rem;
    line-height: 1.5;
    background: color-mix(in oklab, #fbbf24 10%, transparent);
    border: 1px solid color-mix(in oklab, #fbbf24 35%, transparent);
    border-radius: 0.45rem;
  }
  .mnemonic {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 1rem;
    line-height: 1.6;
    padding: 0.85rem 0.95rem;
    background: color-mix(in oklab, currentColor 6%, transparent);
    border: 1px solid color-mix(in oklab, currentColor 16%, transparent);
    border-radius: 0.5rem;
    user-select: all;
    word-spacing: 0.4em;
  }
  .copy {
    appearance: none;
    background: transparent;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.7rem;
    border-radius: 0.4rem;
    cursor: pointer;
    align-self: flex-start;
  }
  .copy:hover {
    background: color-mix(in oklab, currentColor 6%, transparent);
  }
  .confirm {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    font-size: 0.88rem;
    cursor: pointer;
    padding: 0.45rem 0;
  }
  .confirm input {
    margin-top: 0.15rem;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.2rem;
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
  .learn-more {
    margin-top: 0.4rem;
    font-size: 0.82rem;
    opacity: 0.75;
  }
  .learn-more summary {
    cursor: pointer;
    user-select: none;
  }
  .learn-more p {
    margin: 0.5rem 0 0;
    line-height: 1.5;
  }
  .learn-more p + p {
    margin-top: 0.4rem;
  }
</style>
