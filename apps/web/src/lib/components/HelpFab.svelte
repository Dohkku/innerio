<script lang="ts">
  /**
   * FAB de ayuda abajo-derecha. Click o tecla `?` abre un panel inline con
   * qué hace la vista actual y los atajos específicos de esa vista (si los
   * hay). Cierre: click fuera, Esc, o re-click. Oculto en /process — modo
   * focused no debe tener chrome extra. El contenido cambia por ruta para
   * que la ayuda siempre sea relevante a lo que el usuario está mirando.
   */
  import { page } from '$app/state';
  import { fly } from 'svelte/transition';
  import { useScope } from '$lib/keyboard.svelte';

  type Shortcut = { keys: string[]; desc: string };
  type HelpEntry = {
    title: string;
    blurb: string;
    shortcuts?: Shortcut[];
  };

  let open = $state(false);
  let wrapEl = $state<HTMLElement | undefined>(undefined);

  const path = $derived(page.url.pathname);
  const hidden = $derived(path.startsWith('/process'));

  // Atajos globales que valen en cualquier ruta. Se renderizan siempre
  // debajo de los específicos de la pantalla.
  const GLOBAL_SHORTCUTS: Shortcut[] = [
    { keys: ['/'], desc: 'buscar' },
    { keys: ['Shift', 'F'], desc: 'pantalla completa' },
    { keys: ['?'], desc: 'esta ayuda' },
  ];

  // Resolver de contenido por ruta. Rutas con `[id]` se matchean por
  // prefijo. Default: visión general (mismo bloque que existía antes).
  function helpFor(p: string): HelpEntry {
    if (p === '/') {
      return {
        title: 'Bandeja',
        blurb:
          'Suelta aquí lo que se te pase por la cabeza. Sin pensar todavía qué hacer con ello.',
        shortcuts: [
          { keys: ['n'], desc: 'capturar' },
          { keys: ['p'], desc: 'procesar' },
          { keys: ['↑', '↓'], desc: 'mover selección' },
          { keys: ['Enter'], desc: 'editar título' },
          { keys: ['q'], desc: 'descartar' },
        ],
      };
    }
    if (p.startsWith('/work')) {
      return {
        title: 'Siguientes acciones',
        blurb:
          'Lo que vence hoy y la próxima acción accionable de cada proyecto, agrupado por proyecto. Filtros ↻ (recurrentes) y ✓ (completadas) en la barra superior.',
      };
    }
    if (p.startsWith('/projects/')) {
      return {
        title: 'Proyecto',
        blurb:
          'Sub-ítems del proyecto. El indicador | marca secuencial (solo la próxima acción es accionable); || marca paralelo (todas a la vez).',
        shortcuts: [{ keys: ['Esc'], desc: 'volver' }],
      };
    }
    if (p.startsWith('/projects')) {
      return {
        title: 'Proyectos',
        blurb:
          'Cosas con varias acciones que dependen entre sí. Entra a un proyecto para ver y reordenar sus sub-ítems.',
      };
    }
    if (p.startsWith('/waiting')) {
      return {
        title: 'Esperando',
        blurb:
          'Lo que delegaste o aún no llega. Anota de quién esperas y revisa periódicamente.',
      };
    }
    if (p.startsWith('/items/')) {
      return {
        title: 'Detalle del ítem',
        blurb:
          'Editar título, fecha, estado, recurrencia y notas. Los cambios se guardan al vuelo.',
        shortcuts: [
          { keys: ['Esc'], desc: 'salir del campo / volver' },
          { keys: ['Ctrl', 'Enter'], desc: 'guardar' },
          { keys: ['p'], desc: 'a proyecto' },
          { keys: ['w'], desc: 'a esperando' },
          { keys: ['y'], desc: 'hecho' },
          { keys: ['t'], desc: 'a papelera' },
        ],
      };
    }
    if (p.startsWith('/settings')) {
      return {
        title: 'Ajustes',
        blurb:
          'Tema, paquete de colores y opciones de apariencia. Los cambios persisten en este navegador.',
      };
    }
    return {
      title: '¿Qué es esto?',
      blurb:
        'Bandeja: captura sin pensar. Procesar: decide ítem a ítem. Hoy: lo que toca. Proyectos: cosas con varias acciones. Esperando: lo delegado.',
    };
  }

  const content = $derived(helpFor(path));

  function toggle() {
    open = !open;
  }
  function close() {
    open = false;
  }

  // Click fuera del wrapper cierra. No vale onclickoutside del button — el
  // botón vive dentro del mismo wrap que el panel, así que `wrapEl.contains`
  // sirve para ambos.
  function onPagePointerDown(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Node | null;
    if (t && wrapEl?.contains(t)) return;
    close();
  }

  // Scope modal cuando el panel está abierto: Esc cierra incluso si el
  // foco está en un input (whileEditing). `active` evita que el Esc se
  // atrape cuando el FAB está cerrado.
  useScope({
    name: 'help-fab-open',
    modal: false,
    active: () => open,
    bindings: [
      {
        key: 'Escape',
        whileEditing: true,
        description: 'cerrar ayuda',
        handler: close,
      },
    ],
  });

  // Trigger global: tecla `?` (Shift+/ en teclados US/ES) abre/cierra. Sin
  // `whileEditing` para no robar `?` al usuario que está escribiendo.
  useScope({
    name: 'help-fab-trigger',
    bindings: [{ key: '?', shift: true, description: 'ayuda', handler: toggle }],
  });
