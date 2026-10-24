<script lang="ts">
  import type { DerivedState } from '$lib/item-state';
  import { stateChangerKeysFor } from '$lib/state-changer-options';

  let {
    onPick,
    currentState,
    waiting,
    isProject = false,
    reminderPending = false,
  }: {
    onPick: (key: string) => void;
    currentState: DerivedState;
    waiting: boolean;
    isProject?: boolean;
    reminderPending?: boolean;
  } = $props();

  // Opciones filtradas por contexto (doc 49). El helper puro gestiona la
  // tabla: live vs terminal, proyecto vs acción, recordatorio pendiente.
  // La etiqueta de `b` cambia a "Reactivar" / "Restaurar" en done/trashed.
  const decisions = $derived(stateChangerKeysFor(currentState, isProject, reminderPending));
</script>

<ul class="list" aria-label="Cambiar de estado">
  {#each decisions as d (d.key)}
    <li>
      <button
        type="button"
        data-tone={d.tone}
        disabled={waiting}
        onclick={() => onPick(d.key)}
      >
        <kbd>{d.key.toUpperCase()}</kbd>
        <span>{d.label}</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  button {
    width: 100%;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border-mix-subtle);
    background: transparent;
    color: inherit;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      background 70ms,
      border-color 70ms,
      box-shadow 70ms,
      transform 70ms,
      color 70ms;
  }
  button:hover:not(:disabled) {
    background: var(--hover-bg-subtle);
    border-color: var(--border-mix-medium);
  }
  button:active:not(:disabled) {
    background: var(--press-bg-subtle);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* Hover positivo/peligroso: solo cambia el border, no el fondo. */
  button[data-tone='positive']:hover:not(:disabled) {
    border-color: var(--accent);
  }
  button[data-tone='danger']:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  kbd {
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
