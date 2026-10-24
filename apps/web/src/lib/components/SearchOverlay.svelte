<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { triplit } from '$lib/triplit';
  import { liveQuery } from '$lib/live-query.svelte';
  import { search, close as closeSearch } from '$lib/stores/search.svelte';
  import { orgs } from '$lib/stores/orgs.svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import { LIMITS } from '$lib/limits';
  import { stateLabel } from '$lib/methodology-static';
  import { derivedState, isDone, isTrashed } from '$lib/item-state';
  import type { Item } from '@gtd/schema';

  // Input + debounce: keep typing snappy, run the actual query at most every 80ms.
  let q = $state('');
  let debouncedQ = $state('');
  let inputEl = $state<HTMLInputElement | undefined>();
  let highlighted = $state(0);

  $effect(() => {
    const value = q;
    const t = setTimeout(() => {
      debouncedQ = value;
    }, 80);
    return () => clearTimeout(t);
  });

  // Reset transient state when the overlay opens / closes.
  $effect(() => {
    if (search.open) {
      // Defer to next tick so transition can apply before focus.
      setTimeout(() => inputEl?.focus(), 0);
    } else {
      q = '';
      debouncedQ = '';
      highlighted = 0;
    }
  });

  // Under E2EE the server stores `title` / `notes` as ciphertext envelopes,
  // so server-side `like '%term%'` filtering returns garbage matches against
  // the encoded base64. Subscribe to all non-trashed items (the Triplit
  // wrapper decrypts on read) and filter client-side. For typical inboxes
  // (≤ a few thousand items) this is fast enough; if scale becomes a
  // concern later, add a worker-side index keyed off the decrypted titles.
  const sub = liveQuery<Item>(triplit, () => {
    if (!search.open) return null;
    return triplit.query('items').Order('updated_at', 'DESC');
  });

  const results = $derived.by(() => {
    const term = debouncedQ.trim().toLowerCase();
    if (!term) return [] as Item[];
    const all = sub.results ?? [];
    const matched: Item[] = [];
    for (const it of all) {
      if (isTrashed(it)) continue;
      const title = (it.title ?? '').toLowerCase();
      const notes = (it.notes ?? '').toLowerCase();
      if (title.includes(term) || notes.includes(term)) {
        matched.push(it);
        if (matched.length >= 50) break;
      }
    }
    return matched;
  });

  // Snap highlight back to top whenever the result set changes shape.
  $effect(() => {
    void results.length;
    highlighted = 0;
  });

  function selectItem(item: Item) {
    closeSearch();
    if (orgs.isProjectMap.get(item.id) ?? false) {
      void goto(`/projects/${item.id}`);
    } else {
      void goto(`/items/${item.id}`);
    }
  }

  function moveHighlight(dir: 1 | -1) {
    if (!results.length) return;
    highlighted = (highlighted + dir + results.length) % results.length;
  }

  // Modal scope: blocks fall-through to layout / page scopes underneath. All
  // bindings need `whileEditing: true` because focus stays in the input.
  useScope({
    name: 'search',
    modal: true,
    active: () => search.open,
    bindings: [
      { key: 'Escape', whileEditing: true, description: 'cerrar', handler: closeSearch },
      {
        key: 'ArrowDown',
        whileEditing: true,
        handler: (e) => {
          e.preventDefault();
          moveHighlight(1);
        },
      },
      {
        key: 'ArrowUp',
        whileEditing: true,
        handler: (e) => {
          e.preventDefault();
          moveHighlight(-1);
        },
      },
      {
        key: 'Enter',
        whileEditing: true,
        handler: () => {
          const r = results[highlighted];
          if (r) selectItem(r);
        },
      },
    ],
  });

</script>