</script>

<svelte:window onpointerdown={onPagePointerDown} />

{#if !hidden}
  <div class="wrap" bind:this={wrapEl}>
    {#if open}
      <div
        class="panel"
        role="dialog"
        aria-label="Ayuda"
        transition:fly={{ y: 8, duration: 140 }}
      >
        <h2 class="h">{content.title}</h2>
        <p class="blurb">{content.blurb}</p>

        {#if content.shortcuts && content.shortcuts.length}
          <div class="kbd-section">
            <span class="kbd-lbl">Atajos de esta vista</span>
            <ul class="kbd-list">
              {#each content.shortcuts as s (s.desc)}
                <li>
                  {#each s.keys as k, i (k + i)}
                    {#if i > 0}<span class="kbd-sep">+</span>{/if}
                    <kbd>{k}</kbd>
                  {/each}
                  <span class="kbd-desc">{s.desc}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="kbd-section">
          <span class="kbd-lbl">Atajos globales</span>
          <ul class="kbd-list">
            {#each GLOBAL_SHORTCUTS as s (s.desc)}
              <li>
                {#each s.keys as k, i (k + i)}
                  {#if i > 0}<span class="kbd-sep">+</span>{/if}
                  <kbd>{k}</kbd>
                {/each}
                <span class="kbd-desc">{s.desc}</span>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    {/if}
    <button
      type="button"
      class="btn"
      aria-label={open ? 'Cerrar ayuda' : 'Ayuda'}
      aria-expanded={open}
      title="Ayuda (?)"
      onclick={toggle}
    >?</button>
  </div>
{/if}

<style>
  .wrap {
    position: fixed;
    bottom: var(--space-5);
    right: var(--space-5);
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-3);
    pointer-events: none;
  }
  /* Móvil: sube por encima de la bottom-nav + barra de gestos. */
  @media (max-width: 40rem) {
    .wrap {
      bottom: calc(var(--space-3) + 3.75rem + env(safe-area-inset-bottom, 0px));
    }
  }
  .wrap > * {
    pointer-events: auto;
  }
  .btn {
    appearance: none;
    background: var(--surface-raised);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 999px;
    cursor: pointer;
    font: inherit;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold, 600);
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-float-sm);
    transition:
      opacity var(--dur-quick) ease,
      color var(--dur-quick) ease,
      background var(--dur-quick) ease,
      box-shadow var(--dur-base) ease;
  }
  .btn:hover,
  .btn:focus-visible {
    opacity: 1;
    color: var(--text-primary);
  }
  .btn[aria-expanded='true'] {
    opacity: 1;
    color: var(--text-primary);
    background: var(--surface-input);
    box-shadow: var(--shadow-inset-sm);
  }
  .panel {
    background: var(--surface-input);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    width: min(360px, calc(100vw - var(--space-7)));
    max-height: calc(100vh - var(--space-8) - var(--space-7));
    overflow-y: auto;
    box-shadow: var(--shadow-float-lg);
    text-align: justify;
  }
  .h {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    margin: 0 0 var(--space-3);
    font-weight: var(--weight-medium);
  }
  .blurb {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    text-align: justify;
  }
  .kbd-section {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }
  .kbd-lbl {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    display: block;
    margin-bottom: var(--space-2);
    font-weight: var(--weight-medium);
  }
  .kbd-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .kbd-list li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
  }
  .kbd-sep {
    color: var(--text-muted);
    margin: 0 0.15rem;
    font-size: var(--text-xs);
  }
  .kbd-desc {
    margin-left: var(--space-2);
    color: var(--text-secondary);
  }
  kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: var(--text-xs);
    background: var(--surface-sunken);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.4rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .panel {
      transition: none !important;
    }
  }
</style>
