import { describe, expect, it } from 'vitest';
import {
  classifyStatus,
  classifyThrown,
  errorClass,
  parseRetryAfter,
  RequestTimeout,
  TRANSIENT_STATUSES,
} from '@/adapters/errors';
import { MAX_RETRIES, backoffDelayMs, retryDecision } from '@/adapters/retry';
import { NEVER_RETRIED } from '@/contracts/provider';
import { FAILURE_THRESHOLD, OPEN_DURATION_MS, admit, recordFailure, recordSuccess } from '@/adapters/breaker';
import { BUCKETS, acquire, refill } from '@/adapters/rate-limit';
import { cacheKey, hourBucket, rateKey, requestFingerprint, utcDayBucket } from '@/adapters/cache-key';
import { fakeBreaker, fakeClock, fakeRateLimiter } from './fakes';

const seeded = { baseMs: 500, factor: 2, capMs: 8_000, random: () => 0.5 };

describe('error classification', () => {
  it('maps 401 and 403 to entitlement, and nothing else', () => {
    expect(classifyStatus({ status: 401, endpoint: 'quote', retryAfterMs: null })).toEqual({
      kind: 'entitlement',
      endpoint: 'quote',
      status: 401,
    });
    expect(classifyStatus({ status: 403, endpoint: 'quote', retryAfterMs: null })?.kind).toBe('entitlement');

    // 404 is equally un-retryable but is NOT an entitlement failure. Calling it one would put
    // "the symbol does not exist" into provider-entitlements.md as a denied endpoint.
    expect(classifyStatus({ status: 404, endpoint: 'quote', retryAfterMs: null })).toEqual({
      kind: 'upstream',
      status: 404,
    });
  });

  it('treats a 2xx as no error at all', () => {
    expect(classifyStatus({ status: 200, endpoint: 'quote', retryAfterMs: null })).toBeNull();
    expect(classifyStatus({ status: 204, endpoint: 'quote', retryAfterMs: null })).toBeNull();
  });

  it('classifies a 408 as a timeout rather than an upstream failure', () => {
    expect(classifyStatus({ status: 408, endpoint: 'quote', retryAfterMs: null })).toEqual({ kind: 'timeout' });
  });

  it('classifies an abort as a timeout and an unknown throw as upstream 0', () => {
    expect(classifyThrown(new RequestTimeout(5000))).toEqual({ kind: 'timeout' });
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyThrown(abort)).toEqual({ kind: 'timeout' });
    expect(classifyThrown(new Error('ECONNRESET'))).toEqual({ kind: 'upstream', status: 0 });
  });

  it('parses Retry-After as seconds and as an HTTP date', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Sun, 30 Aug 2026 12:02:00 GMT', now)).toBe(120_000);
    expect(parseRetryAfter(undefined, now)).toBeNull();
    expect(parseRetryAfter('   ', now)).toBeNull();
    expect(parseRetryAfter('not-a-date', now)).toBeNull();
    // A date already in the past means "now", not a negative wait.
    expect(parseRetryAfter('Sun, 30 Aug 2026 11:00:00 GMT', now)).toBe(0);
  });

  it('gives every error a stable error_class, because F18 groups a series by it', () => {
    expect(errorClass({ kind: 'entitlement', endpoint: 'q', status: 403 })).toBe('entitlement');
    expect(errorClass({ kind: 'upstream', status: 503 })).toBe('upstream_503');
    expect(errorClass({ kind: 'budget_denied', scope: 'global' })).toBe('budget_denied_global');
    expect(errorClass({ kind: 'circuit_open', openedAt: '2026-08-30T12:00:00.000Z' })).toBe('circuit_open');
  });
});