{#if search.open}
  <div
    class="backdrop"
    role="presentation"
    onclick={closeSearch}
    transition:fade={{ duration: 100 }}
  ></div>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Buscar"
    transition:fly={{ y: -10, duration: 130, opacity: 0 }}
  >
    <div class="input-row">
      <span class="prefix">/</span>
      <input
        bind:this={inputEl}
        bind:value={q}
        type="text"
        placeholder="Buscar…"
        autocomplete="off"
        spellcheck="false"
        aria-label="Buscar"
        maxlength={LIMITS.searchQuery}
      />
    </div>
    <div class="results" role="listbox">
      {#if !debouncedQ.trim()}
        <p class="empty">Empieza a escribir…</p>
      {:else if sub.fetching && !results.length}
        <p class="empty">Buscando…</p>
      {:else if !results.length}
        <p class="empty">Sin resultados.</p>
      {:else}
        <ul>
          {#each results as item, idx (item.id)}
            {@const parent = item.parent_id ? orgs.projectById.get(item.parent_id) : null}
            {@const state = derivedState(item)}
            <li>
              <button
                type="button"
                class="result"
                class:active={idx === highlighted}
                class:done={isDone(item)}
                onmouseenter={() => {
                  highlighted = idx;
                }}
                onclick={() => selectItem(item)}
                aria-selected={idx === highlighted}
                role="option"
              >
                <span class="row1">
                  {#if orgs.isProjectMap.get(item.id) ?? false}<span class="badge p">P</span>{/if}
                  <span class="title">{item.title}</span>
                </span>
                <span class="row2">
                  {#if parent}
                    <span class="crumb">{parent.title}</span>
                  {/if}
                  <span class="state-pill" data-state={state}>
                    {stateLabel(state)}
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <p class="hint">↑↓ navegar · ↵ abrir · Esc cerrar</p>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in oklab, currentColor 22%, transparent);
    z-index: 60;
  }
  .modal {
    position: fixed;
    top: 12vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, 92vw);
    max-height: min(70vh, 600px);
    z-index: 70;
    background: var(--bg);
    border: 1px solid color-mix(in oklab, currentColor 14%, transparent);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 50px color-mix(in oklab, currentColor 22%, transparent);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* Móvil: fullscreen — más target tap, results scroll cómodo. */
  @media (max-width: 40rem) {
    .modal {
      top: 0;
      left: 0;
      transform: none;
      width: 100vw;
      height: 100dvh;
      max-height: 100dvh;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }
    .backdrop {
      background: var(--surface-base);
    }
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0.7rem 1rem;
    border-bottom: 1px solid color-mix(in oklab, currentColor 8%, transparent);
  }
  .prefix {
    opacity: 0.4;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: var(--text-md);
  }
  .input-row input {
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--text-md);
    padding: 0.1rem 0;
  }
  .input-row input::placeholder {
    color: color-mix(in oklab, currentColor 40%, transparent);
  }
  .results {
    flex: 1;
    min-height: 3rem;
    overflow-y: auto;
    padding: 0.3rem 0;
  }
  .empty {
    text-align: center;
    opacity: 0.5;
    padding: 1.4rem 1rem;
    margin: 0;
    font-size: 0.9rem;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .result {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    width: 100%;
    padding: 0.55rem 1rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    border-left: 3px solid transparent;
    font: inherit;
  }
  .result.active {
    background: color-mix(in oklab, currentColor 7%, transparent);
    border-left-color: color-mix(in oklab, currentColor 65%, transparent);
  }
  .result.done .title {
    text-decoration: line-through;
    opacity: 0.55;
  }
  .row1 {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    min-width: 0;
  }
  .badge.p {
    font-size: 0.62rem;
    padding: 0.05rem 0.32rem;
    background: color-mix(in oklab, var(--info) 20%, transparent);
    border: 1px solid color-mix(in oklab, var(--info) 50%, transparent);
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .title {
    font-size: var(--text-base);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .row2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.78rem;
    opacity: 0.75;
    flex-wrap: wrap;
  }
  .crumb {
    color: inherit;
    opacity: 0.85;
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .crumb::after {
    content: ' ·';
    margin-left: 0.15rem;
    opacity: 0.6;
  }
  .state-pill {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: 0.7rem;
  }
  .state-pill[data-state='done'] {
    color: var(--text-muted);
    text-decoration: line-through;
    text-decoration-color: var(--border-default);
  }
  .state-pill[data-state='waiting'] {
    border-style: dashed;
  }
  .hint {
    font-size: 0.7rem;
    opacity: 0.45;
    margin: 0;
    padding: 0.5rem 1rem;
    border-top: 1px solid color-mix(in oklab, currentColor 6%, transparent);
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .modal,
    .backdrop {
      transition: none !important;
    }
  }
</style>
