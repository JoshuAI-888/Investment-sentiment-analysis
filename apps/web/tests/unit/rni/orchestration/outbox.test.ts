import { describe, expect, it } from 'vitest';
import {
  relayRniPlatformOutbox,
  type RniPlatformOutboxPort,
  type RniQstashPublisherPort,
} from '@/rni/orchestration/outbox';
import { hashRniModelInput } from '@/rni/agents/model-input';
import { harness, scope, START } from './fixture';

describe('RNI transactional outbox relay primitive', () => {
  it('recovers an ambiguous publish/ack crash with the exact same delivery identity and one acquired execution', async () => {
    const h = harness();
    await h.service.requestManualRefresh({ idempotencyKey: 'a', scope });
    const entries = [...h.store.data.outbox.values()];
    let failAck = true;
    const acknowledged = new Set<string>();
    const sends: Parameters<RniQstashPublisherPort['publish']>[0][] = [];
    const claims: string[] = [];
    const outbox: RniPlatformOutboxPort = {
      pending: async () => entries.filter((entry) => !acknowledged.has(entry.delivery.deliveryKey)),
      markPublished: async ({ deliveryKey, payloadHash }) => {
        if (failAck) throw new Error('crash after queue acceptance');
        const entry = entries.find((entry) => entry.delivery.deliveryKey === deliveryKey)!;
        expect(payloadHash).toBe(hashRniModelInput(entry.delivery));
        acknowledged.add(deliveryKey);
      },
    };
    const publisher: RniQstashPublisherPort = {
      publish: async (input) => {
        sends.push(input);
        claims.push((await h.worker.claim(input.payload)).status);
        return { messageId: `message-${sends.length}` };
      },
    };
    await expect(
      relayRniPlatformOutbox({ outbox, publisher, now: new Date(START) }),
    ).rejects.toThrow('crash');
    expect(acknowledged.size).toBe(0);
    failAck = false;
    expect(await relayRniPlatformOutbox({ outbox, publisher, now: new Date(START) })).toBe(2);
    expect(sends[0]).toEqual(sends[1]);
    expect(claims).toEqual(['acquired', 'busy', 'acquired']);
    expect(await relayRniPlatformOutbox({ outbox, publisher, now: new Date(START) })).toBe(0);
  });

  it('rejects a crossed outbox payload before publishing any member of the batch', async () => {
    const h = harness();
    await h.service.requestManualRefresh({ idempotencyKey: 'a', scope });
    const entries = [...h.store.data.outbox.values()];
    entries[1]!.delivery.deliveryKey = 'crossed';
    let sends = 0;
    await expect(
      relayRniPlatformOutbox({
        outbox: { pending: async () => entries, markPublished: async () => undefined },
        publisher: {
          publish: async () => {
            sends++;
            return { messageId: 'no' };
          },
        },
        now: new Date(START),
      }),
    ).rejects.toThrow('CONFLICT');
    expect(sends).toBe(0);
  });

  it('retains unpublished records after a transport failure and does not publish before retry timing', async () => {
    const h = harness();
    await h.service.requestManualRefresh({ idempotencyKey: 'a', scope });
    const entry = [...h.store.data.outbox.values()][0]!;
    let acknowledged = false;
    const outbox = {
      pending: async () => [entry],
      markPublished: async () => {
        acknowledged = true;
      },
    };
    const publisher = {
      publish: async (): Promise<{ messageId: string }> => {
        throw new Error('unavailable');
      },
    };
    await expect(
      relayRniPlatformOutbox({ outbox, publisher, now: new Date(START) }),
    ).rejects.toThrow('unavailable');
    expect(acknowledged).toBe(false);
    entry.notBefore = '2026-09-05T00:01:00.000Z';
    expect(await relayRniPlatformOutbox({ outbox, publisher, now: new Date(START) })).toBe(0);
  });
});
