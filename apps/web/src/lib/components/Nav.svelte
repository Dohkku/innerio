<script lang="ts">
  import { page } from '$app/state';
  import { viewLabel } from '$lib/methodology-static';
  import { springPress } from '$lib/actions/spring-press.svelte';

  function isActive(href: string): boolean {
    if (href === '/') return page.url.pathname === '/';
    return page.url.pathname.startsWith(href);
  }

  const tabs = [
    { href: '/', label: viewLabel('inbox'), short: 'Bandeja', classes: 'tab', titleHint: 'Bandeja sin procesar' },
    { href: '/work', label: viewLabel('work'), short: 'Sig.', classes: 'tab primary', titleHint: 'Siguientes acciones (hoy + pendiente)' },
    { href: '/calendar', label: viewLabel('calendar'), short: 'Cal.', classes: 'tab', titleHint: 'Eventos con hora fija' },
    { href: '/projects', label: viewLabel('projects'), short: 'Proy.', classes: 'tab', titleHint: 'Proyectos activos' },
    { href: '/reminders', label: viewLabel('reminders'), short: 'Rec.', classes: 'tab', titleHint: 'Recordatorios con fecha' },
  ];
</script>

<nav class="nav" aria-label="Navegación principal">
  {#each tabs as t (t.href)}
    <a
      href={t.href}
      class={t.classes}
      class:active={isActive(t.href)}
      title={t.titleHint}
      use:springPress={{ pressY: 3, hoverY: 0 }}
    >
      <span class="label label-long">{t.label}</span>
      <span class="label label-short" aria-hidden="true">{t.short}</span>
    </a>
  {/each}
</nav>

<style>
  .nav {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-4) var(--container-pad-x) var(--space-5);
    background: var(--surface-base);
    overflow-x: auto;
  }
  /* Default: long label visible, short oculto. */
  .label-short {
    display: none;
  }
  /* Móvil estrecho (<40rem): la barra baja al fondo (bottom tab bar, el
     patrón cómodo para el pulgar). Fija, full-width, 5 tabs repartidos,
     tap targets grandes (3.25rem) y labels cortos. Respeta la barra de
     gestos con safe-area-inset-bottom. El indicador de activo pasa de
     underline (abajo) a overline (arriba), porque la barra está pegada
     al borde inferior. En escritorio sigue arriba sin cambios. */
  @media (max-width: 40rem) {
    .nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 50;
      gap: 0;
      justify-content: space-around;
      padding: var(--space-2) var(--space-1)
        calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid var(--border-subtle);
      box-shadow: var(--shadow-float-sm);
      overflow-x: visible;
    }
    .tab {
      flex: 1 1 0;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      min-height: 3.25rem;
      padding: var(--space-1);
      font-size: var(--text-sm);
      border-bottom: 0;
      border-top: 2px solid transparent;
      border-radius: 0;
    }
    .tab.active {
      border-bottom-color: transparent;
      border-top-color: var(--accent);
      box-shadow: none;
    }
    .label-long {
      display: none;
    }
    .label-short {
      display: inline;
    }
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    min-height: 2rem;
    box-sizing: border-box;
    text-decoration: none;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    white-space: nowrap;
    flex-shrink: 0;
    /* Espacio reservado para el indicador inferior — evita salto vertical. */
    border-bottom: 1.5px solid transparent;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    line-height: 1.4;
    background: transparent;
    /* Motion driven por springPress (--y). Sin transition CSS sobre
     * transform — el spring escribe el offset cada frame. */
    transform: translateY(var(--y, 0px));
    transition:
      color 70ms,
      background var(--dur-quick) ease,
      box-shadow var(--dur-base) ease,
      border-color var(--dur-base) ease;
  }
  .tab:hover {
    color: var(--text-primary);
  }
  .tab:focus-visible {
    border-radius: var(--radius-sm);
  }
  /* Estado actual: underline accent (verde hoja) + sunken sutil
   * (--shadow-sunken-sm + press-bg-subtle). Señal estable, no chillona —
   * el "click apretado fuerte" se reserva al :active de abajo.
   * No tocamos font-weight para evitar layout-shift al navegar (medium >
   * regular = texto más ancho = todo lo de al lado se mueve). */
  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
    background: var(--press-bg-subtle);
    box-shadow: var(--shadow-sunken-sm);
  }
  /* Press: bg + inset shadow. La translateY la lleva springPress. */
  .tab:active {
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
  }
  /* Vista primaria (work): preacentuada en idle solo por color, sin peso
     extra. Mantener weight inherit evita layout-shift al activarse. */
  .tab.primary {
    color: var(--text-primary);
  }
  .tab.quiet {
    opacity: 0.7;
  }
  .tab.quiet:hover,
  .tab.quiet.active {
    opacity: 1;
  }
</style>
