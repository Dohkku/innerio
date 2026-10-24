<script lang="ts">
  import { CLARIFY_KEYS } from '$lib/methodology-static';

  let {
    onPick,
    waiting,
  }: {
    onPick: (key: string) => void;
    waiting: boolean;
  } = $props();

  // Tone is derived from side-effect flags: y = positive, t = danger.
  // 'b' (devolver a Bandeja) NO aparece en Procesar — para eso está Saltar.
  const decisions = $derived(
    CLARIFY_KEYS
      .filter((k) => k.target_state !== 'inbox')
      .map((k) => ({
        key: k.key,
        label: k.label,
        tone: k.sets_completed_at
          ? ('positive' as const)
          : k.sets_deleted_at
            ? ('danger' as const)
            : ('default' as const),
      })),
  );
</script>

<ul class="list" aria-label="Decisiones">
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
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border-mix-subtle);
    background: transparent;
    color: inherit;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background 70ms, border-color 70ms;
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
  button[data-tone='positive']:hover:not(:disabled) {
    background: color-mix(in oklab, var(--success) 12%, transparent);
    border-color: color-mix(in oklab, var(--success) 35%, transparent);
  }
  button[data-tone='danger']:hover:not(:disabled) {
    background: color-mix(in oklab, var(--danger) 12%, transparent);
    border-color: color-mix(in oklab, var(--danger) 35%, transparent);
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
