<script lang="ts">
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { triplit } from '$lib/triplit';
  import { liveQuery } from '$lib/live-query.svelte';
  import { keyBetween, keyForAppend } from '@gtd/core';
  import type { Item } from '@gtd/schema';
  import BackButton from '$lib/components/BackButton.svelte';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import { isDone, isLive, isTrashed } from '$lib/item-state';
  import { commitItemOutcome, commitItemTitle } from '$lib/item-save';
  import { blurIfEditable, focusNextTabbable } from '$lib/dom-utils';
  import { useItemSync } from '$lib/use-item-sync.svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import { escConfirm, escToast } from '$lib/stores/esc-confirm.svelte';
  import { LIMITS } from '$lib/limits';

  const copy = {
    backHref: '/projects',
    titlePlaceholder: 'Título del proyecto',
    titleAria: 'Título del proyecto',
    outcomePlaceholder: '',
    outcomeAria: 'Resultado del proyecto',
    notFoundHeading: 'Proyecto no encontrado',
    wrongTypeHeading: 'Este ítem no es un proyecto',
    wrongTypeBody:
      'Esta vista es para proyectos (con resultado o sub-acciones). Este ítem es una acción suelta.',
    backLink: 'Volver a proyectos',
  } as const;

  const itemId = $derived(page.params.id);

  // liveQuery re-subscribes when itemId changes (SvelteKit reuses the
  // page component across /projects/a → /projects/b).
  const itemSub = liveQuery<Item>(triplit, () =>
    triplit.query('items').Where('id', '=', itemId).Limit(1),
  );
  const item = $derived((itemSub.results[0] ?? null) as Item | null);

  // Children — ordered by `position` so user-defined order wins. Trashed hidden.
  const childrenSub = liveQuery<Item>(triplit, () =>
    triplit
      .query('items')
      .Where('parent_id', '=', itemId)
      .Where('deleted_at', 'isDefined', false)
      .Order('position', 'ASC'),
  );
  const children = $derived(childrenSub.results.filter((it) => !isTrashed(it)));
  // Post-Musk-3.B: this view is for projects (has children OR `outcome` set).
  // The heuristic matches `lib/projects.ts`.
  const isProjectShell = $derived(
    !!item && ((item.outcome !== undefined && item.outcome !== null) || children.length > 0),
  );

  let title = $state('');
  let outcome = $state('');

  useItemSync(
    () => item,
    (it) => `${it.title}\0${it.outcome ?? ''}`,
    (it) => {
      title = it.title;
      outcome = it.outcome ?? '';
    },
  );

  async function saveTitle() {
    if (!item) return;
    const result = await commitItemTitle(item, title);
    if (result === 'restored') title = item.title;
  }

  async function saveOutcome() {
    if (!item) return;
    await commitItemOutcome(item, outcome);
  }

  async function toggleSequential(value: boolean) {
    if (!item) return;
    await triplit.update('items', item.id, (e) => {
      e.is_sequential = value;
    });
  }

  // The "active" sub-action when the container is sequential: the first child
  // that's neither done nor trashed. Matches what /next uses to decide visibility.
  const isSequential = $derived(item?.is_sequential ?? false);
  const firstActive = $derived(
    isSequential ? (children.find(isLive) ?? null) : null,
  );

  function isDimmed(child: Item): boolean {
    if (!isSequential) return false;
    if (!isLive(child)) return false;
    if (!firstActive) return false;
    return child.id !== firstActive.id;
  }

  // Reorder via fractional indexing — single write per move.
  async function moveChild(idx: number, dir: -1 | 1) {
    const target = children[idx];
    if (!target) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= children.length) return;
    const before = dir === -1 ? (children[idx - 2]?.position ?? null) : (children[idx + 1]?.position ?? null);
    const after = dir === -1 ? (children[idx - 1]?.position ?? null) : (children[idx + 2]?.position ?? null);
    const newPos = keyBetween(before, after);
    await triplit.update('items', target.id, (e) => {
      e.position = newPos;
    });
  }

  // Inline capture for new sub-actions.
  let captureValue = $state('');
  let captureEl = $state<HTMLInputElement | undefined>(undefined);
  let saving = $state(false);

  // Outcome es textarea multi-línea: auto-grow al contenido. `field-sizing`
  // CSS lo haría nativamente pero soporte aún parcial (FF tarda), así que
  // ajustamos height vía $effect cuando cambia `outcome`.
  let outcomeEl = $state<HTMLTextAreaElement | undefined>(undefined);
  $effect(() => {
    // dep: outcome — corre cada vez que el valor cambia (input o sync remoto).
    void outcome;
    const el = outcomeEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  });

  async function captureSave() {
    if (!item) return;
    const t = captureValue.trim();
    if (!t || saving) return;
    saving = true;
    try {
      const lastKey = children.at(-1)?.position ?? null;
      // Subtareas nacen en `next`, no en `inbox`: si ya están bajo un proyecto
      // es porque ya las has clarificado. Aparecen directamente en /next sin
      // pasar por /process. Doc 40.
      // Triplit 1.x bug: insert con campos Date a veces deja el Date
      // sin encodear (DBDeserializationError al broadcast). Update sí
      // convierte Date → ISO. Separamos: insert sin timestamps,
      // update para stamp `clarified_at`.
      const created = await triplit.insert('items', {
        title: t,
        parent_id: item.id,
        position: keyForAppend(lastKey),
      });
      if (created?.id) {
        await triplit.update('items', created.id, (e) => {
          e.clarified_at = new Date();
        });
      }
      captureValue = '';
      void tick().then(() => captureEl?.focus());
    } catch (err) {
      console.error('[project capture] failed:', err);
    } finally {
      saving = false;
    }
  }

  function captureKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void captureSave();
    }
  }

  // Tab dentro de outcome avanza al siguiente field (modo segmentado +
  // lista). El default del textarea (insertar \t) no aporta en este flow.
  function outcomeKey(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      focusNextTabbable(e.shiftKey ? -1 : 1);
    }
  }

  const doneCount = $derived(children.filter(isDone).length);
  const totalCount = $derived(children.length);

  // Esc en dos toques (patrón canónico, idéntico a /process):
  //   1ª Esc — blur si hay input focused + arma + toast "pulsa otra vez".
  //   2ª Esc (en < 2.5s) — navega a Proyectos. Si no se confirma, el arm
  //   decae solo. Click o focus en input lo cancelan también.
  useScope({
    name: 'container-detail',
    bindings: [
      {
        key: 'Escape',
        whileEditing: true,
        description: 'volver',
        handler: (e) => {
          // 1ª Esc en un campo editable: solo blur. No arma el doble-tap
          // para que el usuario salga del input sin penalizar la salida.
          if (blurIfEditable(e.target)) return;
          escConfirm('(dos veces para volver)', () => void goto(copy.backHref));
        },
      },
    ],
  });
