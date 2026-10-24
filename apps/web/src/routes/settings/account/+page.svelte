<script lang="ts">
  import { goto } from '$app/navigation';
  import BackButton from '$lib/components/BackButton.svelte';
  import { wipeLocalDatabase } from '$lib/data/wipe-local';
  import { useScope } from '$lib/keyboard.svelte';
  import { formatBytes, quotaPercent, quotas } from '$lib/quotas.svelte';
  import { escConfirm, escToast } from '$lib/stores/esc-confirm.svelte';
  import { session } from '$lib/stores/session.svelte';

  let busy = $state(false);

  // Quotas: fetch on mount when sesión activa. Refresh manual con el botón.
  $effect(() => {
    if (session.ready && session.user) void quotas.refresh();
  });
  let confirmingDelete = $state(false);
  let typedEmail = $state('');
  let wipeLocal = $state(false);
  let deleteError = $state<string | null>(null);
  let emailInputEl = $state<HTMLInputElement | undefined>();

  // Audit 2026-05-09 #2: typed-email confirm + opt-in local wipe.
  const expectedEmail = $derived((session.user?.email ?? '').trim().toLowerCase());
  const typedNorm = $derived(typedEmail.trim().toLowerCase());
  const canDelete = $derived(
    !busy && expectedEmail.length > 0 && typedNorm === expectedEmail,
  );

  async function logout() {
    if (busy) return;
    busy = true;
    await session.signOut();
    goto('/login');
  }

  function startConfirm() {
    if (busy) return;
    confirmingDelete = true;
    typedEmail = '';
    wipeLocal = false;
    deleteError = null;
    queueMicrotask(() => emailInputEl?.focus());
  }

  function cancelDelete() {
    confirmingDelete = false;
    typedEmail = '';
    wipeLocal = false;
    deleteError = null;
  }

  async function submitDelete() {
    if (!canDelete) return;
    busy = true;
    deleteError = null;
    const shouldWipe = wipeLocal;
    try {
      await session.deleteAccount();
      // Local wipe must run BEFORE redirect so the IDB clear actually
      // completes. Server has already cascade-wiped — this only removes
      // zombie rows from the local store (audit 2026-05-09 #2).
      if (shouldWipe) {
        try {
          await wipeLocalDatabase();
        } catch (err) {
          // Don't block redirect: account is gone, surfacing this to a
          // user who's about to be signed out is just noise.
          console.error('[account] local wipe failed', err);
        }
      }
      goto('/login');
    } catch (err) {
      busy = false;
      deleteError =
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar la cuenta. Inténtalo más tarde o contacta a dohkku@dohkku.dev';
    }
  }

  function onEmailKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canDelete) void submitDelete();
    }
  }

  useScope({
    name: 'account-delete-confirm',
    modal: true,
    active: () => confirmingDelete,
    bindings: [
      {
        key: 'Escape',
        whileEditing: true,
        description: 'cancelar',
        handler: () => {
          if (!busy) cancelDelete();
        },
      },
    ],
  });

  // Esc top-level (dos toques): vuelve a /settings. El scope modal de
  // borrado, cuando activo, captura Esc primero (modal: true) y este
  // no se dispara — ese modal sí cancela con un toque.
  useScope({
    name: 'settings-account',
    bindings: [
      {
        key: 'Escape',
        whileEditing: true,
        description: 'volver',
        handler: (e) => {
          const t = e.target as HTMLElement | null;
          if (
            t &&
            (t.tagName === 'INPUT' ||
              t.tagName === 'TEXTAREA' ||
              t.isContentEditable)
          ) {
            (t as HTMLElement).blur();
          }
          escConfirm('(dos veces para volver)', () => void goto('/settings'));
        },
      },
    ],
  });
</script>

