<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { AUTH_API, session } from '$lib/stores/session.svelte';
  import { isNativeShell } from '$lib/platform';

  // Pre-rellena email desde ?email=…&next=… (usado por QR pairing).
  let email = $state(page.url.searchParams.get('email') ?? '');
  // Solo paths internos. `//evil.com` y `https?://...` redirigen fuera del
  // sitio (open redirect — vector de phishing post-login). SvelteKit `goto`
  // se traga URLs absolutas sin error; mejor sanitizar aquí.
  function sanitizeNext(raw: string | null): string {
    if (!raw) return '/';
    if (!raw.startsWith('/')) return '/';
    if (raw.startsWith('//')) return '/';
    return raw;
  }
  let nextUrl = $derived(sanitizeNext(page.url.searchParams.get('next')));
  let sending = $state(false);
  let sent = $state(false);
  let error = $state<string | null>(null);

  // If the user is already signed in, bounce to next (or /).
  $effect(() => {
    if (session.ready && session.user) goto(nextUrl, { replaceState: true });
  });

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (!email || sending) return;
    sending = true;
    error = null;
    try {
      await session.sendMagicLink(email);
      sent = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'No se pudo enviar el enlace';
    } finally {
      sending = false;
    }
  }

  // App nativa (escritorio/Android): pulsar el enlace del correo lo abre en el
  // navegador del sistema, que no comparte sesión con la app. En su lugar el
  // usuario copia el enlace y lo pega aquí: lo pedimos con fetch para que
  // Better Auth ponga la cookie dentro de la app (mismo truco que /pair).
  let pasted = $state('');
  let verifying = $state(false);
  function isVerifyLink(raw: string): boolean {
    try {
      const u = new URL(raw.trim());
      return (
        u.origin === new URL(AUTH_API, window.location.href).origin &&
        u.pathname.endsWith('/magic-link/verify')
      );
    } catch {
      return false;
    }
  }
  async function onPaste(e: Event) {
    e.preventDefault();
    if (!isVerifyLink(pasted)) {
      error = 'Eso no parece el enlace del correo. Cópialo entero (empieza por https://).';
      return;
    }
    verifying = true;
    error = null;
    try {
      await fetch(pasted.trim(), { credentials: 'include', redirect: 'manual' });
    } catch {
      // El 302 es opaco y fetch puede rechazar; la cookie se aplica igual.
    }
    await session.refresh();
    verifying = false;
    if (!session.user) error = 'El enlace no sirvió (¿caducado o ya usado?). Pide otro.';
  }

  async function onGoogle() {
    error = null;
    try {
      await session.signInWithGoogle(nextUrl);
    } catch (err) {
      error = err instanceof Error ? err.message : 'No se pudo iniciar Google';
    }
  }
</script>

