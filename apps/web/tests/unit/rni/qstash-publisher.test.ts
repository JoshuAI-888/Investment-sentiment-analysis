import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RniQstashPublisher } from '../../../src/rni/orchestration/qstash-publisher';

const destination = 'https://app.test/api/internal/rni/combined';
const token = 'server-only-qstash-token';
const payload = {
  version: 'rni-combined-v1',
  runId: '00000000-0000-4000-8000-000000000902',
  planHash: 'a'.repeat(64),
  deliveryKey: 'combined-exact-delivery',
  attempt: 1,
};
const input = {
  payload,
  idempotencyKey: payload.deliveryKey,
  notBefore: '2026-09-05T12:00:00.000123Z',
};
const fetcher = vi.fn<typeof fetch>();

describe('RNI QStash publisher transport', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'message-1' }), { status: 200 }),
    );
  });

  it('sends the exact destination, payload, deduplication identity and rounded-up not-before header', async () => {
    const publisher = new RniQstashPublisher(token, destination, fetcher);
    expect(await publisher.publish(input)).toEqual({ messageId: 'message-1' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `https://qstash.upstash.io/v2/publish/${destination}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Upstash-Deduplication-Id': input.idempotencyKey,
          'Upstash-Method': 'POST',
          'Upstash-Not-Before': '1788609601',
          'Upstash-Retries': '3',
          'Upstash-Timeout': '15m',
        },
        body: JSON.stringify(payload),
        signal: expect.any(AbortSignal),
      },
    );
  });

  it.each([
    ['2026-09-05T12:00:00Z', '1788609600'],
    ['2026-09-05T12:00:00.000Z', '1788609600'],
    ['2026-09-05T12:00:00.125Z', '1788609601'],
    ['2026-09-05T12:00:00.000123Z', '1788609601'],
  ])('never schedules before exact instant %s', async (notBefore, expected) => {
    const publisher = new RniQstashPublisher(token, destination, fetcher);
    await publisher.publish({ ...input, notBefore });
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get('Upstash-Not-Before')).toBe(
      expected,
    );
  });

  it('retains the exact key and delivery body on deduplicated redelivery', async () => {
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            messageId: 'original-message',
            deduplicated: true,
            privateMetadata: 'not-returned',
          }),
          { status: 200 },
        ),
    );
    const publisher = new RniQstashPublisher(token, destination, fetcher);
    expect(await publisher.publish(input)).toEqual({ messageId: 'original-message' });
    expect(await publisher.publish(input)).toEqual({ messageId: 'original-message' });
    const first = fetcher.mock.calls[0]!;
    const second = fetcher.mock.calls[1]!;
    expect(second[0]).toBe(first[0]);
    expect(second[1]?.headers).toEqual(first[1]?.headers);
    expect(second[1]?.body).toBe(first[1]?.body);
  });

  it.each([400, 401, 429, 500, 503])(
    'sanitizes non-2xx status %s without reading the provider body',
    async (status) => {
      const response = new Response(`private-provider-body ${token} ${JSON.stringify(payload)}`, {
        status,
      });
      const readText = vi.spyOn(response, 'text');
      const readJson = vi.spyOn(response, 'json');
      fetcher.mockResolvedValue(response);
      const publisher = new RniQstashPublisher(token, destination, fetcher);
      await expect(publisher.publish(input)).rejects.toThrow(
        new Error(`QStash publish failed with status ${status}`),
      );
      expect(readText).not.toHaveBeenCalled();
      expect(readJson).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each(['', 'not-an-instant'])(
    'rejects invalid not-before %j without fetching',
    async (notBefore) => {
      const publisher = new RniQstashPublisher(token, destination, fetcher);
      await expect(publisher.publish({ ...input, notBefore })).rejects.toThrow(
        'Invalid QStash delivery instant',
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'k'.repeat(201)])(
    'rejects invalid deduplication key %j without fetching',
    async (idempotencyKey) => {
      const publisher = new RniQstashPublisher(token, destination, fetcher);
      await expect(publisher.publish({ ...input, idempotencyKey })).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { messageId: '' },
    { messageId: 7 },
    { messageId: 'message-1', deduplicated: 'yes' },
  ])('does not invent success for malformed response %j', async (body) => {
    fetcher.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const publisher = new RniQstashPublisher(token, destination, fetcher);
    await expect(publisher.publish(input)).rejects.toThrow();
  });

  it('requires a server token and valid destination at construction', () => {
    expect(() => new RniQstashPublisher('', destination, fetcher)).toThrow();
    expect(() => new RniQstashPublisher(token, 'not-a-url', fetcher)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
