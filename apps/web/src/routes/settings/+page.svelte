<script lang="ts">
  /**
   * Página de ajustes consolidada. Por ahora dos secciones:
   *
   *   1. Apariencia — selector de theme packs (light+dark+shadows).
   *   2. Información — branding (logo + nombre de la app).
   *
   * Cuando aparezcan más settings (notificaciones, exportar, etc.) se
   * añaden como nuevas <section class="settings-section">. Si la página
   * crece mucho, partir en subpáginas con un índice.
   */
  import { goto } from '$app/navigation';
  import BackButton from '$lib/components/BackButton.svelte';
  import SecretOverlay from '$lib/components/SecretOverlay.svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import { THEMES, type Variant } from '$lib/appearance/themes';
  import { themePack } from '$lib/stores/theme-pack.svelte';
  import { appearance, setTheme, type Theme } from '$lib/stores/appearance.svelte';
  import { springPress } from '$lib/actions/spring-press.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { cryptoStore } from '$lib/stores/crypto.svelte';
  import {
    dailyReminder,
    reminderSupported,
    setReminderEnabled,
    setReminderTime,
  } from '$lib/stores/daily-reminder.svelte';
  import { desktopBridge, isNativeShell } from '$lib/platform';
  import { isIOS, pwa } from '$lib/pwa.svelte';
  import { asistente } from '$lib/asistente.svelte';

  const ia = asistente();
  $effect(() => {
    if (!ia.comprobado) void ia.comprobar();
  });
  import pkg from '../../../package.json';

  const THEME_MODES: { value: Theme; title: string }[] = [
    { value: 'light', title: 'Día' },
    { value: 'dark', title: 'Noche' },
    { value: 'system', title: 'Auto' },
  ];

  // In the desktop app show its own version (the one updates refer to);
  // pkg.version is the web bundle's, which never changes.
  const version = desktopBridge()?.version || pkg.version;

  // Ajustes se abre desde el FAB en cualquier vista, así que `history.back()`
  // era impredecible (podía no haber historial o volver a una pantalla random).
  // Salir siempre a la Bandeja da un destino estable.
  function back() {
    void goto('/');
  }

  // Esc vuelve atrás de un toque. Esta página no tiene inputs de texto,
  // así que no hace falta el doble-Esc con confirmación que usan las
  // subpáginas (account/pair) para no salir mientras se escribe.
  useScope({
    name: 'settings',
    bindings: [
      {
        key: 'Escape',
        description: 'volver',
        handler: () => back(),
      },
    ],
  });

  // Recordatorio diario (solo app nativa). El toggle pide permiso al activar;
  // si lo deniegan, vuelve a off y mostramos un aviso.
  let permDenied = $state(false);
  const reminderTimeStr = $derived(
    `${String(dailyReminder.h).padStart(2, '0')}:${String(dailyReminder.m).padStart(2, '0')}`,
  );

  async function onReminderToggle(e: Event): Promise<void> {
    const el = e.currentTarget as HTMLInputElement;
    const want = el.checked;
    permDenied = false;
    const got = await setReminderEnabled(want);
    if (want && !got) {
      permDenied = true;
      el.checked = false;
    }
  }

  function onReminderTime(e: Event): void {
    const [h, m] = (e.currentTarget as HTMLInputElement).value.split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) void setReminderTime(h, m);
  }

  function previewStyle(v: Variant): string {
    return [
      `--p-base:${v.tokens.surfaceBase}`,
      `--p-raised:${v.tokens.surfaceRaised}`,
      `--p-input:${v.tokens.surfaceInput}`,
      `--p-text:${v.tokens.textPrimary}`,
      `--p-muted:${v.tokens.textMuted}`,
      `--p-accent:${v.tokens.accent}`,
      `--p-border:${v.tokens.borderSubtle}`,
      `--p-shadow:${v.shadows.floatSm}`,
    ].join(';');
  }
</script>

<svelte:head>
  <title>Ajustes — Innerio</title>
</svelte:head>

<header class="topbar">
  <BackButton onclick={back} ariaLabel="Volver" />
</header>

