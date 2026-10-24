<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { triplit } from '$lib/triplit';
  import { liveQuery } from '$lib/live-query.svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import { LIMITS } from '$lib/limits';
  import { isTrashed } from '$lib/item-state';
  import { keyForAppend } from '@gtd/core';
  import type { Item } from '@gtd/schema';
  import DateInput from './DateInput.svelte';

  let {
    item,
    becameProject = false,
    onDone,
    onCancel,
    onChildCreated,
  }: {
    item: Item;
    becameProject?: boolean;
    onDone: () => void;
    // Esc / "Cancelar" — revierte la clasificación previa (la que abrió
    // este panel) y devuelve el ítem a Bandeja para reprocesar. Distinto
    // de `onDone`, que acepta la clasificación tal cual y avanza.
    onCancel: () => void;
    // Reportan al padre los efectos colaterales sobre hijos para que un
    // posterior `onCancel` pueda revertirlos (hard-delete del creado).
    onChildCreated?: (childId: string) => void;
  } = $props();

  // Local working copy of due_at; commit on Enter.
  let dueAt = $state<Date | null>(null);
  let busy = $state(false);

  onMount(() => {
    dueAt = item.due_at ?? null;
  });

  // Project sub-actions: only when the user just promoted this item to project.
  // Live so newly-added children appear instantly. Children land directamente
  // en `next` (doc 40) — ya están bajo un proyecto, no necesitan re-clarificar.
  const childrenSub = liveQuery<Item>(triplit, () =>
    becameProject
      ? triplit.query('items').Where('parent_id', '=', item.id).Order('position', 'ASC')
      : null,
  );
  const children = $derived(
    becameProject ? childrenSub.results.filter((c) => !isTrashed(c)) : [],
  );

  let actionInput = $state('');
  let actionEl = $state<HTMLInputElement | undefined>(undefined);
  let actionSaving = $state(false);

  // Cuando se promueve a proyecto, el foco arranca en el input de
  // acciones (el gate exige ≥2 antes de avanzar). En el caso normal lo
  // gestiona <DateInput autofocus />.
  onMount(() => {
    if (becameProject) void tick().then(() => actionEl?.focus());
  });

  async function addAction() {
    const t = actionInput.trim();
    if (!t || actionSaving) return;
    actionInput = '';
    actionSaving = true;
    try {
      const lastKey = children.at(-1)?.position ?? null;
      // Subtarea bajo un proyecto → arranca en `next`, no en
      // `inbox`. Doc 40.
      // Triplit 1.x bug: insert con campos Date a veces deja el Date
      // sin encodear (DBDeserializationError al broadcast). El path
      // de update sí convierte Date → ISO correctamente. Separamos:
      // insert sin timestamps, update para stamp `clarified_at`.
      const created = await triplit.insert('items', {
        title: t,
        parent_id: item.id,
        position: keyForAppend(lastKey),
      });
      if (created?.id) {
        await triplit.update('items', created.id, (e) => {
          e.clarified_at = new Date();
        });
        // Reportamos para que cancel revierta este insert (hard-delete).
        onChildCreated?.(created.id);
      }
      void tick().then(() => actionEl?.focus());
    } catch (err) {
      actionInput = t;
      console.error('[clarify-details add action]:', err);
    } finally {
      actionSaving = false;
    }
  }

  function actionKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void addAction();
    }
  }

  function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.getTime() === b.getTime();
  }

  // Cuando acabas de promover un item a proyecto, exigimos ≥2 sub-acciones
  // antes de cerrar/avanzar. Un proyecto con menos de dos pasos no se
  // sostiene como proyecto — o se descompone, o vuelve a ser una acción
  // suelta. Coherente con onboarding (ADR-021).
  const projectGateOpen = $derived(becameProject && children.length < 2);

  async function commitAndDone() {
    if (busy) return;
    if (projectGateOpen) return;
    busy = true;
    try {
      if (!sameDate(item.due_at, dueAt)) {
        await triplit.update('items', item.id, (e) => {
          e.due_at = dueAt ?? undefined;
        });
      }
    } finally {
      busy = false;
      onDone();
    }
  }

  function cancel() {
    onCancel();
  }

  // Modal scope. Enter commits + advances; Esc skips.
  useScope({
    name: 'process-clarify-details',
    modal: true,
    bindings: [
      {
        key: 'Enter',
        description: 'continuar',
        handler: () => void commitAndDone(),
      },
      {
        key: 'Escape',
        description: 'cancelar (a Bandeja)',
        whileEditing: true,
        handler: (e) => {
          const t = e.target as HTMLElement | null;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            (t as HTMLElement).blur();
          }
          cancel();
        },
      },
    ],
  });
</script>

