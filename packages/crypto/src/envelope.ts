/**
 * Envelope codec — JSON-serialise then base64url-encode so an envelope
 * fits cleanly into a single Triplit `S.String()` field.
 */

import { base64urlnopad } from '@scure/base';
import type { Envelope } from './types';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function encodeEnvelope(env: Envelope): string {
  return base64urlnopad.encode(TEXT_ENCODER.encode(JSON.stringify(env)));
}

export function decodeEnvelope(s: string): Envelope {
  let parsed: unknown;
  try {
    const raw = TEXT_DECODER.decode(base64urlnopad.decode(s));
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `crypto: cannot decode envelope (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const v = (parsed as { v?: unknown }).v;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (v !== 1 && v !== 2) ||
    typeof (parsed as { n?: unknown }).n !== 'string' ||
    typeof (parsed as { c?: unknown }).c !== 'string'
  ) {
    throw new Error('crypto: invalid envelope shape');
  }
  return parsed as Envelope;
}
