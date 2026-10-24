import { runMigrationSweep } from '$lib/crypto/migrate';
import { cryptoStore } from '$lib/stores/crypto.svelte';
import { setTriplitUserId, triplit } from '$lib/triplit';
/**
 * Auth session store — Better Auth client wrapper for the GTD web app.
 *
 * Drives:
 *  - reactive `session.user` for layout guards (demo banner, /login redirect)
 *  - TriplitClient token rotation: on login → fetch JWT from /api/auth/triplit-token
 *    and call `triplit.startSession(token)`; on logout → `triplit.endSession()`
 *
 * No SvelteKit load function: SSR is disabled app-wide and we want session
 * resolution to happen once on the client. Bootstraps on import via the
 * `+layout.svelte` side-effect import.
 *
 * See [[21-phase-2-auth-design]] + ADR-013.
 */
import { createAuthClient } from 'better-auth/client';
import { magicLinkClient } from 'better-auth/client/plugins';
import { adoptDemoData, clearOrphanedRows } from './adopt';

type User = { id: string; email: string; name?: string };

// Auth API base. In dev, `VITE_AUTH_SERVER` is unset and Vite proxies same-origin
// `/api/auth/*` to :6543. In prod the web (Pages) and API (tunnel) are
// cross-origin; setting `VITE_AUTH_SERVER=https://innerio-api.dohkku.dev` at
// build time bakes the absolute URL into the bundle. SSR is disabled app-wide
// so `window` is defined at module load.
const AUTH_BASE = import.meta.env.VITE_AUTH_SERVER ?? window.location.origin;
export const AUTH_API = `${AUTH_BASE}/api/auth`;

export const authClient = createAuthClient({
  baseURL: AUTH_API,
  plugins: [magicLinkClient()],
});

// Better Auth resolves a relative `callbackURL` against `baseURL` (the API
// origin). In our split deploy that lands the magic-link click on
// innerio-api.dohkku.dev/ — wrong host, no app there. Always absolutize
// against the browser's current origin so the post-verify redirect goes
// back to the web app.
function absoluteCallback(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

export type AuthConfig = {
  providers: { google: boolean };
  features: { magicLink: boolean };
};

class SessionStore {
  user = $state<User | null>(null);
  ready = $state(false);
  config = $state<AuthConfig | null>(null);

  async refresh(): Promise<void> {
    const res = await authClient.getSession();
    const next = res.data?.user
      ? {
          id: res.data.user.id,
          email: res.data.user.email,
          name: res.data.user.name ?? undefined,
        }
      : null;
    if (next) {
      this.user = next;
      await this.attachTriplitToken();
      // E2EE init runs AFTER triplit token so user_id is locked in.
      // Fire-and-forget: setup/unlock UI gates content writes itself.
      // Migration sweep kicks off after the user finishes setup/unlock.
      const userId = next.id;
      void cryptoStore
        .init(userId)
        .then(() => {
          if (cryptoStore.isUnlocked) void this.kickMigrationSweep(userId);
        })
        .catch((err) => {
          console.error('[crypto] init failed', err);
        });
    } else {
      const wasLoggedIn = this.user !== null;
      this.user = null;
      setTriplitUserId('');
      if (wasLoggedIn) await triplit.endSession();
      await cryptoStore.reset();
    }
    this.ready = true;
  }

  /**
   * One-shot legacy plaintext → ciphertext sweep (Phase 9 slice 6). Runs
   * after every successful unlock; idempotent so repeated runs are cheap.
   * Logged-only for v1 — slow migrations on huge datasets would warrant
   * a progress UI later.
   */
  private migrating = false;
  async kickMigrationSweep(userId: string): Promise<void> {
    if (this.migrating) return;
    this.migrating = true;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: triplit override surface is loose
      const summary = await runMigrationSweep(triplit as any, userId);
      if (summary.totalRows > 0) {
        console.log(
          JSON.stringify({
            msg: 'crypto_migration_sweep',
            user_id: userId,
            ...summary,
          }),
        );
      }
    } catch (err) {
      console.error('[crypto] migration sweep failed', err);
    } finally {
      this.migrating = false;
    }
  }

  async loadConfig(): Promise<void> {
    if (this.config) return;
    try {
      const res = await fetch(`${AUTH_API}/config`, { credentials: 'include' });
      if (!res.ok) return;
      this.config = (await res.json()) as AuthConfig;
    } catch {
      // Auth server unreachable — leave config null. /login renders only
      // magic-link in that case (better than a broken Google button).
    }
  }

  async attachTriplitToken(): Promise<void> {
    const res = await fetch(`${AUTH_API}/triplit-token`, { credentials: 'include' });
    if (!res.ok) return;
    const { token, user_id } = (await res.json()) as { token: string; user_id: string };
    // Adopt local demo rows BEFORE starting the synced session. Once the
    // session is active, the server's per-user permission rules reject any
    // write whose `user_id` doesn't match the token (C-1 from 2026-04-29
    // audit). Stamping demo rows beforehand means they pass the insert
    // filter on first sync push.
    setTriplitUserId(user_id);
    // Limpieza preventiva ANTES de adopt + startSession: si el server fue
    // wipeado y el navegador re-signupea, IDB local arrastra rows del
    // user_id viejo cifrados con DEK viejo + AAD bind al user_id viejo.
    // Dejarlos provoca un banner de errores de descifrado masivo al borrar
    // o al re-emitir subscribes. Ver doc en clearOrphanedRows.
    await clearOrphanedRows(user_id);
    await adoptDemoData(user_id);
    // `refreshHandler`: Triplit lo llama ~500ms antes de que el JWT caduque y
    // también cuando el server rechaza el token por expirado. Devolver uno
    // fresco mantiene el WebSocket vivo sin obligar a re-login. Si el fetch
    // falla (server caído o sesión perdida) devolvemos null: Triplit cae a
    // CLOSED y el listener de visibilidad del layout reintenta `connect()` al
    // volver a primer plano. Sin esto, en móvil el token expiraba mientras la
    // app estaba congelada en background y la sync se quedaba muerta para
    // siempre (estado fosilizado).
    await triplit.startSession(token, true, {
      refreshHandler: async () => {
        try {
          const r = await fetch(`${AUTH_API}/triplit-token`, { credentials: 'include' });
          if (!r.ok) return null;
          const next = (await r.json()) as { token?: string };
          return next.token ?? null;
        } catch {
          return null;
        }
      },
    });
  }

  async deleteAccount(): Promise<void> {
    const res = await fetch(`${AUTH_API}/delete-user`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      // Don't clear local state on failure — leave the user signed in so the
      // UI can surface the error and they don't think they're logged out
      // while their account silently survives.
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        // ignore
      }
      throw new Error(`No se pudo eliminar la cuenta (HTTP ${res.status}). ${detail}`.trim());
    }
    this.user = null;
    setTriplitUserId('');
    await triplit.endSession();
    await cryptoStore.reset();
  }

  async signInWithGoogle(callbackURL = '/'): Promise<void> {
    await authClient.signIn.social({
      provider: 'google',
      callbackURL: absoluteCallback(callbackURL),
    });
  }

  async sendMagicLink(email: string, callbackURL = '/'): Promise<void> {
    await authClient.signIn.magicLink({ email, callbackURL: absoluteCallback(callbackURL) });
  }

  async signOut(): Promise<void> {
    await authClient.signOut();
    this.user = null;
    setTriplitUserId('');
    await triplit.endSession();
    await cryptoStore.reset();
  }
}

