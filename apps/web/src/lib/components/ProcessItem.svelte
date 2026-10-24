<script lang="ts">
  import { tick } from 'svelte';
  import { triplit } from '$lib/triplit';
  import { liveQuery } from '$lib/live-query.svelte';
  import { LIMITS } from '$lib/limits';
  import { focusNextTabbable } from '$lib/dom-utils';
  import type { Item } from '@gtd/schema';
  import SugerirAccion from '$lib/components/SugerirAccion.svelte';

  let { item }: { item: Item } = $props();

  // Local editable copies. Initialised lazily to avoid Svelte's
  // "captures only initial value" warning — we sync via $effect.
  let title = $state('');
  let notes = $state('');
  let lastId = $state<string | undefined>(undefined);
  let lastSyncedTitle = $state<string | undefined>(undefined);
  let lastSyncedNotes = $state<string | undefined>(undefined);
  let editingTitle = $state(false);
  let titleInputEl = $state<HTMLInputElement | null>(null);

  // Cuando el ítem cambia (FIFO de la cola), salimos del modo edición
  // para que el siguiente título se muestre como display directamente.
  $effect(() => {
    if (item.id !== lastId) editingTitle = false;
  });

  async function startEditTitle(): Promise<void> {
    editingTitle = true;
    await tick();
    titleInputEl?.focus();
    titleInputEl?.select();
  }

  async function endEditTitle(): Promise<void> {
    await saveTitle();
    editingTitle = false;
  }

  $effect(() => {
    const remoteNotes = item.notes ?? '';
    // Re-sync when (a) the parent feeds a different item, or (b) any
    // mirrored field changed since the last sync — covers the E2EE
    // boot-race flash where the first emission is ciphertext and the
    // unlock callback re-emits plaintext under the same item.id.
    if (
      item.id !== lastId ||
      item.title !== lastSyncedTitle ||
      remoteNotes !== lastSyncedNotes
    ) {
      lastId = item.id;
      lastSyncedTitle = item.title;
      lastSyncedNotes = remoteNotes;
      title = item.title;
      notes = remoteNotes;
    }
  });

  // Sub-item breadcrumb: when this is a child of a project, fetch the parent's title.
  // `item` changes as the user processes the queue, so we re-subscribe when
  // `item.parent_id` changes via `liveQuery`. Returns null when there is no parent.
  const parentSub = liveQuery<Item>(triplit, () =>
    item.parent_id
      ? triplit.query('items').Where('id', '=', item.parent_id).Limit(1)
      : null,
  );
  const parentTitle = $derived(
    item.parent_id ? (parentSub.results[0] as Item | undefined)?.title : undefined,
  );

  async function saveTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === item.title) return;
    await triplit.update('items', item.id, (e) => {
      e.title = trimmed;
    });
  }

  async function saveNotes() {
    if (notes === (item.notes ?? '')) return;
    await triplit.update('items', item.id, (e) => {
      e.notes = notes;
    });
  }

  // Tab dentro de notas avanza al siguiente field — coherente con el
  // flow lineal de /process (título → notas → fecha → continuar). El
  // default del textarea (insertar tabulación) no aporta aquí.
  function notesKey(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      focusNextTabbable(e.shiftKey ? -1 : 1);
    }
  }
</script>

<header class="head">
  {#if parentTitle}
    <a class="crumb" href={`/projects/${item.parent_id}`}>
      {parentTitle} ·
    </a>
  {/if}
  {#if editingTitle}
    <input
      bind:this={titleInputEl}
      class="title title-input"
      bind:value={title}
      onblur={endEditTitle}
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void endEditTitle();
        }
      }}
      spellcheck="false"
      aria-label="Título"
      maxlength={LIMITS.title}
    />
  {:else}
    <button
      class="title title-display"
      type="button"
      onclick={() => void startEditTitle()}
      aria-label="Editar título"
      title={title}
    >
      <span class="title-text">{title}</span>
    </button>
  {/if}
</header>

<div class="notes-wrap">
  <textarea
    class="notes"
    bind:value={notes}
    onblur={saveNotes}
    onkeydown={notesKey}
    rows="3"
    aria-label="Notas"
    maxlength={LIMITS.notes}
  ></textarea>
  {#if !notes}
    <span class="notes-caret" aria-hidden="true"></span>
  {/if}
</div>

<SugerirAccion {item} />

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 0.2rem;
  }
  .crumb {
    font-size: 0.78rem;
    opacity: 0.6;
    text-decoration: none;
    color: inherit;
    padding-bottom: 0.1rem;
  }
  .crumb:hover {
    opacity: 0.9;
    text-decoration: underline;
  }
  .title {
    font-size: 1.4rem;
    font-weight: var(--weight-medium);
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    line-height: 1.25;
  }
  .title-input:focus {
    outline: 1px solid color-mix(in oklab, currentColor 25%, transparent);
    outline-offset: 4px;
    border-radius: var(--radius-sm);
  }
  .title-display {
    appearance: none;
    cursor: text;
    text-align: left;
    width: 100%;
    display: block;
    overflow: hidden;
    border-radius: var(--radius-sm);
  }
  .title-display:focus {
    outline: none;
  }
  .title-text {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }
  .notes {
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-secondary, inherit);
    padding: 0 0.2rem;
    font: inherit;
    font-size: var(--text-base);
    line-height: 1.5;
    resize: none;
    min-height: 2.4rem;
    width: 100%;
    caret-color: var(--accent, currentColor);
  }
  .notes:focus,
  .notes:focus-visible {
    outline: none;
  }
  .notes-wrap {
    position: relative;
  }
  .notes-caret {
    position: absolute;
    left: 0.2rem;
    top: 0;
    width: 1px;
    height: 1.15em;
    margin-top: 0.18em;
    background: color-mix(in oklab, currentColor 28%, transparent);
    font-size: var(--text-base);
    line-height: 1.5;
    pointer-events: none;
  }
  .notes-wrap:focus-within .notes-caret {
    display: none;
  }
</style>
