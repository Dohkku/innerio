/**
 * QR pairing helpers (Phase 4 revival, ADR-032).
 *
 * Permite transferir las credenciales E2EE de un dispositivo logueado +
 * unlocked a otro dispositivo, sin que la passphrase pase por servidor.
 * El QR es base64 de un JSON pequeño; decode + validate ocurre solo en el
 * dispositivo receptor.
 *
 * Modelo de seguridad: igual que WhatsApp Web / Signal Desktop. Quien ve
 * tu pantalla durante esos 60s ve la passphrase. Por eso TTL corto + QR
 * single-use (botón "Mostrar de nuevo" regenera con ts fresco).
 *
 * Persistence intermedio: sessionStorage hasta que el unlock tenga éxito.
 * Tab close → se pierde; no queda en localStorage en claro.
 */

const SS_KEY = 'gtd:pair:pending';
const QR_VERSION = 1 as const;
const MAX_AGE_MS = 60_000;

export type PairPayload = {
  v: typeof QR_VERSION;
  endpoint: string;
  email: string;
  passphrase: string;
  ts: number;
  /**
   * One-shot magic-link verify URL pre-minted by /api/auth/pair-mint.
   * If present, the mobile can navigate directly to it after scanning and
   * gets a fresh session cookie without an email round-trip. Older PC
   * builds may emit payloads without this field; the mobile falls back to
   * triggering a normal magic-link email.
   */
  verifyUrl?: string;
};

export function buildPairPayload(args: {
  endpoint: string;
  email: string;
  passphrase: string;
  verifyUrl?: string;
}): string {
  const payload: PairPayload = {
    v: QR_VERSION,
    endpoint: args.endpoint,
    email: args.email,
    passphrase: args.passphrase,
    ts: Date.now(),
    ...(args.verifyUrl ? { verifyUrl: args.verifyUrl } : {}),
  };
  // Base64url-encode JSON. URL-safe by removing +/= so the QR data section
  // doesn't trigger uppercase mode in some scanners.
  const json = JSON.stringify(payload);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The payload arrives from a QR or a URL hash, i.e. from anyone. `/pair`
 * navigates (or fetches) to `verifyUrl`, so it must be our own magic-link
 * endpoint and nothing else: a `javascript:` URL would run script in the app
 * origin and an external one would be an open redirect (security review
 * 2026-10-24, A-1).
 */
function isVerifyUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    const authBase = import.meta.env.VITE_AUTH_SERVER || window.location.origin;
    return (
      u.protocol === 'https:' &&
      u.origin === new URL(authBase).origin &&
      u.pathname === '/api/auth/magic-link/verify'
    );
  } catch {
    return false;
  }
}

export function parsePairPayload(raw: string): PairPayload | null {
  try {
    // Restore base64 padding.
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4;
    const full = pad ? padded + '='.repeat(4 - pad) : padded;
    const obj = JSON.parse(atob(full)) as PairPayload;
    if (obj.v !== QR_VERSION) return null;
    if (typeof obj.endpoint !== 'string') return null;
    if (typeof obj.email !== 'string') return null;
    if (typeof obj.passphrase !== 'string') return null;
    if (typeof obj.ts !== 'number') return null;
    // A ts in the future would never expire; allow one minute of clock skew.
    if (obj.ts > Date.now() + 60_000) return null;
    if (Date.now() - obj.ts > MAX_AGE_MS) return null;
    if (obj.verifyUrl !== undefined && !isVerifyUrl(obj.verifyUrl)) return null;
    return obj;
  } catch {
    return null;
  }
}

export function storePendingPairing(payload: PairPayload): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may fail in private mode; pairing won't auto-resume,
    // but the user can scan again post-login.
  }
}

export function readPendingPairing(): PairPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as PairPayload;
    if (Date.now() - obj.ts > MAX_AGE_MS) {
      sessionStorage.removeItem(SS_KEY);
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

export function clearPendingPairing(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SS_KEY);
  } catch {
    // ignore
  }
}
