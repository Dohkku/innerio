<script lang="ts">
  import { goto } from '$app/navigation';
  import { triplit } from '$lib/triplit';
  import { LIMITS } from '$lib/limits';
  import { orgs } from '$lib/stores/orgs.svelte';
  import { maybeCascadeChildren } from '$lib/cascade';
  import { advanceRecurrence } from '$lib/recurrence';
  import { now } from '$lib/stores/now.svelte';
  import { recurNextLabel } from '$lib/recurrence';
  import { applyStateTransition, isDone as derivedIsDone } from '$lib/item-state';
  import { scrollMarquee } from '$lib/actions/scroll-marquee';
  import { springPress } from '$lib/actions/spring-press.svelte';
  import type { Item } from '@gtd/schema';

  let {
    item,
    parentTitle,
    hideParentCrumb = false,
    showRecurDetails = false,
    dim = false,
    disableOpen = false,
    stalled = false,
    selected = false,
    editing = false,
    idx,
    onMoveUp,
    onMoveDown,
    onSubmitEdit,
    onCancelEdit,
    onRequestEdit,
    canMoveUp = false,
    canMoveDown = false,
    isProject: isProjectProp,
  }: {
    item: Item;
    parentTitle?: string;
    hideParentCrumb?: boolean;
    /**
     * Cuando es un recurrente, los detalles extra (parent-tag + próxima
     * ocurrencia) se silencian por defecto — solo el pill ↻ los delata.
     * El bucket "Recurrentes" en /work pasa `true` para devolverlos.
     */
    showRecurDetails?: boolean;
    dim?: boolean;
    disableOpen?: boolean;
    stalled?: boolean;
    selected?: boolean;
    editing?: boolean;
    idx?: number;
    onMoveUp?: () => void | Promise<void>;
    onMoveDown?: () => void | Promise<void>;
    onSubmitEdit?: (newTitle: string) => void | Promise<void>;
    onCancelEdit?: () => void;
    /**
     * When the row is non-navigable (`disableOpen`), clicking the title
     * triggers this callback instead of being a no-op. Inbox uses it to
     * enter edit mode on click — same affordance as Enter on selection.
     */
    onRequestEdit?: () => void;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    isProject?: boolean;
  } = $props();

  let draft = $state('');
  let editEl = $state<HTMLInputElement | undefined>(undefined);

  $effect(() => {
    if (editing) {
      draft = item.title;
      queueMicrotask(() => {
        editEl?.focus();
      });
    }
  });

  function onEditKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const next = draft.trim();
      if (next && next !== item.title) {
        void onSubmitEdit?.(next);
      } else {
        onCancelEdit?.();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancelEdit?.();
    }
  }

  function onEditBlur(): void {
    if (!editing) return;
    const next = draft.trim();
    if (next && next !== item.title) {
      void onSubmitEdit?.(next);
    } else {
      onCancelEdit?.();
    }
  }

  let hasReorder = $derived(Boolean(onMoveUp || onMoveDown));
  // `.open` queda inerte solo si está disableOpen Y no hay handler de
  // edición por click. La bandeja activa edición; otras vistas con
  // disableOpen (si llegaran) siguen siendo no-interactivas.
  let openInert = $derived(disableOpen && !onRequestEdit);

  let isDone = $derived(derivedIsDone(item));
  let isProject = $derived(isProjectProp ?? (orgs.isProjectMap.get(item.id) ?? false));
  let isRecurring = $derived(item.recurrence != null);

  async function toggle() {
    if (isDone) {
      // Reabrir: los proyectos y los eventos de calendario (tienen start_at,
      // ya están "agendados") vuelven a "next"; las acciones sueltas vuelven a
      // Bandeja para reclasificar.
      const target = isProject || item.start_at ? 'next' : 'inbox';
      await triplit.update('items', item.id, (entity) => {
        applyStateTransition(entity, target);
      });
      return;
    }

    // Recurrentes: avanzan in-place (no cascade, no transición a done).
    // El item se queda en "next" con due_at desplazado a la próxima
    // ocurrencia. Ver advanceRecurrence en $lib/recurrence.
    if (await advanceRecurrence(item)) {
      return;
    }

    await maybeCascadeChildren(item, 'done');
    await triplit.update('items', item.id, (entity) => {
      applyStateTransition(entity, 'done');
    });
  }

  async function trash() {
    await maybeCascadeChildren(item, 'trashed');
    await triplit.update('items', item.id, (entity) => {
      applyStateTransition(entity, 'trashed');
    });
  }

  async function returnToInbox() {
    await triplit.update('items', item.id, (entity) => {
      applyStateTransition(entity, 'inbox');
    });
  }

  // Tecla rápida 'b' sobre el botón `.open` (el tabstop principal de la fila):
  // devuelve el item a Bandeja sin cascada (los hijos no se mueven; el padre
  // se des-clarifica). Skip cuando el `<input>` de edición inline tiene el
  // foco — ese caso lo cubre `onEditKey`.
  function rowKey(e: KeyboardEvent) {
    if (editing) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== 'b') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    e.stopPropagation();
    void returnToInbox();
  }

  function openItem() {
    if (disableOpen) {
      onRequestEdit?.();
      return;
    }
    // Cada item tiene página dedicada: proyectos → /projects/{id} (con
    // sub-acciones inline); acciones/refs/notas → /items/{id} (InspectorPanel
    // a pantalla completa).
    if (isProject) {
      void goto(`/projects/${item.id}`);
    } else {
      void goto(`/items/${item.id}`);
    }
  }
