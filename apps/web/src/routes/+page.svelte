<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { useQuery } from '@triplit/svelte';
  import { triplit } from '$lib/triplit';
  import { useScope } from '$lib/keyboard.svelte';
  import { applyStateTransition, isInbox, isReminderPending } from '$lib/item-state';
  import { blurIfEditable } from '$lib/dom-utils';
  import { now } from '$lib/stores/now.svelte';
  import type { Item } from '@gtd/schema';
  import { EMPTY } from '$lib/copy';
  import CaptureBar from '$lib/components/CaptureBar.svelte';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import ReminderPrompt from '$lib/components/ReminderPrompt.svelte';

  // Inbox = items sin `clarified_at`, top-level (sin parent), newest first.
  // Cargamos todo y filtramos client-side por derivedState — sin field `state`.
  const query = triplit
    .query('items')
    .Where('deleted_at', 'isDefined', false)
    .Order('created_at', 'DESC');
  const sub = useQuery(triplit, query);
  // Bandeja oculta items con tickler activo (`remind_at` futuro). Cuando
  // la fecha llega, `isReminderPending` devuelve false y el item reaparece
  // aquí naturalmente como si fuera nuevo (doc 47).
  const items = $derived(
    ((sub.results ?? []) as Item[]).filter(
      (it) => isInbox(it) && !it.parent_id && !isReminderPending(it, now.value),
    ),
  );

  let captureRef = $state<{ focus: () => void } | undefined>(undefined);
  let listEl = $state<HTMLUListElement | undefined>(undefined);
  let selectedIdx = $state<number>(-1);
  let editingId = $state<string | null>(null);
  let reminderTargetId = $state<string | null>(null);

  onMount(() => {
    captureRef?.focus();
  });

  function focusCapture() {
    selectedIdx = -1;
    editingId = null;
    captureRef?.focus();
  }

  // Click fuera de cualquier fila → deselecciona. Evita "fila pegada"
  // tras seleccionar y luego clicar en captura, header o whitespace.
  function onPagePointerDown(e: PointerEvent) {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest('.row')) return;
    if (selectedIdx >= 0) selectedIdx = -1;
  }

  async function trashItem(it: Item) {
    await triplit.update('items', it.id, (entity) => {
      applyStateTransition(entity, 'trashed');
    });
  }

  async function setReminder(itemId: string, date: Date) {
    await triplit.update('items', itemId, (e) => {
      e.remind_at = date;
    });
  }

  async function renameItem(it: Item, newTitle: string) {
    await triplit.update('items', it.id, (entity) => {
      entity.title = newTitle;
    });
    editingId = null;
  }

  // Clamp selection when list shrinks (after trash) and scroll into view.
  $effect(() => {
    if (selectedIdx >= items.length) {
      selectedIdx = items.length - 1;
    }
  });
  $effect(() => {
    if (selectedIdx < 0 || !listEl) return;
    const node = listEl.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  });

  useScope({
    name: 'inbox',
    bindings: [
      { key: 'n', description: 'capturar', handler: focusCapture },
      {
        key: 'p',
        description: 'procesar',
        handler: () => {
          if (items.length) void goto('/process');
        },
      },
      {
        key: 'ArrowDown',
        whileEditing: true,
        hidden: true,
        handler: () => {
          if (editingId) return;
          if (!items.length) return;
          blurIfEditable(document.activeElement);
          const next = selectedIdx < 0 ? 0 : Math.min(selectedIdx + 1, items.length - 1);
          selectedIdx = next;
        },
      },
      {
        key: 'ArrowUp',
        whileEditing: true,
        hidden: true,
        handler: () => {
          if (editingId) return;
          if (selectedIdx <= 0) {
            focusCapture();
            return;
          }
          selectedIdx -= 1;
        },
      },
    ],
  });

  // Selection-active scope: shadow inbox/global bindings only when an item
  // is selected and not being edited. When inactive, Enter falls through
  // to focus capture (see fallback scope below).
  useScope({
    name: 'inbox-selection',
    active: () => selectedIdx >= 0 && !editingId && !reminderTargetId,
    bindings: [
      {
        key: 'Enter',
        description: 'editar título',
        handler: () => {
          const it = items[selectedIdx];
          if (it) editingId = it.id;
        },
      },
      {
        key: 'd',
        description: 'descartar',
        handler: async () => {
          const it = items[selectedIdx];
          if (!it) return;
          await trashItem(it);
        },
      },
      {
        key: 'r',
        description: 'recordar',
        handler: () => {
          const it = items[selectedIdx];
          if (it) reminderTargetId = it.id;
        },
      },
      {
        key: 'Escape',
        hidden: true,
        handler: focusCapture,
      },
    ],
  });

  // Fallback Enter when nothing is selected — keeps the original
  // "press Enter anywhere to focus capture" affordance.
  useScope({
    name: 'inbox-fallback',
    active: () => selectedIdx < 0 && !editingId,
    bindings: [{ key: 'Enter', hidden: true, handler: () => captureRef?.focus() }],
  });