describe('retry policy (source §9.4)', () => {
  // The DoD blocker: "A 403 is never retried; a test proves it."
  it('never retries an entitlement failure, on any attempt', () => {
    for (const attempt of [0, 1, 2, 5, 50]) {
      const decision = retryDecision({
        error: { kind: 'entitlement', endpoint: 'profile', status: 403 },
        attempt,
        policy: seeded,
      });
      expect(decision).toEqual({ retry: false, reason: 'never_retried' });
    }
  });

  /**
   * Both layers, pinned separately.
   *
   * The end-to-end "one attempt on a 403" test in `wrapper.test.ts` cannot fail from either of
   * these breaking alone — each independently blocks the retry, so removing one leaves the
   * other holding. That is good defence and a bad test signal, and it is the same shape as
   * F01's `check:bundle` defect (B-04): a guard that works can blind the check backstopping it.
   * These two assertions are what actually fail when one layer goes.
   */
  it('blocks a 403 retry at two independent layers, neither of which is load-bearing alone', () => {
    expect(NEVER_RETRIED.has('entitlement')).toBe(true);
    expect(TRANSIENT_STATUSES.has(403)).toBe(false);
    expect(TRANSIENT_STATUSES.has(401)).toBe(false);
  });

  it('never retries a contract failure, a budget denial, a quota refusal or an open circuit', () => {
    const errors = [
      { kind: 'contract' as const, issues: ['price: expected number'] },
      { kind: 'budget_denied' as const, scope: 'global' as const },
      { kind: 'quota' as const, resetAt: null },
      { kind: 'circuit_open' as const, openedAt: '2026-08-30T12:00:00.000Z' },
    ];
    for (const error of errors) {
      expect(retryDecision({ error, attempt: 0, policy: seeded }).retry).toBe(false);
    }
  });

  it('does not retry a 400 or a 404 — un-retryable without being an entitlement failure', () => {
    expect(retryDecision({ error: { kind: 'upstream', status: 400 }, attempt: 0, policy: seeded })).toEqual({
      retry: false,
      reason: 'not_transient',
    });
    expect(retryDecision({ error: { kind: 'upstream', status: 404 }, attempt: 0, policy: seeded })).toEqual({
      retry: false,
      reason: 'not_transient',
    });
  });

  it('retries 429, 500, 502, 503, 504 and timeouts', () => {
    for (const code of [429, 500, 502, 503, 504]) {
      expect(retryDecision({ error: { kind: 'upstream', status: code }, attempt: 0, policy: seeded }).retry).toBe(true);
    }
    expect(retryDecision({ error: { kind: 'timeout' }, attempt: 0, policy: seeded }).retry).toBe(true);
  });

  it('honours Retry-After over its own backoff', () => {
    const decision = retryDecision({
      error: { kind: 'rate_limit', retryAfterMs: 3_000 },
      attempt: 0,
      policy: seeded,
    });
    expect(decision).toEqual({ retry: true, delayMs: 3_000, reason: 'retry_after' });
  });

  it('caps a Retry-After the provider sets absurdly high', () => {
    const decision = retryDecision({
      error: { kind: 'rate_limit', retryAfterMs: 86_400_000 },
      attempt: 0,
      policy: seeded,
    });
    expect(decision).toEqual({ retry: true, delayMs: 8_000, reason: 'retry_after' });
  });

  it('stops after two retries', () => {
    expect(retryDecision({ error: { kind: 'timeout' }, attempt: MAX_RETRIES, policy: seeded })).toEqual({
      retry: false,
      reason: 'attempts_exhausted',
    });
  });

  it('backs off exponentially and stays inside the cap', () => {
    expect(backoffDelayMs(0, seeded)).toBe(250);
    expect(backoffDelayMs(1, seeded)).toBe(500);
    expect(backoffDelayMs(2, seeded)).toBe(1_000);
    expect(backoffDelayMs(99, seeded)).toBe(4_000);
  });

  it('uses full jitter, so a delay can be anywhere in [0, exponential)', () => {
    expect(backoffDelayMs(2, { ...seeded, random: () => 0 })).toBe(0);
    expect(backoffDelayMs(2, { ...seeded, random: () => 0.999 })).toBeLessThan(2_000);
  });
});

describe('circuit breaker (source §9.4)', () => {
  it('opens after exactly five consecutive transient failures, not four', async () => {
    const trace: string[] = [];
    const { store, states } = fakeBreaker(trace);
    const { clock } = fakeClock();

    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) {
      await recordFailure({ provider: 'fmp', store, clock, transient: true });
    }
    expect(states.get('fmp')?.openedAt).toBeNull();
    expect((await admit({ provider: 'fmp', store, clock })).allow).toBe(true);

    await recordFailure({ provider: 'fmp', store, clock, transient: true });
    expect(states.get('fmp')?.openedAt).not.toBeNull();
    expect((await admit({ provider: 'fmp', store, clock })).allow).toBe(false);
  });

  it('does not count an entitlement failure toward the threshold', async () => {
    const trace: string[] = [];
    const { store, states } = fakeBreaker(trace);
    const { clock } = fakeClock();

    for (let i = 0; i < 10; i += 1) {
      await recordFailure({ provider: 'fmp', store, clock, transient: false });
    }
    expect(states.get('fmp')?.openedAt).toBeNull();
    expect((await admit({ provider: 'fmp', store, clock })).allow).toBe(true);
  });

  it('stays open for 60 seconds, then admits exactly one probe', async () => {
    const trace: string[] = [];
    const { store } = fakeBreaker(trace);
    const { clock, advance } = fakeClock();

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      await recordFailure({ provider: 'fmp', store, clock, transient: true });
    }

    advance(OPEN_DURATION_MS - 1);
    expect((await admit({ provider: 'fmp', store, clock })).allow).toBe(false);

    advance(2);
    const probe = await admit({ provider: 'fmp', store, clock });
    expect(probe).toEqual({ allow: true, probe: true });

    // The second caller must NOT also be admitted — a hundred symbols in flight would
    // otherwise send a hundred requests at a provider just given 60 seconds to recover.
    expect((await admit({ provider: 'fmp', store, clock })).allow).toBe(false);
  });

  it('closes outright on a successful probe', async () => {
    const trace: string[] = [];
    const { store, states } = fakeBreaker(trace);
    const { clock, advance } = fakeClock();

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      await recordFailure({ provider: 'fmp', store, clock, transient: true });
    }
    advance(OPEN_DURATION_MS + 1);
    await admit({ provider: 'fmp', store, clock });
    await recordSuccess({ provider: 'fmp', store });

    expect(states.get('fmp')).toEqual({ consecutiveFailures: 0, openedAt: null, probing: false });
    expect((await admit({ provider: 'fmp', store, clock })).allow).toBe(true);
  });

  it('re-opens when the probe fails, rather than closing on the attempt', async () => {
    const trace: string[] = [];
    const { store } = fakeBreaker(trace);
    const { clock, advance } = fakeClock();

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      await recordFailure({ provider: 'fmp', store, clock, transient: true });
    }
    advance(OPEN_DURATION_MS + 1);
    await admit({ provider: 'fmp', store, clock });
    await recordFailure({ provider: 'fmp', store, clock, transient: true });

    expect((await admit({ provider: 'fmp', store, clock })).allow).toBe(false);
  });
});

