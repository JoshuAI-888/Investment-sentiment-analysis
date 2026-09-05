import { describe, expect, it } from 'vitest';
import { signQStashTokenForTesting, verifyQStashSignature } from '../../src/services/jobs/qstash';

const URL = 'https://investment-sentiment-analysis.vercel.app/api/cron/dispatch';
const BODY = '{"hello":"world"}';
const CURRENT_KEY = 'current-signing-key';
const NEXT_KEY = 'next-signing-key';

/**
 * F16 §4.1 step 1 / §5 "contract: QStash signature verification, positive and negative." No
 * live QStash sandbox is reachable from this session (`qstash.ts`'s own doc names this under
 * `RISKS`) — this file proves the verifier is internally consistent against tokens it signs
 * itself with the identical HMAC construction the module's own top doc describes.
 */
describe('verifyQStashSignature', () => {
  it('accepts a validly signed token against the current key', () => {
    const token = signQStashTokenForTesting({ key: CURRENT_KEY, url: URL, body: BODY });
    const result = verifyQStashSignature({ signatureHeader: token, body: BODY, url: URL, signingKeys: [CURRENT_KEY, NEXT_KEY] });
    expect(result).toEqual({ ok: true });
  });

  it('accepts a token signed with the NEXT key (rotation window)', () => {
    const token = signQStashTokenForTesting({ key: NEXT_KEY, url: URL, body: BODY });
    const result = verifyQStashSignature({ signatureHeader: token, body: BODY, url: URL, signingKeys: [CURRENT_KEY, NEXT_KEY] });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a missing header before any other check', () => {
    const result = verifyQStashSignature({ signatureHeader: null, body: BODY, url: URL, signingKeys: [CURRENT_KEY] });
    expect(result).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rejects when no signing keys are configured', () => {
    const token = signQStashTokenForTesting({ key: CURRENT_KEY, url: URL, body: BODY });
    const result = verifyQStashSignature({ signatureHeader: token, body: BODY, url: URL, signingKeys: [] });
    expect(result).toEqual({ ok: false, reason: 'no_signing_keys_configured' });
  });

  it('rejects a token signed with a key that matches neither configured key', () => {
    const token = signQStashTokenForTesting({ key: 'some-other-key', url: URL, body: BODY });
    const result = verifyQStashSignature({ signatureHeader: token, body: BODY, url: URL, signingKeys: [CURRENT_KEY, NEXT_KEY] });
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a malformed token that is not even JWT-shaped', () => {
    const result = verifyQStashSignature({ signatureHeader: 'not-a-jwt', body: BODY, url: URL, signingKeys: [CURRENT_KEY] });
    expect(result).toEqual({ ok: false, reason: 'malformed_token' });
  });

  it('rejects a tampered body even with a validly signed token', () => {
    const token = signQStashTokenForTesting({ key: CURRENT_KEY, url: URL, body: BODY });
    const result = verifyQStashSignature({ signatureHeader: token, body: '{"hello":"tampered"}', url: URL, signingKeys: [CURRENT_KEY] });
    expect(result).toEqual({ ok: false, reason: 'body_hash_mismatch' });
  });

  it('rejects a token minted for a different URL', () => {
    const token = signQStashTokenForTesting({ key: CURRENT_KEY, url: 'https://someone-else.example/api/cron/dispatch', body: BODY });
    const result = verifyQStashSignature({ signatureHeader: token, body: BODY, url: URL, signingKeys: [CURRENT_KEY] });
    expect(result).toEqual({ ok: false, reason: 'url_mismatch' });
  });

  it('rejects a token with the wrong issuer', () => {
    const token = signQStashTokenForTesting({ key: CURRENT_KEY, url: URL, body: BODY, overrides: { iss: 'SomeoneElse' } });
    const result = verifyQStashSignature({ signatureHeader: token, body: BODY, url: URL, signingKeys: [CURRENT_KEY] });
    expect(result).toEqual({ ok: false, reason: 'issuer_mismatch' });
  });

  it('rejects an expired token', () => {
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const token = signQStashTokenForTesting({ key: CURRENT_KEY, url: URL, body: BODY, issuedAt, expiresInSeconds: 60 });
    const result = verifyQStashSignature({
      signatureHeader: token,
      body: BODY,
      url: URL,
      signingKeys: [CURRENT_KEY],
      now: new Date(issuedAt.getTime() + 61_000),
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token not yet valid (nbf in the future)', () => {
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const token = signQStashTokenForTesting({
      key: CURRENT_KEY,
      url: URL,
      body: BODY,
      issuedAt,
      overrides: { nbf: Math.floor(issuedAt.getTime() / 1000) + 3600 },
    });
    const result = verifyQStashSignature({ signatureHeader: token, body: BODY, url: URL, signingKeys: [CURRENT_KEY], now: issuedAt });
    expect(result).toEqual({ ok: false, reason: 'not_yet_valid' });
  });

  it('rejects a token with a tampered signature (bit-flip)', () => {
    const token = signQStashTokenForTesting({ key: CURRENT_KEY, url: URL, body: BODY });
    const [h, p, s] = token.split('.');
    const tamperedSig = s === undefined ? '' : (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const result = verifyQStashSignature({ signatureHeader: `${h}.${p}.${tamperedSig}`, body: BODY, url: URL, signingKeys: [CURRENT_KEY] });
    expect(result.ok).toBe(false);
  });
});