</script>

<header class="topbar">
  <BackButton href={copy.backHref} />
  {#if escToast.message}
    <span class="hud-text" role="status" aria-live="polite">{escToast.message}</span>
  {/if}
</header>

<main class="page">
  {#if itemSub.fetching && !item}
    <p class="hint">Cargando…</p>
  {:else if !item}
    <section class="empty">
      <h1>{copy.notFoundHeading}</h1>
      <p>Quizá lo borraste o el enlace está roto.</p>
      <a class="back-link" href={copy.backHref}>{copy.backLink}</a>
    </section>
  {:else if !isProjectShell}
    <section class="empty">
      <h1>{copy.wrongTypeHeading}</h1>
      <p>{copy.wrongTypeBody}</p>
      <a class="back-link" href={copy.backHref}>{copy.backLink}</a>
    </section>
  {:else}
    <div class="input-bar title-bar">
      <input
        class="title"
        bind:value={title}
        onblur={saveTitle}
        placeholder={copy.titlePlaceholder}
        spellcheck="false"
        aria-label={copy.titleAria}
        maxlength={LIMITS.title}
      />
    </div>
    <div class="outcome-wrap">
      <textarea
        bind:this={outcomeEl}
        class="outcome"
        bind:value={outcome}
        onblur={saveOutcome}
        onkeydown={outcomeKey}
        placeholder={copy.outcomePlaceholder}
        spellcheck="false"
        aria-label={copy.outcomeAria}
        maxlength={LIMITS.outcome}
        rows="1"
      ></textarea>
      {#if !outcome}
        <span class="outcome-caret" aria-hidden="true"></span>
      {/if}
    </div>

    <section class="actions-section">
      <header class="section-head">
        <div class="mode-segmented" role="group" aria-label="Modo de ejecución">
          <button
            type="button"
            class="mode-option"
            data-on={!isSequential}
            aria-label="Paralelo"
            aria-pressed={!isSequential}
            title="Paralelo — todas las acciones son accionables a la vez"
            onclick={() => void toggleSequential(false)}
          >||</button>
          <button
            type="button"
            class="mode-option"
            data-on={isSequential}
            aria-label="Secuencial"
            aria-pressed={isSequential}
            title="Secuencial — solo la próxima acción es accionable"
            onclick={() => void toggleSequential(true)}
          >|</button>
        </div>
        {#if totalCount > 0}
          <span class="progress">{doneCount} / {totalCount}</span>
        {/if}
      </header>

      {#if !children.length}
        <p class="empty-actions">Sin acciones aún. Captura la primera abajo.</p>
      {:else}
        <ul class="list">
          {#each children as child, idx (child.id)}
            <ItemRow
              item={child}
              dim={isDimmed(child)}
              onMoveUp={() => moveChild(idx, -1)}
              onMoveDown={() => moveChild(idx, 1)}
              canMoveUp={idx > 0}
              canMoveDown={idx < children.length - 1}
            />
          {/each}
        </ul>
      {/if}

      <div class="capture">
        <input
          bind:this={captureEl}
          bind:value={captureValue}
          onkeydown={captureKey}
          type="text"
          placeholder=""
          aria-label="Capturar nueva acción (Enter)"
          autocomplete="off"
          spellcheck="false"
          maxlength={LIMITS.title}
        />
      </div>
    </section>
  {/if}
</main>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    /* padding-top vive en `.page-shell` (layout). */
    padding: 0 var(--container-pad-x) var(--space-4);
  }
  .hud-text {
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1;
  }
  .page {
    width: 100%;
    max-width: var(--container-max);
    margin: 0 auto var(--space-8);
    padding: 0 var(--container-pad-x);
    display: flex;
    flex-direction: column;
  }
  .empty {
    text-align: center;
    padding: var(--space-8) var(--space-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }
  .empty h1 {
    font-size: var(--text-lg);
    font-weight: var(--weight-medium);
    margin: 0;
  }
  .empty p {
    color: var(--text-secondary);
    margin: 0;
  }
  .back-link {
    margin-top: var(--space-3);
    color: var(--text-secondary);
    text-decoration: underline;
    text-decoration-color: var(--border-default);
    text-underline-offset: 3px;
  }
  .back-link:hover {
    color: var(--text-primary);
    text-decoration-color: currentColor;
  }
  .hint {
    text-align: center;
    color: var(--text-muted);
  }
  /* Reusa .input-bar global (appearance.css). Sólo ajusta margen y la
     tipografía del input interior (título 2xl + medium). */
  .title-bar {
    margin-bottom: var(--space-2);
  }
  .title {
    font-size: var(--text-xl);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
    line-height: 1.3;
  }
  /* Outcome ahora es textarea multi-línea con auto-grow vía JS (effect
     en el script ajusta scrollHeight). Sin resize handle, sin scrollbar
     porque el height sigue al contenido. */
  .outcome-wrap {
    position: relative;
    margin-bottom: var(--space-5);
  }
  .outcome {
    font-size: var(--text-base);
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-secondary);
    padding: 0;
    width: 100%;
    line-height: 1.5;
    font-family: inherit;
    resize: none;
    overflow: hidden;
    min-height: 1.5em;
    display: block;
    caret-color: var(--accent, currentColor);
  }
  /* Notas/outcome sin focus ring: el caret nativo es señal suficiente.
   * Override del :focus-visible global (appearance.css). */
  .outcome:focus,
  .outcome:focus-visible {
    outline: none;
  }
  .title::placeholder {
    color: var(--text-muted);
  }
  /* Caret-ghost: barra fina al inicio que imita el cursor de texto.
   * Mismo patrón que `.notes-caret` en ProcessItem — span vacío de 1px,
   * altura ~1 línea, color sutil (28% del currentColor). El parent
   * `:focus-within` lo oculta para no competir con el caret nativo. */
  .outcome-caret {
    position: absolute;
    left: 0;
    top: 0;
    width: 1px;
    height: 1.15em;
    margin-top: 0.18em;
    background: color-mix(in oklab, currentColor 28%, transparent);
    font-size: var(--text-base);
    line-height: 1.5;
    pointer-events: none;
  }
  .outcome-wrap:focus-within .outcome-caret {
    display: none;
  }
  /* Modo de ejecución: dos íconos || / | (paralelo / secuencial) viven
     dentro de section-head a la izquierda; contador 4/12 a la derecha.
     Tooltip vía `title` explica cada uno. Activo se marca con fondo sutil
     + color primary. */
  .mode-segmented {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .mode-option {
    appearance: none;
    background: transparent;
    border: 0;
    min-width: 2.6em;
    padding: 8px 12px;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 1rem;
    line-height: 1;
    letter-spacing: 0.18em;
    text-align: center;
    /* Compensa el aire que `letter-spacing` deja después del último char
       — sin esto el bloque `||` queda visualmente sesgado a la izquierda
       porque el espacio extra del último palo lo empuja a la derecha. */
    text-indent: 0.18em;
    cursor: pointer;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-float-sm);
    transition: color 80ms, background 80ms, box-shadow 120ms, transform 120ms;
  }
  .mode-option:hover {
    color: var(--text-secondary);
  }
  .mode-option[data-on='true'] {
    color: var(--text-primary);
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
    transform: translateY(1px);
  }
  .actions-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
  /* Header de la sección Acciones: modo a la izquierda, contador a la
     derecha. align-items center para que el progress (eyebrow tipográfico)
     no se descuelgue respecto al box de los botones de modo. */
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .progress {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .empty-actions {
    color: var(--text-muted);
    margin: var(--space-2) 0;
    font-size: var(--text-sm);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    --row-surface: var(--surface-raised);
    --row-radius: var(--radius-md);
    --row-gap: var(--space-2);
    --row-pad-x: var(--space-3);
    --row-shadow-elev: var(--shadow-flat);
    --row-shadow-hover: var(--shadow-sunken-sm);
  }
  /* Captura: input limpio con underline al focus, sin recuadro, sin
     prefix '+', sin texto de placeholder. El icono de vincular vive
     a la derecha como botón de acción secundaria. */
  .capture {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    margin-top: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-float-lg);
    transition: box-shadow 120ms;
  }
  .capture input {
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    padding: 0;
  }
  .capture input::placeholder {
    color: var(--text-muted);
  }
</style>