</script>

<li class="row" class:done={isDone} class:dim class:selected data-idx={idx ?? undefined}>
  <button
    class="check"
    type="button"
    onclick={toggle}
    aria-label={isDone ? 'Reabrir' : 'Completar'}
    tabindex={disableOpen ? -1 : 0}
    use:springPress
  >
    <span class="check-disc" data-checked={isDone}>
      <svg
        class="check-mark"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  </button>

  <button
    class="open"
    class:inert={openInert}
    type="button"
    onclick={openItem}
    onkeydown={rowKey}
    aria-label={openInert ? undefined : disableOpen ? 'Editar' : 'Abrir'}
    tabindex={openInert ? -1 : 0}
  >
    {#if stalled}
      <span class="badge stalled" title="Sin actividad o sin próxima acción" aria-label="Estancado"
        >Estancado</span
      >
    {/if}
    <span class="text">
      {#if editing}
        <input
          class="title-input"
          bind:this={editEl}
          bind:value={draft}
          onkeydown={onEditKey}
          onblur={onEditBlur}
          onclick={(e) => e.stopPropagation()}
          maxlength={LIMITS.title}
        />
      {:else}
        <span class="title" use:scrollMarquee><span class="title-inner">{item.title}</span></span>
      {/if}
    </span>
    {#if parentTitle && !hideParentCrumb && (!isRecurring || showRecurDetails)}
      <span class="parent-tag" title={parentTitle}>{parentTitle}</span>
    {/if}
    {#if isRecurring && !isDone && showRecurDetails}
      {@const nextLabel = recurNextLabel(item, now.value)}
      {#if nextLabel}
        <span class="meta recur-next" title="Próxima ocurrencia en Foco">{nextLabel}</span>
      {/if}
    {/if}
  </button>

  {#if isRecurring}
    <span class="recurring-pill" title="Se repite" aria-label="Recurrente">↻</span>
  {/if}

  {#if hasReorder}
    <span class="reorder">
      <button
        class="arrow"
        type="button"
        tabindex={disableOpen ? -1 : 0}
        onclick={() => onMoveUp?.()}
        disabled={!canMoveUp}
        aria-label="Subir"
      >↑</button>
      <button
        class="arrow"
        type="button"
        tabindex={disableOpen ? -1 : 0}
        onclick={() => onMoveDown?.()}
        disabled={!canMoveDown}
        aria-label="Bajar"
      >↓</button>
    </span>
  {/if}

  <button
    class="del"
    type="button"
    onclick={trash}
    aria-label="Borrar"
    title="Borrar"
    tabindex={disableOpen ? -1 : 0}
    use:springPress
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1.2 13a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 6" />
    </svg>
  </button>
</li>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-1);
    /* Lift recipe: parent (.list.lift / .list.cascade) sets surface, radius,
     * gap, and shadow tokens. Default values keep the row flat en vistas que
     * don't opt in (search overlay, inspector, etc.).
     * --row-texture / --row-texture-blend permiten al parent inyectar una
     * imagen (data URI con feTurbulence, dither, etc.) que se mezcla con
     * --row-surface. Bandeja la usa para el grano F11. */
    background-color: var(--row-surface, transparent);
    background-image: var(--row-texture, none);
    background-repeat: repeat;
    background-blend-mode: var(--row-texture-blend, normal);
    border-radius: var(--row-radius, 0);
    margin-bottom: var(--row-gap, 0);
    padding-left: var(--row-pad-x, var(--space-1));
    padding-right: var(--row-pad-x, var(--space-1));
    box-shadow:
      var(--row-shadow-selected, 0 0 transparent),
      var(--row-shadow-elev, 0 0 transparent);
    transition: box-shadow 160ms, transform 60ms ease;
  }
  /* Hover en filas elevadas: swap a una sombra hundida (parece bajar por
   * debajo del estado idle). Sólo activa si el parent definió
   * --row-shadow-hover (vistas planas no se ven afectadas).
   * El row mantiene su hover incluso cuando el cursor está sobre un botón
   * embebido (check, del, arrows). Los botones suman su propio feedback
   * visual encima (ver `.check:hover` y `.del:hover`). */
  .row:has(.open:not(.inert)):hover {
    box-shadow:
      var(--row-shadow-selected, 0 0 transparent),
      var(--row-shadow-hover, var(--row-shadow-elev, 0 0 transparent));
  }
  /* Press del .open (título): el slot envuelve título + parent-tag con
   * border-radius pequeño. El press global pintaría un inset shadow
   * apretado alrededor del texto. Lo neutralizamos ahí y promovemos el
   * efecto al row entero vía :has() — la fila se hunde como unidad,
   * que es el gesto natural de "abrir" todo el item.
   * Incluye .open.inert (bandeja pasa disableOpen): no navega pero el
   * press sigue dando feedback de row. */
  .open:active {
    transform: none;
    box-shadow: none;
  }
  .row:has(.open:not(.inert):active) {
    box-shadow:
      var(--row-shadow-selected, 0 0 transparent),
      var(--shadow-inset-sm);
    transform: translateY(1px);
    transition: box-shadow 80ms ease, transform 60ms ease;
  }
  /* Press del .check: el botón recibe el press global del CSS, lo
   * anulamos para que solo el .check-disc se hunda (via springPress).
   * El spring escribe `--y` en el botón cada frame; el disc lo lee con
   * `transform: translateY(var(--y))`. La inset-shadow durante press
   * sigue declarada vía `:active:hover` (visualización del "hundido").
   * `:active:hover` (no solo `:active`) cancela visualmente si haces
   * drag-out con el botón pulsado — Chrome mantiene :active hasta
   * mouseup aunque salgas. */
  .check:active {
    transform: none;
    box-shadow: none;
  }
  .check:active:hover .check-disc {
    box-shadow: var(--shadow-inset-sm);
    transition: background 80ms ease, box-shadow 80ms ease;
  }
  .row.done .title {
    text-decoration: line-through;
    opacity: 0.4;
  }
  .row.dim {
    opacity: 0.4;
  }
  /* Selección: la fila parece elevada (sombra flotante) sobre el resto.
   * Sustituye el inset border antiguo. La motion la maneja box-shadow
   * solo — no transladamos el row porque rompería el press feedback. */
  .row.selected {
    --row-shadow-elev: var(--shadow-float-sm);
  }
  .title-input {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
    padding: 0;
    flex: 1;
    min-width: 0;
    outline: none;
  }
  /* Check: slot fijo 1.4rem para que no haya layout-shift entre idle
     (invisible), hover (✓ outline muted) y done (✓ filled disc).
     Discoverability via hover-row revela la marca; en touch (sin hover)
     queda siempre tenuemente visible. */
  .check {
    appearance: none;
    background: transparent;
    border: 0;
    cursor: pointer;
    padding: 0;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .check-disc {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 999px;
    background: var(--surface-raised);
    box-shadow: var(--shadow-float-sm);
    /* Motion driven por springPress: el botón padre escribe `--y` cada
     * frame y el disc lo aplica. Sin transition CSS sobre transform —
     * el spring es la fuente de verdad. Background/shadow siguen
     * lineales para los toggles de estado (checked, press). */
    transform: translateY(var(--y, 0px));
    transition: background 80ms ease, box-shadow 120ms ease;
  }
  /* Check-mark: ligeramente visible en idle (0.3) para discoverability,
   * sube a 0.7 en row-hover o check-hover. Antes era 0 idle — el botón
   * de completar quedaba completamente invisible hasta hover. */
  .check-mark {
    opacity: 0.3;
    color: var(--text-muted);
    transition: opacity 80ms, color 80ms;
  }
  .row:hover .check-mark,
  .check:hover .check-mark,
  .check:focus-visible .check-mark {
    opacity: 0.7;
  }
  /* Hover propio del check: el spring ya baja 1px en hover (springPress
   * hoverY=1). Aquí solo subimos la opacidad del check-mark. */
  .check:hover .check-mark {
    opacity: 0.95;
  }
  /* Estado checked: se queda 1px hundido sumado al --y del spring.
   * En reposo (--y = 0px) lee como bevel-down persistente; bajo press
   * suma con el spring sin perder el offset base. */
  .check-disc[data-checked='true'] {
    background: color-mix(in oklab, currentColor 32%, transparent);
    box-shadow: var(--shadow-inset-sm);
    transform: translateY(calc(var(--y, 0px) + 1px));
  }
  .check-disc[data-checked='true'] .check-mark {
    opacity: 1;
    color: var(--bg);
  }
  @media (hover: none) {
    .check-mark {
      opacity: 0.4;
    }
    .check-disc[data-checked='true'] .check-mark {
      opacity: 1;
    }
  }
  .open {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.15rem 0.3rem;
    margin: -0.15rem -0.3rem;
    border-radius: var(--radius-sm);
    text-align: left;
    min-width: 0;
    font: inherit;
    transition: background 70ms;
  }
  .open:not(.inert):hover {
    background: transparent;
  }
  .open:not(.inert):focus-visible {
    outline: 2px solid var(--border-mix-strong);
    outline-offset: 1px;
  }
  .open.inert {
    cursor: default;
  }
  .open.inert:focus,
  .open.inert:focus-visible {
    outline: none;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    overflow: hidden;
  }
  .title {
    overflow: hidden;
    white-space: nowrap;
    min-width: 0;
    /* Hold-to-scroll en touch: matamos el magnifier/callout de iOS y la
     * selección de texto. Sin esto, mantener pulsado dispara el menú
     * nativo de copiar y arruina el gesto. `touch-action: pan-y` deja
     * que la lista siga scrolleando vertical mientras pinchas un row. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: pan-y;
  }
  .title-inner {
    display: inline-block;
    white-space: nowrap;
  }
  /* Pista del proyecto padre: anotación tipográfica al final del row,
     alineada a la derecha. Truncada a 14ch para que títulos largos no
     desplacen otros chips/recur-next. Tooltip nativo muestra el nombre
     entero. */
  .parent-tag {
    font-size: var(--text-xs);
    color: var(--text-muted);
    flex-shrink: 0;
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-left: auto;
  }
  .badge {
    flex-shrink: 0;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: var(--text-xxs);
    font-weight: var(--weight-semibold);
    line-height: 1;
    padding: 0.18rem 0.32rem;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    letter-spacing: 0.04em;
  }
  .badge.stalled {
    font-family: inherit;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-secondary);
    border-color: var(--border-default);
    border-style: dashed;
  }
  /* Pill recurrente: indicador "esta tarea se repite" pegado al extremo
   * derecho del row (después del slot .open con flex:1). Sin borde — el
   * peso visual lo dan press-bg + inset shadow, mismo lenguaje que los
   * estados "on" de toggles (recurring-filter en /work). */
  .recurring-pill {
    flex-shrink: 0;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: var(--text-sm);
    line-height: 1;
    padding: 0.25rem 0.45rem;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    background: var(--press-bg-subtle);
    box-shadow: var(--shadow-inset-sm);
  }
  .meta {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .meta.recur-next {
    color: var(--text-muted);
  }
  .reorder {
    display: inline-flex;
    gap: 0.05rem;
    flex-shrink: 0;
  }
  .arrow {
    appearance: none;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: inherit;
    opacity: 0.45;
    padding: 0.1rem 0.3rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    line-height: 1;
    transition: opacity 80ms, background 80ms;
  }
  .arrow:not(:disabled):hover {
    opacity: 0.95;
    background: var(--hover-bg-medium);
  }
  .arrow:not(:disabled):active {
    background: var(--press-bg-medium);
  }
  .arrow:disabled {
    opacity: 0.15;
    cursor: not-allowed;
  }
  /* Borrar: icono SVG sutil, invisible en idle. Aparece on-hover del row
     o cuando recibe foco por teclado. Slot 2rem para que el icono no
     parezca microscópico relativo a la altura del row. */
  .del {
    appearance: none;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: var(--text-muted);
    opacity: 0;
    padding: var(--space-1);
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    /* Motion via springPress (--y). Sin transition CSS sobre transform. */
    transform: translateY(var(--y, 0px));
    transition: opacity 80ms, color 80ms, background 80ms;
  }
  .row:hover .del,
  .del:focus-visible {
    opacity: 1;
  }
  .del:hover {
    color: var(--text-primary);
    background: var(--hover-bg-medium);
  }
  /* Press: solo bg + inset shadow (la translateY la lleva springPress).
   * `:active:hover` para que el feedback se cancele en drag-out. */
  .del:active {
    transform: translateY(var(--y, 0px));
    box-shadow: none;
  }
  .del:active:hover {
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
  }
  /* Móvil estrecho: parent-tag más corto, recur-next compacto. */
  @media (max-width: 30rem) {
    .parent-tag {
      max-width: 8ch;
    }
    .meta.recur-next {
      font-size: 0.68rem;
    }
  }
  /* Pantallas sin hover (touch): el botón borrar y las flechas viven
     "siempre algo visibles" en vez de aparecer en hover (que no existe).
     Reorder oculto en touch: gestos > flechas microscópicas. */
  @media (hover: none) {
    .del {
      opacity: 0.45;
    }
    .reorder {
      display: none;
    }
  }
  /* Touch coarse: targets ≥40px para check + del. */
  @media (pointer: coarse) {
    .check {
      width: 2.2rem;
      height: 2.2rem;
    }
    .del {
      width: 2.2rem;
      height: 2.2rem;
    }
  }
</style>
