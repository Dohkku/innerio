<script lang="ts">
  import { goto } from '$app/navigation';
  import { useQuery } from '@triplit/svelte';
  import { triplit } from '$lib/triplit';
  import { orgs } from '$lib/stores/orgs.svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import { escConfirm, escToast } from '$lib/stores/esc-confirm.svelte';
  import { maybeCascadeChildren } from '$lib/cascade';
  import { advanceRecurrence } from '$lib/recurrence';
  import { type ClarifyKey, CLARIFY_KEYS, findClarifyKey } from '$lib/methodology-static';
  import { applyStateTransition, isInbox, isReminderPending, isTrashed } from '$lib/item-state';
  import { now } from '$lib/stores/now.svelte';
  import { EMPTY } from '$lib/copy';
  import type { Item } from '@gtd/schema';
  import BackButton from '$lib/components/BackButton.svelte';
  import ProcessItem from '$lib/components/ProcessItem.svelte';
  import DecisionList from '$lib/components/DecisionList.svelte';
  import ReminderPrompt from '$lib/components/ReminderPrompt.svelte';
  import ClarifyQuickPick from '$lib/components/ClarifyQuickPick.svelte';
  import CalendarPrompt from '$lib/components/CalendarPrompt.svelte';

  // Oldest first → fairer queue (FIFO). La queue son los items inbox =
  // derivedState === 'inbox' (sin clarified_at).
  const query = triplit
    .query('items')
    .Where('deleted_at', 'isDefined', false)
    .Order('created_at', 'ASC');
  const sub = useQuery(triplit, query);

  // Skip ephemero: items que el usuario aparca durante esta sesión sin
  // clarificarlos. No muta nada en DB. Al salir y reentrar, vuelven a la
  // cola. Se quita del set si el item llega a procesarse por otra vía.
  let skipped = $state(new Set<string>());

  let items = $derived(
    ((sub.results ?? []) as Item[]).filter((it) => {
      if (!isInbox(it)) return false;
      if (skipped.has(it.id)) return false;
      // Tickler activo: doc 47. El item reaparece cuando remind_at <= hoy.
      if (isReminderPending(it, now.value)) return false;
      // Children of a trashed project shouldn't keep landing in the queue.
      if (it.parent_id) {
        const parent = orgs.projectById.get(it.parent_id);
        if (parent && isTrashed(parent)) return false;
      }
      return true;
    }),
  );
  let current = $derived(items[0]);
  let everShownAnItem = $state(false);
  let processedCount = $state(0);

  $effect(() => {
    if (current && !everShownAnItem) everShownAnItem = true;
  });

  // Scroll al inicio cada vez que cambia el item actual: si el usuario
  // bajó leyendo "Detalles" del anterior, no aterriza a media página.
  let lastSeenItemId = $state<string | null>(null);
  $effect(() => {
    const id = current?.id ?? null;
    if (id !== lastSeenItemId) {
      lastSeenItemId = id;
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  });

  // Undo stack: snapshots of fields we change in clarify.
  // Cuando el item se promueve a proyecto, ClarifyQuickPick puede crear
  // sub-acciones (`createdChildIds`). Si el usuario cancela, hay que
  // deshacer también ese efecto colateral, no solo el padre.
  type Snapshot = {
    itemId: string;
    clarified_at: Date | null | undefined;
    someday_at: Date | null | undefined;
    reference_at: Date | null | undefined;
    outcome: string | null | undefined;
    is_sequential: boolean | null | undefined;
    waiting_for: string | null | undefined;
    waiting_since: Date | null | undefined;
    completed_at: Date | null | undefined;
    deleted_at: Date | null | undefined;
    parent_id: string | null | undefined;
    start_at: Date | null | undefined;
    end_at: Date | null | undefined;
    all_day: boolean | null | undefined;
    tz: string | null | undefined;
    createdChildIds: string[];
  };
  const history: Snapshot[] = [];

  function snapshot(it: Item): Snapshot {
    return {
      itemId: it.id,
      clarified_at: it.clarified_at,
      someday_at: it.someday_at,
      reference_at: it.reference_at,
      outcome: it.outcome,
      is_sequential: it.is_sequential,
      waiting_for: it.waiting_for,
      waiting_since: it.waiting_since,
      completed_at: it.completed_at,
      deleted_at: it.deleted_at,
      parent_id: it.parent_id,
      start_at: it.start_at,
      end_at: it.end_at,
      all_day: it.all_day,
      tz: it.tz,
      createdChildIds: [],
    };
  }

  // Callback que ClarifyQuickPick invoca al crear un hijo. Anexa al
  // snapshot del padre actualmente en panel (el último pushado).
  function trackChildCreated(childId: string) {
    history.at(-1)?.createdChildIds.push(childId);
  }

  let reminderPrompt = $state(false);
  let calendarPrompt = $state(false);
  // The clarify key that triggered the open prompt. Lets us run its
  // side-effects (state change, tag offering) when the user confirms.
  let pendingPromptKey = $state<ClarifyKey | null>(null);
  let busy = $state(false);

  // Holds the just-processed item while the Detalles panel is visible. When
  // set, the queue rendering is frozen on this item so the user sees what
  // they're refining; clearing it advances to the next item. `tagForBecameProject`
  // is true when the user just promoted this item to a project (key with
  // `marks_as_project`) so the panel knows to show the inline sub-action
  // capture — `tagFor` itself is the pre-mutation snapshot.
  let tagFor = $state<Item | null>(null);
  let tagForBecameProject = $state(false);

  function skipCurrent() {
    if (!current || busy || reminderPrompt || calendarPrompt || tagFor) return;
    skipped.add(current.id);
    skipped = new Set(skipped);
  }

  /** A decision is "kept" (worth refining) when it leaves the item alive. */
  function isKept(k: ClarifyKey): boolean {
    return !k.sets_completed_at && !k.sets_deleted_at;
  }

  async function applyDecision(key: string) {
    if (!current || busy) return;
    const def = findClarifyKey(key);
    if (!def) return;

    // Prompt-driven keys defer the actual mutation until confirm.
    if (def.prompt === 'date') {
      pendingPromptKey = def;
      reminderPrompt = true;
      return;
    }
    if (def.prompt === 'datetime') {
      pendingPromptKey = def;
      calendarPrompt = true;
      return;
    }

    await applyClarifyMutation(def);
  }

  // Mutation común para clarify keys: aplica la transición vía timestamps
  // + outcome/is_sequential cuando promueve a proyecto.
  async function applyClarifyMutation(def: ClarifyKey) {
    if (!current) return;
    const snap = snapshot(current);
    const beforeMutation = current;
    busy = true;
    try {
      // Recurrente + tecla "hecho": avanza in-place, salta la transición a
      // done (la siguiente ocurrencia es lo que vale). Igual cuenta como
      // procesado: la Bandeja pasa al siguiente.
      if (def.sets_completed_at && (await advanceRecurrence(current))) {
        history.push(snap);
        processedCount += 1;
        return;
      }
      if (def.sets_completed_at) {
        await maybeCascadeChildren(current, 'done');
      }
      if (def.sets_deleted_at) {
        await maybeCascadeChildren(current, 'trashed');
      }
      const txNow = new Date();
      // marker común: applyStateTransition + opcional marca-proyecto.
      function applyMutation(target: Item | { outcome?: string | null; is_sequential?: boolean; parent_id?: string | undefined }): void {
        if (def.target_state) applyStateTransition(target as Item, def.target_state, txNow);
        if (def.marks_as_project) {
          // Post-Musk-3.B: marcador de "proyecto-shell vacío" es `outcome=''`.
          // Aplicar solo si el usuario aún no escribió su outcome (no pisar).
          // `is_sequential=true` por defecto.
          if (target.outcome === undefined || target.outcome === null) target.outcome = '';
          target.is_sequential = true;
          // Sin sub-proyectos: promover saca del padre, queda standalone.
          target.parent_id = undefined;
        }
      }
      await triplit.update('items', current.id, (e) => applyMutation(e));
      history.push(snap);
      processedCount += 1;
      if (isKept(def)) {
        // tagFor es el snapshot que ClarifyQuickPick usa para inicializar
        // sus pickers. Aplicamos las mismas mutaciones encima del snapshot
        // pre-update para que los chips reflejen el nuevo estado.
        const next: Item = { ...beforeMutation };
        applyMutation(next);
        tagFor = next;
        tagForBecameProject = !!def.marks_as_project;
      }
    } finally {
      busy = false;
    }
  }

  async function confirmReminder(date: Date) {
    if (!current) return;
    const snap = snapshot(current);
    busy = true;
    try {
      // Recordatorio = tickler. NO clarifica el item: queda en bandeja
      // (clarified_at sin setear) pero oculto hasta `remind_at <= hoy`.
      // Cuando la fecha llega, reaparece en /+ y /process para
      // reprocesarse como si fuera nuevo (doc 47).
      await triplit.update('items', current.id, (e) => {
        e.remind_at = date;
      });
      history.push(snap);
      processedCount += 1;
      reminderPrompt = false;
      pendingPromptKey = null;
      // No tagFor: el item se va, no se "refina". Pasa al siguiente.
      tagFor = null;
      tagForBecameProject = false;
    } finally {
      busy = false;
    }
  }

  function cancelReminder() {
    reminderPrompt = false;
    pendingPromptKey = null;
  }

  // Calendar prompt: clarifica a 'next' + stampa start_at/end_at/all_day/tz.
  // El item desaparece de Bandeja y de /work, aparece en /calendar.
  // No abre tagFor: agendado = compromiso de tiempo, no se refina con
  // energy/effort. Pasa directo al siguiente item.
  async function confirmCalendar(payload: { start: Date; end?: Date; allDay: boolean }) {
    if (!current || !pendingPromptKey) return;
    const def = pendingPromptKey;
    const snap = snapshot(current);
    busy = true;
    try {
      const txNow = new Date();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await triplit.update('items', current.id, (e) => {
        if (def.target_state) applyStateTransition(e, def.target_state, txNow);
        e.start_at = payload.start;
        e.end_at = payload.end;
        e.all_day = payload.allDay;
        e.tz = tz;
      });
      history.push(snap);
      processedCount += 1;
      calendarPrompt = false;
      pendingPromptKey = null;
      tagFor = null;
      tagForBecameProject = false;
    } finally {
      busy = false;
    }
  }

  function cancelCalendar() {
    calendarPrompt = false;
    pendingPromptKey = null;
  }

  async function revertSnapshot(snap: Snapshot): Promise<void> {
    busy = true;
    try {
      // 1) Hard-delete de los hijos creados durante la sesión: nunca
      //    existieron desde el punto de vista del usuario.
      for (const id of snap.createdChildIds) {
        try {
          await triplit.delete('items', id);
        } catch (err) {
          console.error('[clarify cancel: delete created child]', id, err);
        }
      }
      // 2) Revertir el padre.
      await triplit.update('items', snap.itemId, (e) => {
        e.clarified_at = snap.clarified_at ?? undefined;
        e.someday_at = snap.someday_at ?? undefined;
        e.reference_at = snap.reference_at ?? undefined;
        e.outcome = snap.outcome ?? undefined;
        e.is_sequential = snap.is_sequential ?? false;
        e.waiting_for = snap.waiting_for ?? undefined;
        e.waiting_since = snap.waiting_since ?? undefined;
        e.completed_at = snap.completed_at ?? undefined;
        e.deleted_at = snap.deleted_at ?? undefined;
        e.parent_id = snap.parent_id ?? undefined;
        e.start_at = snap.start_at ?? undefined;
        e.end_at = snap.end_at ?? undefined;
        e.all_day = snap.all_day ?? undefined;
        e.tz = snap.tz ?? undefined;
      });
      processedCount = Math.max(0, processedCount - 1);
    } finally {
      busy = false;
    }
  }

  // Esc / "Cancelar" en el panel Detalles. La clasificación previa
  // (n/p/s/...) ya mutó el ítem; este handler la revierte y devuelve el
  // ítem a Bandeja. Como la cola es FIFO oldest-first, el mismo ítem
  // reaparece como `current` y el usuario puede reclasificarlo.
  async function cancelClarify(): Promise<void> {
    if (busy) return;
    const snap = history.pop();
    tagFor = null;
    tagForBecameProject = false;
    if (snap) await revertSnapshot(snap);
  }

  async function undo() {
    if (busy) return;
    // If a tag picker is open, the user already saw the just-processed item;
    // dismiss the picker first so undo refers to whatever was processed
    // *before* it.
    if (tagFor) {
      tagFor = null;
      tagForBecameProject = false;
      return;
    }
    const snap = history.pop();
    if (!snap) return;
    await revertSnapshot(snap);
  }

  function exit() {
    void goto('/');
  }

  // Letter shortcuts driven by the hardcoded clarify keys (paso 3.A).
  useScope({
    name: 'process',
    bindings: [
      {
        key: 'Escape',
        description: 'salir',
        whileEditing: true,
        handler: (e) => {
          // 1ª Esc en un campo editable: solo blur. No arma el doble-tap
          // para que el usuario salga del input sin penalizar la salida.
          const t = e.target as HTMLElement | null;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            (t as HTMLElement).blur();
            return;
          }
          escConfirm('(dos veces para salir)', exit);
        },
      },
      {
        key: 'Backspace',
        description: 'deshacer',
        handler: () => {
          if (reminderPrompt || calendarPrompt) return;
          void undo();
        },
      },
      {
        key: 'Enter',
        hidden: true,
        handler: () => {
          // On the "Inbox cero" / "Inbox vacío" empty states, Enter exits.
          if (!current && !reminderPrompt && !calendarPrompt && !tagFor) {
            exit();
            return;
          }
          // Item en pantalla → Enter aterriza el cursor en notas para
          // anotar in-place. `whileEditing` no está activo en este binding,
          // así que dentro del propio textarea Enter sigue insertando salto.
          if (current && !reminderPrompt && !calendarPrompt && !tagFor) {
            const ta = document.querySelector<HTMLTextAreaElement>('textarea.notes');
            if (ta) {
              ta.focus();
              const end = ta.value.length;
              ta.setSelectionRange(end, end);
            }
          }
        },
      },
      {
        key: 'i',
        description: 'inspector',
        handler: () => {
          if (reminderPrompt || calendarPrompt) return;
          if (current) void goto(`/items/${current.id}`);
        },
      },
      {
        key: 's',
        description: 'saltar',
        handler: () => {
          if (reminderPrompt || calendarPrompt) return;
          skipCurrent();
        },
      },
      // 'b' (devolver a Bandeja) NO entra al flow de Procesar — para eso
      // está Saltar. Filtramos por target_state.
      ...CLARIFY_KEYS.filter((c) => c.target_state !== 'inbox').map((c) => ({
        key: c.key,
        hidden: true,
        handler: () => {
          if (reminderPrompt || calendarPrompt) return;
          void applyDecision(c.key);
        },
      })),
    ],
  });
