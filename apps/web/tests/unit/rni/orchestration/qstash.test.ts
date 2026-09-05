import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { consumeRniQstash, verifyRniQstashRequest } from '@/rni/orchestration/qstash';
import { harness, START, uuid } from './fixture';

const current = 'test-current-signing-key',
  next = 'test-next-signing-key';
const destination = 'https://example.com/api/rni/queue';
const now = Math.floor(Date.parse(START) / 1000);
function signed(
  body: string,
  key = current,
  overrides: Record<string, unknown> = {},
  alg = 'HS256',
) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg, typ: 'JWT' });
  const payload = encode({
    iss: 'Upstash',
    sub: destination,
    exp: now + 300,
    iat: now,
    nbf: now,
    jti: 'jwt_test',
    body: createHash('sha256').update(body).digest('base64url') + '=',
    ...overrides,
  });
  const signature = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
function request(rawBody = '{"value":1}', key = current, overrides: Record<string, unknown> = {}) {
  return {
    rawBody,
    signature: signed(rawBody, key, overrides),
    expectedUrl: destination,
    currentSigningKey: current,
    nextSigningKey: next,
    now: new Date(START),
  };
}

describe('QStash cryptographic verification', () => {
  it.each([current, next])(
    'accepts the configured signing key %s and the documented padded body digest',
    (key) => {
      expect(verifyRniQstashRequest(request(undefined, key))).toEqual({ tokenId: 'jwt_test' });
    },
  );

  it.each([
    { iss: 'attacker' },
    { sub: 'https://elsewhere.example/api/rni/queue' },
    { exp: now },
    { nbf: now + 1 },
    { iat: now + 1 },
    { body: 'a'.repeat(43) },
    { exp: '99999999999' },
  ])('rejects invalid claims before the callback: %j', async (overrides) => {
    const callback = vi.fn();
    await expect(
      consumeRniQstash(request(undefined, current, overrides), z.unknown(), callback),
    ).rejects.toThrow('INVALID_SIGNATURE');
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects tampered raw bytes, missing/unknown signatures and algorithm confusion with a stable redacted failure', async () => {
    const callback = vi.fn();
    const good = request();
    const invalid = [
      { ...good, rawBody: '{ "value":1}' },
      { ...good, signature: null },
      { ...good, signature: signed(good.rawBody, 'wrong-key') },
      { ...good, signature: signed(good.rawBody, current, {}, 'none') },
      { ...good, currentSigningKey: '' },
      { ...good, nextSigningKey: '' },
      { ...good, signature: 'TOKEN_SECRET.invalid.JWT' },
      { ...good, signature: good.signature + '=' },
    ];
    for (const input of invalid) {
      await expect(consumeRniQstash(input, z.unknown(), callback)).rejects.toThrow(
        'RNI orchestration: INVALID_SIGNATURE',
      );
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it('validates signed payloads before callback and bounds body/token sizes', async () => {
    const callback = vi.fn();
    await expect(
      consumeRniQstash(
        request('{"value":1,"unexpected":true}'),
        z.object({ value: z.number() }).strict(),
        callback,
      ),
    ).rejects.toThrow();
    await expect(
      consumeRniQstash(request('x'.repeat(32_769)), z.unknown(), callback),
    ).rejects.toThrow('INVALID_SIGNATURE');
    await expect(
      consumeRniQstash({ ...request(), signature: 'x'.repeat(8193) }, z.unknown(), callback),
    ).rejects.toThrow('INVALID_SIGNATURE');
    expect(callback).not.toHaveBeenCalled();
  });

  it('three cryptographically verified scheduled redeliveries produce one durable run and two platform jobs', async () => {
    const h = harness();
    const body = JSON.stringify({ jobId: uuid(800), dueAt: START });
    const schema = z.object({ jobId: z.string().uuid(), dueAt: z.string().datetime() }).strict();
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        consumeRniQstash(request(body), schema, (payload) => h.service.schedule(payload)),
      ),
    );
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    expect(results.filter((result) => result.disposition === 'accepted')).toHaveLength(1);
    expect(h.store.data.outbox.size).toBe(2);
    expect(h.store.data.jobs).toHaveLength(1);
  });
});