<header class="topbar">
  <BackButton href="/settings" ariaLabel="Volver a Ajustes" />
  {#if escToast.message}
    <span class="hud-text" role="status" aria-live="polite">{escToast.message}</span>
  {/if}
</header>

<main class="page">
  {#if !session.ready}
    <p class="loading">Cargando…</p>
  {:else if session.user}
    <section class="card">
      <div class="row">
        <div class="text">
          <h2>Sesión activa</h2>
          <p class="email">{session.user.email}</p>
        </div>
      </div>
    </section>

    {#if quotas.state}
      {@const q = quotas.state}
      {@const pctBytes = quotaPercent(q.bytes_used, q.limits.bytes)}
      {@const pctItems = quotaPercent(q.items_count, q.limits.items)}
      <section class="card">
        <div class="text">
          <h2>Uso</h2>
        </div>
        <div class="usage">
          <div class="usage-row">
            <span class="usage-label">Tareas</span>
            <span class="usage-val">
              {q.items_count.toLocaleString('es-ES')} / {q.limits.items.toLocaleString('es-ES')}
            </span>
          </div>
          <div class="bar" data-warn={pctItems >= 80}>
            <div class="bar-fill" style="width:{pctItems}%"></div>
          </div>
          <div class="usage-row">
            <span class="usage-label">Espacio</span>
            <span class="usage-val">{formatBytes(q.bytes_used)} / {formatBytes(q.limits.bytes)}</span>
          </div>
          <div class="bar" data-warn={pctBytes >= 80}>
            <div class="bar-fill" style="width:{pctBytes}%"></div>
          </div>
        </div>
      </section>
    {/if}

    <section class="card">
      <div class="text">
        <h2>Cerrar sesión</h2>
        <p class="desc">Sal de esta cuenta en este dispositivo. Tus datos no se borran.</p>
      </div>
      <button type="button" class="btn" onclick={logout} disabled={busy}>
        Cerrar sesión
      </button>
    </section>

    <section class="card danger">
      <div class="text">
        <h2>Eliminar cuenta</h2>
        <p class="desc">
          Borra tu cuenta y todos los datos cifrados en el servidor (tus
          tareas y proyectos). Esta acción no se puede deshacer.
        </p>
      </div>
      {#if confirmingDelete}
        <div class="confirm">
          <p class="confirm-msg">
            Para confirmar, escribe tu email
            <strong>{session.user.email}</strong>:
          </p>
          <input
            bind:this={emailInputEl}
            bind:value={typedEmail}
            type="email"
            class="email-input"
            placeholder={session.user.email}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            disabled={busy}
            onkeydown={onEmailKeydown}
            aria-label="Escribe tu email para confirmar"
          />
          <label class="wipe-toggle">
            <input type="checkbox" bind:checked={wipeLocal} disabled={busy} />
            <span>
              Borrar también los datos locales de este dispositivo (IndexedDB,
              caché). Si no marcas esta opción, los datos locales permanecen en
              este navegador hasta que los borres manualmente.
            </span>
          </label>
          {#if deleteError}
            <p class="error-msg" role="alert">{deleteError}</p>
          {/if}
          <div class="btn-row">
            <button type="button" class="btn ghost" onclick={cancelDelete} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn red"
              onclick={submitDelete}
              disabled={!canDelete}
            >
              {busy ? 'Eliminando…' : 'Eliminar cuenta'}
            </button>
          </div>
          <p class="kbd-hint"><kbd>Esc</kbd> cancelar · <kbd>↵</kbd> confirmar</p>
        </div>
      {:else}
        <button type="button" class="btn red-ghost" onclick={startConfirm} disabled={busy}>
          Eliminar cuenta
        </button>
      {/if}
    </section>
  {:else}
    <section class="card">
      <p class="desc">No has iniciado sesión.</p>
      <a class="btn" href="/login">Ir a inicio de sesión</a>
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
    max-width: 720px;
    margin: 0.4rem auto 4rem;
    padding: 0 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .loading {
    opacity: 0.5;
    font-size: 0.9rem;
    padding: 1rem 0;
  }
  .card {
    border: 1px solid color-mix(in oklab, currentColor 8%, transparent);
    border-radius: 0.6rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .card.danger {
    border-color: color-mix(in oklab, #f87171 30%, transparent);
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }
  .text { flex: 1; min-width: 0; }
  h2 {
    margin: 0 0 0.2rem;
    font-size: 1rem;
    font-weight: 500;
  }
  .email {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.65;
  }
  .desc {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.65;
    line-height: 1.45;
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .confirm-msg {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .confirm-msg strong {
    font-weight: 600;
    word-break: break-all;
  }
  .email-input {
    appearance: none;
    width: 100%;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    background: color-mix(in oklab, currentColor 4%, transparent);
    color: inherit;
    font: inherit;
    font-size: 0.9rem;
    padding: 0.5rem 0.7rem;
    border-radius: 0.4rem;
  }
  .email-input:focus {
    outline: 2px solid color-mix(in oklab, #f87171 45%, transparent);
    outline-offset: 1px;
    border-color: color-mix(in oklab, #f87171 45%, transparent);
  }
  .email-input:disabled {
    opacity: 0.6;
  }
  .wipe-toggle {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.82rem;
    line-height: 1.45;
    opacity: 0.85;
    cursor: pointer;
    user-select: none;
  }
  .wipe-toggle input {
    margin-top: 0.2rem;
    flex-shrink: 0;
  }
  .error-msg {
    margin: 0;
    padding: 0.5rem 0.7rem;
    border-radius: 0.4rem;
    font-size: 0.85rem;
    background: color-mix(in oklab, #f87171 12%, transparent);
    border: 1px solid color-mix(in oklab, #f87171 30%, transparent);
    color: color-mix(in oklab, #f87171 85%, currentColor);
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
    font-size: 0.85rem;
    padding: 0.4rem 0.9rem;
    border-radius: 0.4rem;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    transition: background 70ms;
  }
  .btn:hover:not(:disabled) {
    background: color-mix(in oklab, currentColor 13%, transparent);
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn.ghost {
    background: transparent;
    border-color: color-mix(in oklab, currentColor 15%, transparent);
  }
  .btn.red {
    background: color-mix(in oklab, #f87171 25%, transparent);
    border-color: color-mix(in oklab, #f87171 40%, transparent);
    color: color-mix(in oklab, #f87171 80%, currentColor);
  }
  .btn.red:hover:not(:disabled) {
    background: color-mix(in oklab, #f87171 35%, transparent);
  }
  .btn.red-ghost {
    background: transparent;
    border-color: color-mix(in oklab, #f87171 30%, transparent);
    color: color-mix(in oklab, #f87171 70%, currentColor);
  }
  .btn.red-ghost:hover:not(:disabled) {
    background: color-mix(in oklab, #f87171 10%, transparent);
  }
  .usage {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .usage-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .usage-label {
    opacity: 0.65;
  }
  .usage-val {
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
    opacity: 0.85;
  }
  .bar {
    height: 0.45rem;
    border-radius: 999px;
    background: color-mix(in oklab, currentColor 8%, transparent);
    overflow: hidden;
    margin-bottom: 0.25rem;
  }
  .bar-fill {
    height: 100%;
    background: var(--accent);
    transition: width 200ms ease-out;
  }
  .bar[data-warn='true'] .bar-fill {
    background: color-mix(in oklab, #f59e0b 75%, currentColor);
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
</style>
