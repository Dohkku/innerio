<script lang="ts">
  /**
   * Easter egg: 5 clicks rápidos en el "42" abren un overlay con typewriter
   * + logo. Mientras escribe, cualquier acción (click, Esc, Enter) salta al
   * final. Una vez completado, cierra.
   *
   * La frase NO vive en el cliente: el bundle no la incluye. Cada apertura
   * pide una frase al azar a GET /api/secret/phrase, que la lee del archivo
   * bind-monted al server (`/etc/innerio/secret-phrases.txt`, hot-reloaded
   * por mtime). El bundle solo conoce la frase que el server le acaba de
   * devolver — y solo la suya.
   *
   * Sin em-dashes en el copy (regla user-facing). Color y tipografía heredan
   * del theme pack: --accent y mono stack genérico.
   */
  import { onDestroy } from 'svelte';
  import { useScope } from '$lib/keyboard.svelte';

  const AUTH_BASE = import.meta.env.VITE_AUTH_SERVER ?? '';
  const SECRET_TYPE_MS = 40;
  const SECRET_CLICK_WINDOW_MS = 2000;
  const SECRET_CLICKS_NEEDED = 5;

  let clicks = 0;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let typeInterval: ReturnType<typeof setInterval> | null = null;
  let open = $state(false);
  let typed = $state('');
  let typingDone = $state(false);
  let currentMessage = '';

  function bump() {
    clicks++;
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clicks = 0;
    }, SECRET_CLICK_WINDOW_MS);
    if (clicks >= SECRET_CLICKS_NEEDED) {
      clicks = 0;
      void openSecret();
    }
  }

  async function fetchSecretPhrase(): Promise<string | null> {
    try {
      const res = await fetch(`${AUTH_BASE}/api/secret/phrase`);
      if (!res.ok) return null;
      const data = (await res.json()) as { text?: string };
      return typeof data.text === 'string' && data.text.length > 0 ? data.text : null;
    } catch {
      return null;
    }
  }

  async function openSecret() {
    const phrase = await fetchSecretPhrase();
    // Sin server o rate-limited: no abrimos el overlay para que el secreto
    // siga teniendo su gracia (mejor "no pasa nada" que pintar un fallback
    // delator). El usuario puede volver a intentar más tarde.
    if (!phrase) return;
    currentMessage = phrase;
    open = true;
    typed = '';
    typingDone = false;
    let i = 0;
    if (typeInterval) clearInterval(typeInterval);
    typeInterval = setInterval(() => {
      if (i < currentMessage.length) {
        i++;
        typed = currentMessage.slice(0, i);
      } else {
        if (typeInterval) clearInterval(typeInterval);
        typeInterval = null;
        typingDone = true;
      }
    }, SECRET_TYPE_MS);
  }

  function dismiss() {
    if (!open) return;
    if (!typingDone) {
      // Primera acción durante el typing: saltar al final, no cerrar.
      if (typeInterval) clearInterval(typeInterval);
      typeInterval = null;
      typed = currentMessage;
      typingDone = true;
      return;
    }
    open = false;
  }

  onDestroy(() => {
    if (clickTimer) clearTimeout(clickTimer);
    if (typeInterval) clearInterval(typeInterval);
  });

  useScope({
    name: 'settings-secret',
    modal: true,
    active: () => open,
    bindings: [
      { key: 'Escape', whileEditing: true, description: 'cerrar', handler: dismiss },
      { key: 'Enter', whileEditing: true, description: 'cerrar', handler: dismiss },
    ],
  });
</script>

<button type="button" class="answer" aria-label="42" onclick={bump}>42</button>

{#if open}
  <div class="secret" role="presentation" onclick={dismiss}>
    <span class="secret-42">42</span>
    <div class="secret-text">{typed}<span class="secret-caret">_</span></div>
    <img
      class="secret-logo"
      src="/innerio-logo.png"
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
    />
  </div>
{/if}

<style>
  .answer {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.9rem;
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
  }
  .answer:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: var(--radius-sm);
  }

  /* Réplica del /secret de dohkku.dev pero theme-aware: usa --surface-base
   * + --accent del theme pack activo. Tipografía mono inline (no hay token
   * mono en appearance.css). Click/Esc/Enter cierran tras typing. */
  .secret {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--surface-base);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .secret-42 {
    color: var(--accent);
    font-size: 1.2rem;
    margin-bottom: var(--space-7);
  }
  .secret-text {
    color: var(--accent);
    font-size: 1rem;
    line-height: 1.7;
    white-space: pre-wrap;
    text-align: center;
    max-width: 32rem;
  }
  .secret-caret {
    animation: secret-blink 0.6s step-end infinite;
  }
  @keyframes secret-blink {
    50% {
      opacity: 0;
    }
  }
  .secret-logo {
    width: 200px;
    max-width: 60vw;
    opacity: 0.6;
    margin-top: var(--space-8);
  }
  @media (prefers-reduced-motion: reduce) {
    .secret-caret {
      animation: none;
      opacity: 0.8;
    }
  }
</style>