describe('token bucket', () => {
  it('refills at the configured rate and never exceeds capacity', () => {
    const config = { capacity: 10, refillPerSecond: 2 };
    expect(refill({ tokens: 0, lastRefillMs: 0 }, config, 1_000).tokens).toBe(2);
    expect(refill({ tokens: 0, lastRefillMs: 0 }, config, 60_000).tokens).toBe(10);
  });

  it('grants while tokens remain and reports the wait when they do not', async () => {
    const store = fakeRateLimiter();
    const { clock } = fakeClock();

    for (let i = 0; i < BUCKETS.marketaux.capacity; i += 1) {
      expect(await acquire({ provider: 'marketaux', config: BUCKETS.marketaux, store, clock })).toEqual({
        acquired: true,
      });
    }

    const denied = await acquire({ provider: 'marketaux', config: BUCKETS.marketaux, store, clock });
    expect(denied.acquired).toBe(false);
    if (!denied.acquired) expect(denied.waitMs).toBeGreaterThan(0);
  });

  it("prices X's bucket for scarcity, not for throughput", () => {
    // D-15: X reads are the only per-unit-priced input, sampled on trigger and never polled.
    expect(BUCKETS.x.refillPerSecond).toBeLessThan(BUCKETS.reddit.refillPerSecond);
  });
});

describe('cache keys (source §9.3)', () => {
  it('builds the documented shapes', () => {
    expect(cacheKey({ provider: 'fmp', operation: 'quote', segments: ['AAPL'] })).toBe('provider:fmp:quote:aapl');
    expect(cacheKey({ provider: 'fmp', operation: 'history', segments: ['AAPL', '1d', '90'] })).toBe(
      'provider:fmp:history:aapl:1d:90',
    );
    expect(cacheKey({ provider: 'apewisdom', operation: 'all-stocks', segments: ['2'] })).toBe(
      'provider:apewisdom:all-stocks:2',
    );
  });

  it('normalises case and whitespace, because a missed cache looks like a cold one', () => {
    const upper = cacheKey({ provider: 'fmp', operation: 'quote', segments: [' AAPL '] });
    const lower = cacheKey({ provider: 'fmp', operation: 'quote', segments: ['aapl'] });
    expect(upper).toBe(lower);
  });

  it('never lets a segment inject a key separator', () => {
    expect(cacheKey({ provider: 'fmp', operation: 'quote', segments: ['AAPL:evil'] })).toBe(
      'provider:fmp:quote:aapl_evil',
    );
  });

  it('buckets rate and quota keys in UTC, because providers reset on their midnight', () => {
    const at = new Date('2026-08-30T23:59:00.000Z');
    expect(rateKey('reddit', at, 'day')).toBe('rate:reddit:2026-08-30');
    expect(rateKey('reddit', at, 'minute')).toBe('rate:reddit:2026-08-30T23:59');
    expect(utcDayBucket(at)).toBe('2026-08-30');
    expect(hourBucket(at)).toBe('2026-08-30-23');
  });

  it('fingerprints the key only, so no credential can reach provider_call_log', () => {
    const a = requestFingerprint({ provider: 'fmp', operation: 'quote', segments: ['AAPL'] });
    const b = requestFingerprint({ provider: 'fmp', operation: 'quote', segments: ['aapl'] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(requestFingerprint({ provider: 'fmp', operation: 'quote', segments: ['MSFT'] }));
  });
});
