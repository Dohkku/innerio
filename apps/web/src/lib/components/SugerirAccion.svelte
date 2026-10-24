<script lang="ts">
  /**
   * "Sugerir siguiente acción" in /process (local AI, see $lib/asistente).
   * Hidden unless Ollama answers on this machine. Choosing an option renames
   * the item to that concrete action and keeps the original wording at the
   * end of the notes, so nothing the user wrote is lost. G asks, 1–3 pick.
   */
  import { triplit } from '$lib/triplit';
  import { asistente } from '$lib/asistente.svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import type { Item } from '@gtd/schema';

  let { item }: { item: Item } = $props();

  const ia = asistente();
  let opciones = $state<string[]>([]);
  let cargando = $state(false);
  let error = $state('');
  let paraId = $state<string | undefined>(undefined);

  $effect(() => {
    if (!ia.comprobado) void ia.comprobar();
  });

  // A new item in the queue clears the previous suggestions.
  $effect(() => {
    if (item.id !== paraId) {
      opciones = [];
      error = '';
      paraId = item.id;
    }
  });

  async function pedir(): Promise<void> {
    if (cargando || !ia.disponible) return;
    cargando = true;
    error = '';
    try {
      opciones = await ia.sugerir(item.title, item.notes ?? '');
      if (opciones.length === 0) error = 'No se me ocurre nada útil. Prueba otra vez.';
    } catch {
      error = 'No pude hablar con el modelo local. ¿Sigue abierto Ollama?';
    } finally {
      cargando = false;
    }
  }

  async function usar(accion: string): Promise<void> {
    const original = item.title;
    const notas = item.notes ?? '';
    opciones = [];
    await triplit.update('items', item.id, (e) => {
      e.title = accion;
      e.notes = `${notas.trim() ? `${notas.trim()}\n\n` : ''}Apuntado: ${original}`;
    });
  }

  useScope({
    name: 'process-asistente',
    active: () => ia.disponible,
    bindings: [
      { key: 'g', description: 'sugerir acción', handler: () => void pedir() },
      ...[1, 2, 3].map((n) => ({
        key: String(n),
        hidden: true,
        handler: () => {
          const a = opciones[n - 1];
          if (a) void usar(a);
        },
      })),
    ],
  });
</script>

{#if ia.disponible}
  <div class="asistente">
    {#if opciones.length === 0}
      <button type="button" class="pedir" onclick={() => void pedir()} disabled={cargando}>
        <kbd>G</kbd>
        {cargando ? 'Pensando…' : 'Sugerir siguiente acción'}
      </button>
    {:else}
      <p class="rotulo">¿La siguiente acción es…?</p>
      <ul class="opciones">
        {#each opciones as accion, i (accion)}
          <li>
            <button type="button" class="opcion" onclick={() => void usar(accion)}>
              <kbd>{i + 1}</kbd>
              {accion}
            </button>
          </li>
        {/each}
      </ul>
      <button type="button" class="otras" onclick={() => void pedir()} disabled={cargando}>
        {cargando ? 'Pensando…' : 'Otras ideas'}
      </button>
    {/if}
    {#if error}
      <p class="error" role="status">{error}</p>
    {/if}
  </div>
{/if}

<style>
  .asistente {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .rotulo {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .opciones {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pedir,
  .opcion,
  .otras {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font: inherit;
    text-align: left;
    color: var(--text-primary);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
  }
  .pedir,
  .otras {
    align-self: flex-start;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .opcion {
    width: 100%;
  }
  .opcion:hover,
  .pedir:hover,
  .otras:hover {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  kbd {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-xs);
    padding: 0 var(--space-1);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }
  .error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
</style>