</script>

<header class="topbar">
  <BackButton onclick={exit} ariaLabel="Salir" />
  {#if escToast.message}
    <span class="hud-text" role="status" aria-live="polite">{escToast.message}</span>
  {/if}
  {#if current}
    <span class="hud-text count">{processedCount + 1} / {processedCount + items.length}</span>
  {/if}
</header>

<main class="page">
  {#if tagFor}
    <ProcessItem item={tagFor} />

    <ClarifyQuickPick
      item={tagFor}
      becameProject={tagForBecameProject}
      onDone={() => {
        tagFor = null;
        tagForBecameProject = false;
      }}
      onCancel={() => void cancelClarify()}
      onChildCreated={trackChildCreated}
    />
  {:else if sub.fetching && !items.length && !everShownAnItem}
    <p class="hint">Cargando…</p>
  {:else if !current && !everShownAnItem}
    <section class="empty">
      <h1>{EMPTY.processEmptyTitle}</h1>
      <p>{EMPTY.processEmptyBody}</p>
      <button type="button" onclick={exit}>Volver</button>
    </section>
  {:else if !current && everShownAnItem}
    <section class="empty done">
      {#if skipped.size > 0}
        <h1>Hasta aquí por ahora</h1>
        <p>
          Procesados: {processedCount}. Saltados: {skipped.size} (vuelven a la
          Bandeja la próxima vez que entres a procesar).
        </p>
      {:else}
        <h1>{EMPTY.processZeroTitle}</h1>
        <p>Procesados: {processedCount}.</p>
      {/if}
      <button type="button" onclick={exit}>Volver</button>
    </section>
  {:else if current}
    <ProcessItem item={current} />

    {#if reminderPrompt}
      <ReminderPrompt onConfirm={confirmReminder} onCancel={cancelReminder} />
    {/if}

    {#if calendarPrompt}
      <CalendarPrompt onConfirm={confirmCalendar} onCancel={cancelCalendar} />
    {/if}

    <div class="prompt-q">¿Qué hago con esto?</div>
    <DecisionList onPick={applyDecision} waiting={reminderPrompt || calendarPrompt} />
    <button
      type="button"
      class="skip"
      disabled={reminderPrompt || calendarPrompt || busy}
      onclick={skipCurrent}
      title="Aparca este item y pasa al siguiente. Vuelve a Bandeja al salir."
    >
      <kbd>S</kbd>
      <span>Saltar — verlo más tarde</span>
    </button>
  {/if}
</main>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    /* padding-top vive en `.page-shell` (layout). En /process no hay Nav
     * (modo focused), así que el shell aplica desde el viewport top y la
     * altura del BackButton + counter cuadra con las demás vistas. */
    padding: 0 var(--container-pad-x) var(--space-4);
  }
  /* HUD text compartido por el hint de Esc y el counter — misma tipografía
   * y color para que ambos elementos alineen en la misma fila visual. */
  .hud-text {
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1;
  }
  .count {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .page {
    width: 100%;
    max-width: min(640px, var(--container-max));
    margin: 0 auto;
    padding: 0 var(--container-pad-x) 4rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .prompt-q {
    margin-top: 0.4rem;
    font-size: 0.9rem;
    opacity: 0.7;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    text-align: center;
    padding: 4rem 1rem 2rem;
  }
  .empty h1 {
    font-size: 1.6rem;
    font-weight: var(--weight-semibold);
    margin: 0;
  }
  .empty.done h1 {
    color: var(--accent);
  }
  .empty p {
    opacity: 0.7;
    margin: 0;
  }
  .empty button {
    margin-top: 0.8rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border-mix-medium);
    background: transparent;
    color: inherit;
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .empty button:hover {
    background: var(--hover-bg-subtle);
  }
  .empty button:active {
    background: var(--press-bg-subtle);
  }
  .hint {
    text-align: center;
    opacity: 0.5;
  }
  /* Skip = aparcar sin clasificar. Tono muted + dashed border lo separa
   * visualmente del DecisionList (que son decisiones reales). margin-top
   * suficiente para que no se confunda con la última fila del DecisionList. */
  .skip {
    margin-top: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.7rem;
    border: 1px dashed var(--border-mix-subtle);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background 70ms, border-color 70ms, color 70ms;
  }
  .skip:hover:not(:disabled) {
    background: var(--hover-bg-subtle);
    border-color: var(--border-mix-medium);
    color: var(--text-primary);
  }
  .skip:active:not(:disabled) {
    background: var(--press-bg-subtle);
  }
  .skip:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .skip kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: var(--text-xs);
    padding: 0.1rem 0.42rem;
    border: 1px solid var(--border-mix-medium);
    border-radius: var(--radius-sm);
    min-width: 1.2rem;
    text-align: center;
    opacity: 0.75;
  }
</style>
