import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@/contracts/evidence';
import {
  availabilityFromHeadCheck,
  recheckAvailability,
  type AvailabilityWritePort,
  type HeadChecker,
} from '@/services/evidence/availability';

describe('availabilityFromHeadCheck', () => {
  it.each([
    [200, 'available'],
    [204, 'available'],
    [404, 'removed'],
    [410, 'removed'],
    [401, 'paywalled'],
    [402, 'paywalled'],
    [403, 'paywalled'],
    [500, 'unreachable'],
    [503, 'unreachable'],
  ] as const)('maps HTTP %i to %s', (status, expected) => {
    expect(availabilityFromHeadCheck({ kind: 'response', status })).toBe(expected);
  });

  it('maps a network error to unreachable, never to removed', () => {
    expect(availabilityFromHeadCheck({ kind: 'network_error' })).toBe('unreachable');
  });
});

type StoredWrite = { itemId: string; availability: string; lastCheckedAt: Date };

function fakeWriter(): { port: AvailabilityWritePort; writes: StoredWrite[] } {
  const writes: StoredWrite[] = [];
  return {
    writes,
    port: {
      writeAvailability: async (input) => {
        writes.push({ itemId: input.itemId, availability: input.availability, lastCheckedAt: input.lastCheckedAt });
      },
    },
  };
}

function item(overrides: Partial<Pick<EvidenceItem, 'id' | 'sourceUrl' | 'availability'>>): Pick<EvidenceItem, 'id' | 'sourceUrl' | 'availability'> {
  return { id: 'i1', sourceUrl: 'https://example.com/a', availability: 'available', ...overrides };
}

describe('recheckAvailability', () => {
  it('writes the new availability and last_checked_at through the port, never touching a snippet', async () => {
    const { port, writes } = fakeWriter();
    const headChecker: HeadChecker = async () => ({ kind: 'response', status: 404 });
    const now = new Date('2026-09-04T00:00:00.000Z');

    const summary = await recheckAvailability([item({ availability: 'available' })], {
      headChecker,
      writer: port,
      now: () => now,
    });

    expect(summary).toEqual({ checked: 1, changed: 1, skippedNoUrl: 0 });
    expect(writes).toEqual([{ itemId: 'i1', availability: 'removed', lastCheckedAt: now }]);
    // The port's own type has no field for content/snippet — structurally cannot repair one.
    expect(Object.keys(writes[0] ?? {})).toEqual(['itemId', 'availability', 'lastCheckedAt']);
  });

  it('reports changed: 0 when the status confirms the existing state', async () => {
    const { port, writes } = fakeWriter();
    const headChecker: HeadChecker = async () => ({ kind: 'response', status: 200 });

    const summary = await recheckAvailability([item({ availability: 'available' })], {
      headChecker,
      writer: port,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(summary.changed).toBe(0);
    expect(writes).toHaveLength(1);
  });

  it('skips an item with no sourceUrl rather than guessing', async () => {
    const { port, writes } = fakeWriter();
    let calls = 0;
    const headChecker: HeadChecker = async () => {
      calls += 1;
      return { kind: 'response', status: 200 };
    };

    const summary = await recheckAvailability([item({ sourceUrl: null })], {
      headChecker,
      writer: port,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(summary).toEqual({ checked: 0, changed: 0, skippedNoUrl: 1 });
    expect(calls).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('never invalidates a run: a network error still records unreachable, not a thrown error', async () => {
    const { port, writes } = fakeWriter();
    const headChecker: HeadChecker = async () => ({ kind: 'network_error' });

    await recheckAvailability([item({})], {
      headChecker,
      writer: port,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(writes[0]?.availability).toBe('unreachable');
  });
});
