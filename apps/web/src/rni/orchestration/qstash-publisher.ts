import { z } from 'zod';
import type { RniQstashPublisherPort } from './outbox';

const publishResponse = z
  .object({ messageId: z.string().min(1), deduplicated: z.boolean().optional() })
  .passthrough();

function unixCeilingSeconds(value: string): number {
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  if (!parsed.success) throw new Error('Invalid QStash delivery instant');
  const instant = parsed.data;
  const milliseconds = Date.parse(instant);
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/u.exec(instant)?.[1] ?? '';
  const subMillisecond = fraction.slice(3).replace(/0+$/u, '').length > 0;
  const exactSecond = milliseconds % 1000 === 0 && !subMillisecond;
  return Math.floor(milliseconds / 1000) + (exactSecond ? 0 : 1);
}

/** Thin QStash transport; durable intent and exact replay live in the PostgreSQL outbox. */
export class RniQstashPublisher<T> implements RniQstashPublisherPort<T> {
  constructor(
    private readonly token: string,
    private readonly destination: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    z.string().min(1).parse(token);
    z.string().url().parse(destination);
  }

  async publish(input: {
    payload: T;
    idempotencyKey: string;
    notBefore: string;
  }): Promise<{ messageId: string }> {
    const notBefore = unixCeilingSeconds(input.notBefore);
    if (!Number.isSafeInteger(notBefore)) throw new Error('Invalid QStash delivery instant');
    const response = await this.fetcher(
      `https://qstash.upstash.io/v2/publish/${this.destination}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Upstash-Deduplication-Id': z.string().min(1).max(200).parse(input.idempotencyKey),
          'Upstash-Method': 'POST',
          'Upstash-Not-Before': String(notBefore),
          'Upstash-Retries': '3',
          // Match the maximum immutable RNI run window. A short callback timeout can exhaust every
          // redelivery while the original worker is still heartbeating, orphaning its claimed stage.
          'Upstash-Timeout': '15m',
        },
        body: JSON.stringify(input.payload),
        signal: AbortSignal.timeout(35_000),
      },
    );
    if (!response.ok) throw new Error(`QStash publish failed with status ${response.status}`);
    const parsed = publishResponse.parse(await response.json());
    return { messageId: parsed.messageId };
  }
}