<div class="wrap">
  <div class="card">
    <h1>Entrar a Innerio</h1>
    <p class="lede">
      Pon tu email y te mandamos un enlace. Si ya tienes cuenta, entras
      directo. Si es la primera vez, te la creamos al pulsar el enlace.
      La app sigue funcionando sin cuenta y tus datos quedan guardados en
      este navegador.
    </p>

    <button type="button" class="qr" onclick={() => goto('/pair')}>
      <span class="qr-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3M21 14v0M17 21h4M21 17v4" />
        </svg>
      </span>
      <span>Entrar escaneando un QR</span>
    </button>
    <p class="qr-hint">
      Rápido: desde otro dispositivo ya conectado, abre Ajustes › Emparejar y
      escanea su código. Entras sin escribir nada.
    </p>

    <div class="sep"><span>o con tu cuenta</span></div>

    {#if session.config?.providers.google}
      <button type="button" class="google" onclick={onGoogle}>
        <span class="g-mark" aria-hidden="true">G</span>
        <span>Continuar con Google</span>
      </button>
      <div class="sep"><span>o con email</span></div>
    {/if}

    {#if sent}
      <div class="sent">
        <strong>Revisa tu correo.</strong>
        <p>
          Te enviamos un enlace de acceso a <code>{email}</code>. Caduca en 5
          minutos. Si no lo ves, mira en spam.
        </p>
        {#if isNativeShell()}
          <p>
            <strong>No lo abras:</strong> en el correo, clic derecho (o mantener pulsado) sobre
            el enlace → «Copiar enlace», y pégalo aquí.
          </p>
          <form onsubmit={onPaste}>
            <input
              type="url"
              placeholder="https://innerio-api.dohkku.dev/api/auth/magic-link/verify?…"
              bind:value={pasted}
              disabled={verifying}
              autocomplete="off"
              spellcheck="false"
            />
            <button type="submit" class="primary" disabled={verifying || !pasted}>
              {verifying ? 'Entrando…' : 'Entrar con el enlace'}
            </button>
          </form>
        {/if}
        <button type="button" class="link" onclick={() => { sent = false; }}>
          Usar otro email
        </button>
      </div>
    {:else}
      <form onsubmit={onSubmit}>
        <label>
          <span>Email</span>
          <input
            type="email"
            required
            autocomplete="email"
            placeholder="tu@email.com"
            bind:value={email}
            disabled={sending}
          />
        </label>
        <button type="submit" class="primary" disabled={sending || !email}>
          {sending ? 'Enviando…' : 'Enviar enlace de acceso'}
        </button>
      </form>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <p class="back">
      <a href="/">Volver a la app</a>
    </p>
  </div>
</div>

<style>
  .wrap {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem 1rem;
  }
  .card {
    width: 100%;
    max-width: 420px;
    background: color-mix(in oklab, var(--fg) 4%, var(--bg));
    border: 1px solid color-mix(in oklab, var(--fg) 12%, transparent);
    border-radius: 12px;
    padding: 1.75rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
  }
  .lede {
    margin: 0;
    opacity: 0.7;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
  }
  input {
    font: inherit;
    padding: 0.55rem 0.7rem;
    border-radius: 8px;
    border: 1px solid color-mix(in oklab, var(--fg) 18%, transparent);
    background: var(--bg);
    color: inherit;
  }
  input:focus {
    outline: 2px solid color-mix(in oklab, currentColor 40%, transparent);
    outline-offset: 1px;
  }
  button {
    cursor: pointer;
    font: inherit;
    padding: 0.6rem 0.9rem;
    border-radius: 8px;
    border: 1px solid color-mix(in oklab, var(--fg) 18%, transparent);
    background: var(--bg);
    color: inherit;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .primary {
    background: color-mix(in oklab, #4ade80 28%, var(--bg));
    border-color: color-mix(in oklab, #4ade80 50%, transparent);
    font-weight: 600;
  }
  .google {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 0.65rem 0.9rem;
    font-weight: 500;
  }
  .qr {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    font-weight: 600;
    background: color-mix(in oklab, #4ade80 28%, var(--bg));
    border-color: color-mix(in oklab, #4ade80 50%, transparent);
  }
  .qr-mark {
    display: inline-grid;
    place-items: center;
  }
  .qr-hint {
    margin: -0.4rem 0 0;
    font-size: 0.8rem;
    line-height: 1.4;
    opacity: 0.6;
    text-align: center;
  }
  .g-mark {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: linear-gradient(135deg, #4285f4, #ea4335);
    color: white;
    font-weight: 700;
    font-size: 0.8rem;
  }
  .sep {
    text-align: center;
    font-size: 0.75rem;
    opacity: 0.5;
    position: relative;
    margin: 0.25rem 0;
  }
  .sep::before {
    content: '';
    position: absolute;
    inset: 50% 0 auto 0;
    height: 1px;
    background: color-mix(in oklab, var(--fg) 12%, transparent);
  }
  .sep span {
    position: relative;
    background: color-mix(in oklab, var(--fg) 4%, var(--bg));
    padding: 0 0.5rem;
  }
  .sent {
    background: color-mix(in oklab, #4ade80 12%, var(--bg));
    border: 1px solid color-mix(in oklab, #4ade80 30%, transparent);
    border-radius: 8px;
    padding: 0.75rem 0.9rem;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .sent p {
    margin: 0.25rem 0 0.5rem;
  }
  .sent code {
    background: color-mix(in oklab, var(--fg) 8%, transparent);
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
    font-size: 0.85em;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    opacity: 0.7;
    font-size: 0.85rem;
  }
  .error {
    color: #f87171;
    font-size: 0.85rem;
    margin: 0;
  }
  .back {
    margin: 0;
    text-align: center;
    font-size: 0.85rem;
    opacity: 0.7;
  }
  .back a {
    color: inherit;
  }
</style>
