import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePairPayload } from './pairing';

const API = 'https://app.innerio.frederickandrade.com';

function encode(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function payload(extra: Record<string, unknown> = {}): string {
  return encode({
    v: 1,
    endpoint: API,
    email: 'a@b.c',
    passphrase: 'x',
    ts: Date.now(),
    ...extra,
  });
}

describe('parsePairPayload (security review 2026-10-24, A-1)', () => {
  beforeEach(() => vi.stubEnv('VITE_AUTH_SERVER', API));
  afterEach(() => vi.unstubAllEnvs());

  it('accepts our own magic-link verify URL', () => {
    const url = `${API}/api/auth/magic-link/verify?token=t&callbackURL=%2Fpair`;
    expect(parsePairPayload(payload({ verifyUrl: url }))?.verifyUrl).toBe(url);
  });

  it('accepts a payload without verifyUrl', () => {
    expect(parsePairPayload(payload())).not.toBeNull();
  });

  it.each([
    ['javascript URL', 'javascript:alert(1)'],
    ['other origin', 'https://evil.example/api/auth/magic-link/verify?token=t'],
    ['other path on our origin', `${API}/settings`],
    ['plain http', 'http://app.innerio.frederickandrade.com/api/auth/magic-link/verify'],
    ['not a URL', 'nope'],
  ])('rejects %s', (_label, verifyUrl) => {
    expect(parsePairPayload(payload({ verifyUrl }))).toBeNull();
  });

  it('rejects timestamps in the future (they would never expire)', () => {
    expect(parsePairPayload(payload({ ts: Date.now() + 10 * 60_000 }))).toBeNull();
  });

  it('rejects expired payloads', () => {
    expect(parsePairPayload(payload({ ts: Date.now() - 5 * 60_000 }))).toBeNull();
  });
});
