/**
 * Admin Triplit HTTP client — used server-side for system-level operations
 * that need to bypass per-user permission rules:
 *   - agent-tokens.ts (token issuance / lookup / revocation)
 *   - auth.ts afterDelete hook (cascade-delete user content)
 *
 * The admin token carries `'x-triplit-token-type': 'secret'` (full admin in
 * Triplit) and is signed with the same `TRIPLIT_JWT_SECRET` the server uses
 * to validate user tokens.
 *
 * Cache strategy: keep one shared HttpClient and refresh the bearer token
 * before its 24h expiry. M-3 from the 2026-04-29 audit fix: the previous
 * per-module cache let the token go stale silently; here we mint a fresh
 * one every 12h (half of the expiry window).
 */
import { type Schema, schema } from '@gtd/schema';
import { HttpClient } from '@triplit/client';
import { SignJWT } from 'jose';

const TOKEN_EXPIRY = '24h';
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000; // half of 24h

let cached: { client: HttpClient<Schema>; mintedAt: number } | null = null;

async function mintAdminToken(jwtSecret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  return new SignJWT({
    user_id: '',
    'x-triplit-token-type': 'secret',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('system')
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(secretKey);
}

export async function getAdminClient(): Promise<HttpClient<Schema>> {
  if (cached && Date.now() - cached.mintedAt < REFRESH_AFTER_MS) {
    return cached.client;
  }
  const jwtSecret = process.env.TRIPLIT_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('TRIPLIT_JWT_SECRET not set — admin client cannot mint a token');
  }
  const port = Number(process.env.PORT ?? 6543);
  const adminToken = await mintAdminToken(jwtSecret);
  cached = {
    client: new HttpClient<Schema>({
      serverUrl: `http://localhost:${port}`,
      token: adminToken,
      schema: schema as Schema,
    }),
    mintedAt: Date.now(),
  };
  return cached.client;
}
