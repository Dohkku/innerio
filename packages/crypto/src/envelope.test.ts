import { base64urlnopad } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { decodeEnvelope, encodeEnvelope } from './envelope';
import type { Envelope } from './types';

const enc = new TextEncoder();

describe('envelope codec', () => {
  it('round-trips', () => {
    const env: Envelope = { v: 1, n: 'abc', c: 'def' };
    expect(decodeEnvelope(encodeEnvelope(env))).toEqual(env);
  });

  it('rejects garbage base64', () => {
    expect(() => decodeEnvelope('not!valid!b64!@#')).toThrow(/decode envelope/);
  });

  it('rejects valid base64 of non-JSON', () => {
    const garbage = base64urlnopad.encode(enc.encode('plain text not json'));
    expect(() => decodeEnvelope(garbage)).toThrow(/decode envelope/);
  });

  it('rejects wrong shape', () => {
    const wrongShape = base64urlnopad.encode(enc.encode(JSON.stringify({ v: 1, n: 'a' })));
    expect(() => decodeEnvelope(wrongShape)).toThrow(/invalid envelope shape/);
  });

  it('accepts v=2 envelopes (ADR-018)', () => {
    const v2 = base64urlnopad.encode(enc.encode(JSON.stringify({ v: 2, n: 'a', c: 'b' })));
    const decoded = decodeEnvelope(v2);
    expect(decoded.v).toBe(2);
  });

  it('rejects unsupported version', () => {
    const wrongVer = base64urlnopad.encode(enc.encode(JSON.stringify({ v: 9, n: 'a', c: 'b' })));
    expect(() => decodeEnvelope(wrongVer)).toThrow(/invalid envelope shape/);
  });
});