<main class="page">
  <section class="settings-section">
    <nav class="links">
      {#if session.user}
        <a class="link" href="/settings/account">
          <span class="link-title">Cuenta</span>
          <span class="link-sub">{session.user.email}</span>
        </a>
        {#if cryptoStore.status === 'unlocked'}
          <a class="link" href="/settings/pair">
            <span class="link-title">Emparejar dispositivo</span>
            <span class="link-sub">Conecta otro navegador con QR</span>
          </a>
        {/if}
      {:else}
        <a class="link" href="/login">
          <span class="link-title">Iniciar sesión</span>
          <span class="link-sub">Sincroniza entre dispositivos</span>
        </a>
      {/if}
      <a class="link" href="mailto:dohkku@dohkku.dev?subject=Feedback Innerio">
        <span class="link-title">Enviar feedback</span>
        <span class="link-sub">Cuéntame qué te gusta o qué falla</span>
      </a>
      {#if !reminderSupported() && !isNativeShell()}
        <a
          class="link"
          href="mailto:dohkku@dohkku.dev?subject=Quiero probar la app de Innerio (Android)&body=Hola, me gustaría probar la app de Android. Mi correo de Google Play es: "
        >
          <span class="link-title">Probar la app de Android</span>
          <span class="link-sub">Escríbeme y te doy acceso</span>
        </a>
      {/if}
    </nav>
  </section>

  {#if ia.modelos.length > 0 || (isNativeShell() && ia.comprobado)}
    <section class="settings-section">
      <h2 class="section-h">Asistente</h2>
      <div class="reminder">
        {#if ia.modelos.length > 0}
          <label class="reminder-row">
            <span class="reminder-text">
              <span class="reminder-title">Sugerir la siguiente acción</span>
              <span class="reminder-sub">
                Al procesar, pulsa G y te propone tres acciones concretas. La IA funciona en tu
                ordenador: tus tareas no salen de aquí.
              </span>
            </span>
            <input
              type="checkbox"
              class="reminder-toggle"
              checked={ia.activo}
              onchange={(e) => ia.setActivo((e.currentTarget as HTMLInputElement).checked)}
              aria-label="Activar el asistente"
            />
          </label>
          {#if ia.activo && ia.modelos.length > 1}
            <label class="reminder-time">
              <span class="reminder-sub">Modelo</span>
              <select
                value={ia.modelo}
                onchange={(e) => ia.setModelo((e.currentTarget as HTMLSelectElement).value)}
              >
                {#each ia.modelos as m (m)}
                  <option value={m}>{m}</option>
                {/each}
              </select>
            </label>
          {/if}
        {:else if ia.ollama}
          <span class="reminder-text">
            <span class="reminder-title">Último paso: descargar la IA</span>
            <span class="reminder-sub">
              Son unos 3 GB y solo se descarga una vez. Después funciona sin internet.
            </span>
          </span>
          {#if ia.progreso !== null}
            <div class="progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(ia.progreso * 100)}>
              <div class="progreso-barra" style:width={`${Math.round(ia.progreso * 100)}%`}></div>
            </div>
            <p class="reminder-warn">Descargando… {Math.round(ia.progreso * 100)} %</p>
          {:else}
            <button type="button" class="instalar-btn" onclick={() => ia.descargarModelo()}>
              Descargar la IA
            </button>
          {/if}
          {#if ia.estadoDescarga && ia.progreso === null}
            <p class="reminder-warn" role="status">{ia.estadoDescarga}</p>
          {/if}
        {:else}
          <span class="reminder-text">
            <span class="reminder-title">Un ayudante para decidir qué hacer</span>
            <span class="reminder-sub">
              Al procesar, una IA te propone la siguiente acción concreta de cada cosa. Funciona
              dentro de tu ordenador, así que tus tareas no salen de él. Para activarla instala
              Ollama, un programa gratuito, y vuelve aquí.
            </span>
          </span>
          <ol class="pasos-ia">
            <li>
              <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Descarga Ollama</a>
              e instálalo como cualquier programa.
            </li>
            <li>Ábrelo. Se queda funcionando en segundo plano.</li>
            <li>Pulsa el botón de abajo y descarga la IA desde aquí.</li>
          </ol>
          <button type="button" class="instalar-btn" onclick={() => ia.comprobar()}>
            Ya lo tengo, comprobar
          </button>
          <p class="reminder-warn">Necesita un ordenador con 8 GB de memoria o más.</p>
        {/if}
      </div>
    </section>
  {/if}

  {#if !isNativeShell() && !pwa.installed && (pwa.prompt || isIOS())}
    <section class="settings-section">
      <h2 class="section-h">Instalar</h2>
      <div class="reminder">
        <span class="reminder-text">
          <span class="reminder-title">Innerio como app</span>
          <span class="reminder-sub">
            Con su icono y su propia ventana. Abre aunque no tengas conexión.
          </span>
        </span>
        {#if pwa.prompt}
          <button type="button" class="instalar-btn" onclick={() => pwa.install()}>
            Instalar Innerio
          </button>
        {:else}
          <p class="reminder-warn">
            En Safari pulsa Compartir y después «Añadir a pantalla de inicio».
          </p>
        {/if}
      </div>
    </section>
  {/if}

  {#if reminderSupported()}
    <section class="settings-section">
      <h2 class="section-h">Recordatorio diario</h2>
      <div class="reminder">
        <label class="reminder-row">
          <span class="reminder-text">
            <span class="reminder-title">Avísame de la Bandeja</span>
            <span class="reminder-sub">Si te queda algo por procesar al final del día</span>
          </span>
          <input
            type="checkbox"
            class="reminder-toggle"
            checked={dailyReminder.enabled}
            onchange={onReminderToggle}
            aria-label="Activar recordatorio diario"
          />
        </label>
        {#if dailyReminder.enabled}
          <label class="reminder-time">
            <span class="reminder-sub">Hora del aviso</span>
            <input type="time" value={reminderTimeStr} onchange={onReminderTime} />
          </label>
        {/if}
        {#if permDenied}
          <p class="reminder-warn" role="status">
            No diste permiso para avisarte. Actívalo en los ajustes del sistema.
          </p>
        {/if}
      </div>
    </section>
  {/if}

  <section class="settings-section">
    <h2 class="section-h">Apariencia</h2>
    <div class="theme-mode" role="group" aria-label="Modo de tema">
      {#each THEME_MODES as t (t.value)}
        <button
          type="button"
          class="mode-btn"
          data-active={appearance.theme === t.value}
          aria-label={t.title}
          aria-pressed={appearance.theme === t.value}
          onclick={() => setTheme(t.value)}
          use:springPress
        >
          {#if t.value === 'light'}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          {:else if t.value === 'dark'}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          {/if}
          <span class="mode-label">{t.title}</span>
        </button>
      {/each}
    </div>
    <ul class="grid">
      {#each THEMES as t (t.id)}
        {@const active = themePack.activeId === t.id}
        <li>
          <button
            type="button"
            class="card"
            class:active
            aria-pressed={active}
            onclick={() => themePack.apply(t.id)}
          >
            <div class="previews">
              {#each [t.light, t.dark] as v, idx (idx)}
                <div class="preview" style={previewStyle(v)}>
                  <div class="prev-base">
                    <div class="prev-card prev-card-1">
                      <span class="prev-dot"></span>
                      <span class="prev-bar prev-bar-long"></span>
                    </div>
                    <div class="prev-card prev-card-2">
                      <span class="prev-dot prev-dot-muted"></span>
                      <span class="prev-bar prev-bar-short"></span>
                    </div>
                    <div class="prev-input">
                      <span class="prev-caret"></span>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
            <span class="name">{t.id}</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>

  <section class="settings-section">
    <div class="about">
      <SecretOverlay />
      <img
        class="logo"
        src="/innerio-logo.png"
        alt="Innerio logo"
        loading="lazy"
        decoding="async"
      />
      <span class="brand">Innerio</span>
      <span class="credit">Hecho por dohkku · v{version}</span>
    </div>
  </section>
</main>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--container-pad-x) var(--space-4);
  }
  .page {
    width: 100%;
    max-width: var(--container-max);
    margin: 0 auto var(--space-8);
    padding: 0 var(--container-pad-x);
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .section-h {
    margin: 0;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    font-weight: var(--weight-medium);
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .link {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: inherit;
    text-decoration: none;
    transition: background var(--dur-quick) ease, border-color var(--dur-base) ease;
  }
  .link:hover {
    background: var(--press-bg-subtle);
    border-color: var(--border-default);
  }
  .link-title {
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }
  .link-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* === Recordatorio diario ============================================= */
  .reminder {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
  .reminder-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    cursor: pointer;
  }
  .reminder-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .reminder-title {
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }
  .reminder-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .reminder-toggle {
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--accent);
    flex-shrink: 0;
    cursor: pointer;
  }
  .reminder-time {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }
  .reminder-time input,
  .reminder-time select {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
  }
.instalar-btn {
    align-self: flex-start;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--surface-base);
    background: var(--accent);
    border: none;
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
  }
  .progreso {
    height: 0.5rem;
    border-radius: 999px;
    background: var(--surface-sunken);
    overflow: hidden;
  }
  .progreso-barra {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
  }
  .pasos-ia {
    margin: 0;
    padding-left: 1.2rem;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .pasos-ia li + li {
    margin-top: var(--space-1);
  }
  .reminder-warn {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* Toggle Día/Noche/Auto: misma receta que el grupo `.appearance` del
   * Nav antiguo (botones segmentados con icono + label). Vivían en el
   * top-nav; migrados aquí para liberar ese chrome global. */
  .theme-mode {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .mode-btn {
    appearance: none;
    background: transparent;
    border: 0;
    padding: var(--space-1) var(--space-3);
    min-height: 2rem;
    box-sizing: border-box;
    color: var(--text-secondary);
    opacity: 0.6;
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    transform: translateY(var(--y, 0px));
    transition:
      color var(--dur-quick),
      opacity var(--dur-quick),
      background var(--dur-quick) ease,
      box-shadow var(--dur-base) ease;
    font: inherit;
    font-size: var(--text-sm);
  }
  .mode-btn:hover {
    color: var(--text-primary);
    opacity: 1;
  }
  .mode-btn:active {
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
  }
  .mode-btn[data-active='true'] {
    color: var(--text-primary);
    opacity: 1;
    background: var(--press-bg-subtle);
    box-shadow: var(--shadow-sunken-sm);
  }
  .mode-label {
    line-height: 1;
  }

  /* === Apariencia: grid de cards-paleta ================================ */
  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-4);
  }
  /* Card-botón con la receta de `.ap-btn` (Nav, botones día/noche). */
  .card {
    appearance: none;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
    opacity: 0.75;
    transition:
      color var(--dur-quick),
      opacity var(--dur-quick),
      background var(--dur-quick) ease,
      box-shadow var(--dur-base) ease,
      border-color var(--dur-base) ease;
  }
  .card:hover:not(.active) {
    opacity: 1;
    color: var(--text-primary);
  }
  .card:active:not(.active) {
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
  }
  .card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .card.active {
    opacity: 1;
    color: var(--text-primary);
    background: var(--press-bg-subtle);
    border-color: var(--accent);
    box-shadow: var(--shadow-sunken-sm);
    cursor: default;
  }

  .previews {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .preview {
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 1px solid var(--p-border);
  }
  .prev-base {
    background: var(--p-base);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 110px;
  }
  .prev-card {
    background: var(--p-raised);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    box-shadow: var(--p-shadow);
  }
  .prev-card-2 {
    opacity: 0.95;
  }
  .prev-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: var(--p-accent);
    flex-shrink: 0;
  }
  .prev-dot-muted {
    background: var(--p-muted);
  }
  .prev-bar {
    height: 0.4rem;
    border-radius: 2px;
    background: var(--p-text);
    opacity: 0.85;
  }
  .prev-bar-long {
    flex: 1;
  }
  .prev-bar-short {
    flex: 0 0 55%;
    background: var(--p-muted);
    opacity: 0.7;
  }
  .prev-input {
    background: var(--p-input);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    margin-top: auto;
    border: 1px solid var(--p-border);
    display: flex;
    align-items: center;
  }
  .prev-caret {
    width: 1px;
    height: 0.7rem;
    background: var(--p-accent);
    animation: blink 1.1s steps(2) infinite;
  }
  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .prev-caret { animation: none; opacity: 0.8; }
    .card { transition: none !important; }
  }

  .name {
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    color: inherit;
  }
  .card.active .name {
    color: var(--accent);
  }

  /* === Información: branding ============================================
   * Patrón del footer de dohkku.dev con branding propio en el medio y
   * crédito al final:
   *   42                         (text-muted, sutil)
   *   [logo Innerio]             (opacity 0.6, decorativo)
   *   Innerio                    (accent + grande — main color del theme)
   *   Hecho por dohkku · vX      (text-muted microcopy, abajo del todo)
   *
   * El "Innerio" usa `--accent`, que cambia por pack: verde forest en
   * innerio light, matrix en innerio dark, ámbar en paper dark, etc.
   * --------------------------------------------------------------------- */
  .about {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-5) var(--space-4) var(--space-7);
    user-select: none;
  }
  .logo {
    width: 200px;
    max-width: 60vw;
    height: auto;
    opacity: 0.6;
    object-fit: contain;
    margin-top: var(--space-2);
  }
  .brand {
    color: var(--accent);
    font-size: var(--text-lg);
    font-weight: var(--weight-medium);
    letter-spacing: 0.04em;
    margin-top: var(--space-1);
  }
  .credit {
    color: var(--text-muted);
    font-size: var(--text-xs);
    letter-spacing: 0.02em;
    margin-top: var(--space-5);
  }

</style>