<section class="qp" aria-label="Detalles de la acción">
  <div class="row picker">
    <span class="lbl">Vence</span>
    <div class="date-wrap">
      <DateInput
        value={dueAt}
        onChange={(next) => { dueAt = next ?? null; }}
        onEnter={() => void commitAndDone()}
        ariaLabel="Fecha de vencimiento"
        autofocus={!becameProject}
      />
    </div>
  </div>

  {#if becameProject}
    <div class="row picker actions-block" data-gate={projectGateOpen}>
      <span class="lbl">Acciones</span>
      <div class="actions-list">
        <input
          bind:this={actionEl}
          bind:value={actionInput}
          onkeydown={actionKey}
          placeholder={children.length === 0
            ? 'Acción 1, pulsa Enter'
            : children.length === 1
              ? 'Acción 2 (mínimo), pulsa Enter'
              : '+ Añadir otra acción'}
          aria-label="Nueva acción del proyecto"
          class="action-input"
          maxlength={LIMITS.title}
        />
        {#if children.length}
          <ul class="children">
            {#each children as c (c.id)}
              <li>· {c.title}</li>
            {/each}
          </ul>
        {/if}
        {#if projectGateOpen}
          <p class="actions-hint gate">
            Mínimo <strong>2 acciones</strong>. Un proyecto sin pasos no es
            proyecto. Añade {2 - children.length} más para continuar.
          </p>
        {/if}
      </div>
    </div>
  {/if}

  <div class="row footer">
    <button class="btn skip" type="button" onclick={cancel} title="Devuelve el ítem a Bandeja para reclasificar">
      Cancelar <kbd>Esc</kbd>
    </button>
    <button class="btn primary" type="button" onclick={() => void commitAndDone()} disabled={busy}>
      Continuar <kbd>↵</kbd>
    </button>
  </div>
</section>

<style>
  .qp {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.85rem 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .row.picker {
    align-items: flex-start;
    gap: var(--space-2);
  }
  .row.footer {
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: 0.2rem;
  }
  .lbl {
    font-size: 0.75rem;
    /* Atenuamos vía color, no `opacity`: opacity en el contenedor se
       hereda al panel del InfoTip y lo deja semi-transparente
       (issue: panel ilegible al desplegar el ⓘ). */
    color: color-mix(in oklab, currentColor 60%, transparent);
    flex: 0 0 5.4rem;
    padding-top: 0.35rem;
    display: inline-flex;
    align-items: baseline;
    gap: 0.15rem;
    flex-wrap: nowrap;
  }
  .date-wrap {
    flex: 1 1 auto;
    min-width: 0;
  }
  .action-input {
    appearance: none;
    border: 1px solid color-mix(in oklab, currentColor 14%, transparent);
    background: var(--bg);
    color: inherit;
    font: inherit;
    font-size: 0.82rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius-md);
  }
  .action-input:focus {
    outline: 1px solid color-mix(in oklab, currentColor 30%, transparent);
    outline-offset: 1px;
  }
  .actions-block .actions-list {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .action-input {
    width: 100%;
  }
  .children {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    font-size: 0.84rem;
    opacity: 0.85;
  }
  .actions-hint {
    margin: 0;
    font-size: var(--text-xs);
    opacity: 0.55;
  }
  .actions-hint.gate {
    opacity: 1;
    color: var(--accent);
    font-style: italic;
  }
  .actions-block[data-gate='true'] .action-input {
    border-color: var(--accent);
  }
  .btn {
    padding: 0.35rem 0.7rem;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--text-sm);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .btn:hover:not(:disabled) {
    background: var(--hover-bg-subtle);
  }
  .btn:active:not(:disabled) {
    background: var(--press-bg-subtle);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    border-color: color-mix(in oklab, currentColor 28%, transparent);
    background: var(--press-bg-subtle);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--hover-bg-strong);
  }
  .btn.primary:active:not(:disabled) {
    background: var(--press-bg-strong);
  }
  kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.7rem;
    padding: 0.05rem 0.32rem;
    border: 1px solid var(--border-mix-medium);
    border-radius: var(--radius-sm);
    min-width: 1.1rem;
    text-align: center;
    opacity: 0.75;
  }
  /* Móvil estrecho: label encima del campo, touch targets más altos. */
  @media (max-width: 30rem) {
    .row.picker {
      flex-direction: column;
      align-items: stretch;
      gap: 0.4rem;
    }
    .lbl {
      flex: 0 0 auto;
      padding-top: 0;
    }
    .action-input {
      padding: 0.5rem 0.7rem;
      font-size: 0.9rem;
    }
    .row.footer {
      flex-wrap: wrap;
    }
    .btn {
      padding: 0.55rem 0.9rem;
    }
  }
</style>
