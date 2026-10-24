<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { cryptoStore } from '$lib/stores/crypto.svelte';
  import { useScope } from '$lib/keyboard.svelte';

  // Session-only dismissal: hide the banner after the user closes it, but keep
  // the underlying counter intact (audit 2026-05-09 #3). The counter resets
  // when crypto.reset() runs (logout / session end), at which point we also
  // reset `dismissedAt` so a fresh failure on the next session re-surfaces.
  let dismissedAt = $state(0);
  let detailsOpen = $state(false);

  let count = $derived(cryptoStore.decryptErrors);
  let samples = $derived(cryptoStore.decryptErrorSamples);
  let visible = $derived(count > 0 && count > dismissedAt);

  function dismiss() {
    dismissedAt = count;
    detailsOpen = false;
  }

  function openDetails() {
    detailsOpen = true;
  }

  function closeDetails() {
    detailsOpen = false;
  }

  useScope({
    name: 'decrypt-error-details',
    modal: true,
    active: () => detailsOpen,
    bindings: [
      {
        key: 'Escape',
        whileEditing: true,
        description: 'cerrar',
        handler: closeDetails,
      },
      {
        key: 'Enter',
        whileEditing: true,
        description: 'cerrar',
        handler: closeDetails,
      },
    ],
  });
</script>

{#if visible}
  <div class="banner" role="status" aria-live="polite">
    <span class="text">
      <strong>Aviso:</strong>
      {count}
      {count === 1 ? 'elemento no se ha podido descifrar' : 'elementos no se han podido descifrar'}
    </span>
    {#if samples.length > 0}
      <button type="button" class="cta" onclick={openDetails}>Ver detalles</button>
    {/if}
    <button type="button" class="close" onclick={dismiss} aria-label="Cerrar aviso">×</button>
  </div>
{/if}

{#if detailsOpen}
  <div
    class="backdrop"
    role="presentation"
    onclick={closeDetails}
    transition:fade={{ duration: 100 }}
  ></div>
  <div
    class="modal"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="decrypt-errors-title"
    transition:scale={{ duration: 130, start: 0.96, opacity: 0 }}
  >
    <h2 id="decrypt-errors-title">Errores de descifrado</h2>
    <p>
      {count}
      {count === 1 ? 'elemento' : 'elementos'} no se {count === 1 ? 'ha' : 'han'} podido descifrar
      en esta sesión. Esto puede pasar si la frase de respaldo cambió o si la base local
      contiene datos antiguos.
    </p>
    {#if samples.length > 0}
      <ul class="samples">
        {#each samples as s (s.collection + s.id + s.field)}
          <li>
            <code>{s.collection}</code> · <code>{s.id}</code> ·
            <span class="field">{s.field}</span>
          </li>
        {/each}
      </ul>
      {#if count > samples.length}
        <p class="more">
          Y {count - samples.length} más (sólo guardamos las primeras {samples.length}).
        </p>
      {/if}
    {/if}
    <div class="row">
      <button type="button" class="confirm" onclick={closeDetails}>Cerrar</button>
    </div>
    <p class="hint"><kbd>Esc</kbd> o <kbd>↵</kbd> cerrar</p>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.4rem 0.9rem;
    font-size: 0.8rem;
    background: color-mix(in oklab, #ef4444 14%, var(--bg));
    border-bottom: 1px solid color-mix(in oklab, #ef4444 35%, transparent);
    text-align: center;
  }
  .text {
    flex: 1;
    text-align: right;
  }
  .cta {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0;
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    color: inherit;
    cursor: pointer;
    flex-shrink: 0;
  }
  .cta:hover {
    opacity: 0.75;
  }
  .close {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0 0.1rem;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0.5;
    color: inherit;
    flex-shrink: 0;
  }
  .close:hover {
    opacity: 1;
  }
  @media (max-width: 480px) {
    .text {
      text-align: center;
    }
    .banner {
      flex-wrap: wrap;
      gap: 0.3rem;
    }
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 80;
  }
  .modal {
    position: fixed;
    top: 18vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, 92vw);
    max-height: 70vh;
    overflow-y: auto;
    z-index: 90;
    background: var(--bg);
    border: 1px solid color-mix(in oklab, currentColor 16%, transparent);
    border-radius: 0.7rem;
    box-shadow: 0 24px 60px color-mix(in oklab, currentColor 25%, transparent);
    padding: 1.1rem 1.2rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  h2 {
    margin: 0;
    font-size: 1.02rem;
    font-weight: 600;
  }
  p {
    margin: 0;
    opacity: 0.78;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .samples {
    margin: 0.3rem 0 0;
    padding: 0.5rem 0.7rem;
    list-style: none;
    background: color-mix(in oklab, currentColor 5%, transparent);
    border-radius: 0.45rem;
    font-size: 0.78rem;
    line-height: 1.6;
    max-height: 32vh;
    overflow-y: auto;
  }
  .samples li {
    border-bottom: 1px solid color-mix(in oklab, currentColor 8%, transparent);
    padding: 0.18rem 0;
  }
  .samples li:last-child {
    border-bottom: 0;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.74rem;
    opacity: 0.85;
  }
  .field {
    font-style: italic;
    opacity: 0.7;
  }
  .more {
    font-size: 0.78rem;
    opacity: 0.6;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.6rem;
    justify-content: flex-end;
  }
  .confirm {
    appearance: none;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.88rem;
    padding: 0.4rem 0.85rem;
    border-radius: 0.45rem;
    cursor: pointer;
    transition: background 80ms, border-color 80ms;
  }
  .confirm:hover {
    background: color-mix(in oklab, currentColor 7%, transparent);
  }
  .hint {
    text-align: center;
    margin-top: 0.3rem;
    font-size: 0.7rem;
    opacity: 0.5;
  }
  kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    border-radius: 0.3rem;
    padding: 0.05rem 0.32rem;
    margin: 0 0.05rem;
    font-size: 0.68rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .modal,
    .backdrop {
      transition: none !important;
    }
  }
</style>