// Lazy singleton — see crypto.svelte.ts for the chunk-cycle backstory.
// Top-level `new SessionStore()` would invoke `$state(...)` during the app
// chunk's body, before Svelte's runtime had finished initialising.
let _sessionInstance: SessionStore | undefined;
function getSessionInstance(): SessionStore {
  if (!_sessionInstance) _sessionInstance = new SessionStore();
  return _sessionInstance;
}
export const session: SessionStore = new Proxy({} as SessionStore, {
  get(_t, prop) {
    const target = getSessionInstance();
    const v = Reflect.get(target, prop, target);
    return typeof v === 'function' ? v.bind(target) : v;
  },
  set(_t, prop, value) {
    const target = getSessionInstance();
    return Reflect.set(target, prop, value, target);
  },
  has(_t, prop) {
    return prop in getSessionInstance();
  },
});

if (typeof window !== 'undefined') {
  // Defer to a microtask so the singleton's first access (which constructs
  // it and runs the `$state(...)` field initialisers) happens after the
  // current sync task — i.e. after every chunk's module body has finished
  // evaluating and Svelte's runtime is fully initialised. Without this,
  // top-level `void session.refresh()` would trigger the same boot crash
  // we work around in crypto.svelte.ts.
  queueMicrotask(() => {
    // Fire-and-forget: layout doesn't await this. Pages that need session.ready
    // can read the rune.
    void session.refresh();
    void session.loadConfig();

    // Auto-trigger E2EE migration sweep on every unlock event. The
    // listener registers once at module load; cryptoStore.onUnlock fires
    // immediately if already unlocked and on every subsequent unlock
    // (setup / unlockWithPassphrase / unlockWithMnemonic / cached-DEK
    // fast path). kickMigrationSweep's internal `migrating` flag dedups.
    cryptoStore.onUnlock(() => {
      if (session.user) void session.kickMigrationSweep(session.user.id);
    });
  });
}