</script>

<svelte:window onpointerdown={onPagePointerDown} />

<main class="page">
  <CaptureBar bind:this={captureRef} onCaptured={focusCapture} />

  {#if reminderTargetId}
    <ReminderPrompt
      onConfirm={async (d) => {
        if (reminderTargetId) await setReminder(reminderTargetId, d);
        reminderTargetId = null;
      }}
      onCancel={() => {
        reminderTargetId = null;
      }}
    />
  {/if}

  {#if sub.fetching && !items.length}
    <p class="hint">Cargando…</p>
  {:else if !items.length && EMPTY.inbox}
    <p class="empty">{EMPTY.inbox}</p>
  {:else}
    <ul class="list cascade" bind:this={listEl}>
      {#each items as item, i (item.id)}
        <ItemRow
          {item}
          idx={i}
          disableOpen
          selected={selectedIdx === i}
          editing={editingId === item.id}
          onRequestEdit={() => {
            selectedIdx = i;
            editingId = item.id;
          }}
          onSubmitEdit={(t) => renameItem(item, t)}
          onCancelEdit={() => {
            editingId = null;
          }}
        />
      {/each}
    </ul>
    {#if items.length > 0}
      <a class="process-cta" href="/process" title="Procesar bandeja [p]" aria-label="Procesar bandeja">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </a>
    {/if}
  {/if}
</main>

<style>
  .page {
    width: 100%;
    max-width: var(--container-max);
    margin: 0 auto;
    /* padding-top vive en `.page-shell` (layout). */
    padding: 0 var(--container-pad-x) var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .empty {
    text-align: center;
    color: var(--text-muted);
    margin: var(--space-7) 0 var(--space-3);
  }
  .hint {
    text-align: center;
    color: var(--text-muted);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .list.cascade {
    --row-surface: var(--surface-raised);
    --row-radius: var(--radius-md);
    --row-gap: var(--space-3);
    --row-pad-x: var(--space-3);
    --row-shadow-elev: var(--shadow-cascade-flat);
    --row-shadow-hover: var(--shadow-sunken-sm);
  }
  /* Botón circular ›. Misma silueta que `.recurring-filter` de /work:
   * tap-target fijo (control-md), border-radius 999px, transparent idle. */
  .process-cta {
    align-self: center;
    margin-top: var(--space-3);
    width: var(--control-md);
    height: var(--control-md);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: var(--text-muted);
    text-decoration: none;
    line-height: 0;
    transition:
      color 80ms,
      background 80ms,
      box-shadow var(--dur-base) ease;
  }
  .process-cta:hover {
    color: var(--text-primary);
    background: var(--press-bg-subtle);
  }
  .process-cta:active {
    color: var(--text-primary);
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
    transform: translateY(1px);
  }
  .process-cta:focus-visible {
    color: var(--text-primary);
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
