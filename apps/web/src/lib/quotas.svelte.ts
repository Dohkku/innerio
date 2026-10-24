/**
 * Quotas client helper — fetch + share quota state across components.
 *
 * Reads /api/quotas (auth-required). Mantiene un singleton reactive en runes
 * para que cualquier componente (banner upgrade, /settings/account, etc)
 * pueda observar el mismo state sin re-fetch redundante.
 *
 * En modo anonymous (sin sesión Better Auth) el fetch responde 401 → state
 * queda `null` y la UI puede ocultar los componentes relacionados.
 */

export type Tier = 'free' | 'paid';

export type QuotaState = {
  tier: Tier;
  bytes_used: number;
  items_count: number;
  limits: { items: number; bytes: number };
  over_quota: boolean;
  updated_at: number;
};

const AUTH_BASE = import.meta.env.VITE_AUTH_SERVER ?? '';

class QuotaStore {
  state = $state<QuotaState | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  async refresh(force = false): Promise<void> {
    if (typeof window === 'undefined') return;
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    try {
      const url = new URL('/api/quotas', AUTH_BASE || window.location.origin);
      if (force) url.searchParams.set('refresh', '1');
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 401) {
        // Anonymous user — no quota concept.
        this.state = null;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.state = (await res.json()) as QuotaState;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }
}

export const quotas = new QuotaStore();

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}
