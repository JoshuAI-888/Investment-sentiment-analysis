import { describe, expect, it, vi } from 'vitest';
import {
  checkAvailability,
  runAvailabilityCheckJob,
  type AvailabilityHeadRequester,
  type HeadOutcome,
} from '@/services/evidence/availability-checker';

function scriptedRequester(script: Record<string, HeadOutcome>): AvailabilityHeadRequester {
  return {
    head: async (url) => {
      const outcome = script[url];
      if (outcome === undefined) throw new Error(`no scripted outcome for ${url}`);
      return outcome;
    },
  };
}

const NOW = new Date('2026-09-04T12:00:00Z');

describe('checkAvailability — F10 §4.6 / F-19', () => {
  it('maps a 2xx to available', async () => {
    const requester = scriptedRequester({ 'https://a.example/1': { kind: 'status', status: 200 } });
    const results = await checkAvailability(
      [{ id: 'i1', sourceUrl: 'https://a.example/1' }],
      requester,
      { now: () => NOW },
    );
    expect(results).toEqual([{ id: 'i1', availability: 'available', lastCheckedAt: NOW }]);
  });

  it('maps 404/410 to removed', async () => {
    const requester = scriptedRequester({
      'https://a.example/1': { kind: 'status', status: 404 },
      'https://a.example/2': { kind: 'status', status: 410 },
    });
    const results = await checkAvailability(
      [
        { id: 'i1', sourceUrl: 'https://a.example/1' },
        { id: 'i2', sourceUrl: 'https://a.example/2' },
      ],
      requester,
      { now: () => NOW },
    );
    expect(results.map((r) => r.availability)).toEqual(['removed', 'removed']);
  });

  it('maps 401/402/403 to paywalled', async () => {
    const requester = scriptedRequester({ 'https://a.example/1': { kind: 'status', status: 403 } });
    const results = await checkAvailability([{ id: 'i1', sourceUrl: 'https://a.example/1' }], requester, {
      now: () => NOW,
    });
    expect(results[0]?.availability).toBe('paywalled');
  });

  it('maps a timeout and a network error to unreachable, never to removed or available', async () => {
    const requester = scriptedRequester({
      'https://a.example/1': { kind: 'timeout' },
      'https://a.example/2': { kind: 'network_error' },
    });
    const results = await checkAvailability(
      [
        { id: 'i1', sourceUrl: 'https://a.example/1' },
        { id: 'i2', sourceUrl: 'https://a.example/2' },
      ],
      requester,
      { now: () => NOW },
    );
    expect(results.map((r) => r.availability)).toEqual(['unreachable', 'unreachable']);
  });

  it('skips a target with no sourceUrl rather than fabricating a check', async () => {
    const requester = scriptedRequester({});
    const results = await checkAvailability([{ id: 'i1', sourceUrl: null }], requester, { now: () => NOW });
    expect(results).toHaveLength(0);
  });

  it('never returns a field other than id, availability and lastCheckedAt — snippet is untouched', async () => {
    const requester = scriptedRequester({ 'https://a.example/1': { kind: 'status', status: 200 } });
    const results = await checkAvailability([{ id: 'i1', sourceUrl: 'https://a.example/1' }], requester, {
      now: () => NOW,
    });
    expect(Object.keys(results[0] as object).sort()).toEqual(['availability', 'id', 'lastCheckedAt']);
  });
});

describe('runAvailabilityCheckJob', () => {
  it('loads, checks, and persists — and never persists when there is nothing to check', async () => {
    const persist = vi.fn(async () => undefined);
    const requester = scriptedRequester({ 'https://a.example/1': { kind: 'status', status: 200 } });

    const outcome = await runAvailabilityCheckJob({
      loadTargets: async () => [{ id: 'i1', sourceUrl: 'https://a.example/1' }],
      persist,
      requester,
      now: () => NOW,
    });

    expect(outcome).toEqual({ checked: 1 });
    expect(persist).toHaveBeenCalledWith([{ id: 'i1', availability: 'available', lastCheckedAt: NOW }]);
  });

  it('does not call persist for an empty target set', async () => {
    const persist = vi.fn(async () => undefined);
    const requester = scriptedRequester({});

    const outcome = await runAvailabilityCheckJob({
      loadTargets: async () => [],
      persist,
      requester,
      now: () => NOW,
    });

    expect(outcome).toEqual({ checked: 0 });
    expect(persist).not.toHaveBeenCalled();
  });
});
