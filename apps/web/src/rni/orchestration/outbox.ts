import { z } from 'zod';
import { hashRniModelInput } from '@/rni/agents/model-input';
import { RniOrchestrationError } from './budget';
import { deliveryFor } from './refresh';
import { instant, platformDelivery, type RniPlatformDelivery } from './types';

export interface RniPlatformOutboxPort {
  /** Only committed, unacknowledged records for this trusted partition; oldest first. */
  pending(at: string, limit: number): Promise<readonly unknown[]>;
  /** Compare exact key and payload hash, then acknowledge. An ambiguous send stays pending. */
  markPublished(input: {
    deliveryKey: string;
    payloadHash: string;
    messageId: string;
  }): Promise<void>;
}

/** Queue transport adapter must forward the key as QStash deduplication identity. */
export interface RniQstashPublisherPort {
  publish(input: {
    payload: RniPlatformDelivery;
    idempotencyKey: string;
    notBefore: string;
  }): Promise<{ messageId: string }>;
}

/**
 * No claim/commit gap: records become visible only after request/retry transaction commit.
 * A crash after publish but before acknowledgment can send twice; the durable execution claim
 * remains the authority even after the queue provider's deduplication window expires.
 */
export async function relayRniPlatformOutbox(deps: {
  outbox: RniPlatformOutboxPort;
  publisher: RniQstashPublisherPort;
  now: Date;
  limit?: number;
}): Promise<number> {
  const limit = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(deps.limit ?? 25);
  const at = instant.parse(deps.now.toISOString());
  const rows = await deps.outbox.pending(at, limit);
  if (rows.length > limit) throw new RniOrchestrationError('INVALID_PLAN');
  // Parse and bind the complete batch before the first external write.
  const entries = rows.map((raw) => {
    const entry = z.object({ delivery: platformDelivery, notBefore: instant }).strict().parse(raw);
    const delivery = entry.delivery;
    if (
      hashRniModelInput(delivery) !==
      hashRniModelInput(
        deliveryFor(delivery.runId, delivery.platform, delivery.planHash, delivery.attempt),
      )
    ) {
      throw new RniOrchestrationError('CONFLICT');
    }
    return entry;
  });
  let published = 0;
  for (const entry of entries) {
    if (Date.parse(entry.notBefore) > Date.parse(at)) continue;
    const result = z
      .object({ messageId: z.string().min(1).max(500) })
      .strict()
      .parse(
        await deps.publisher.publish({
          payload: entry.delivery,
          idempotencyKey: entry.delivery.deliveryKey,
          notBefore: entry.notBefore,
        }),
      );
    await deps.outbox.markPublished({
      deliveryKey: entry.delivery.deliveryKey,
      payloadHash: hashRniModelInput(entry.delivery),
      messageId: result.messageId,
    });
    published++;
  }
  return published;
}
