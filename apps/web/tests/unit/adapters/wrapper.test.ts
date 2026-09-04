import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callProvider } from '@/adapters/wrapper';
import { OPEN_DURATION_MS } from '@/adapters/breaker';
import { harness, ok, status } from './fakes';

const quote = z.object({ symbol: z.string(), price: z.number() });
const body = { symbol: 'AAPL', price: 231.4 };

function call(h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) {
  return callProvider(
    {
      provider: 'fmp',
      operation: 'quote',
      segments: ['AAPL'],
      schema: quote,
      request: { url: 'https://example.test/quote/AAPL' },
      estimatedCostUsd: '0.0010',
      ...overrides,
    },
    h.deps,
  );
}

describe('the wrapper pipeline (F04 §4.1)', () => {
  it('runs its stages in the specified order', async () => {
    const h = harness({ responses: [ok(body)] });
    const result = await call(h);

    expect(result.ok).toBe(true);
    // F04 §7 step 2 reviews this in code order rather than in intent, so it is asserted here.
    expect(h.trace).toEqual([
      'budget.check',
      'quota.reserve:1',
      'fetch',
      'breaker.write:closed:0',
      'callLog',
      'cost',
    ]);
  });

  // DoD: "Budget pre-check hook is called before every priced request."
  it('denies on budget before the request is ever made', async () => {
    const h = harness({ budgetAllowed: false });
    const result = await call(h);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'budget_denied', scope: 'global' });
    expect(h.calls()).toBe(0);
    expect(h.trace[0]).toBe('budget.check');
    expect(h.trace).not.toContain('fetch');
  });

  // DoD: "Quota ledger refuses before dispatch."
  it('refuses on quota before dispatch rather than discovering a 429', async () => {
    const h = harness({ quotaGranted: false });
    const result = await call(h);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('quota');
    expect(h.calls()).toBe(0);
  });

  it('logs the refusals too, so a quiet collector is explicable', async () => {
    const h = harness({ budgetAllowed: false });
    await call(h);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]?.errorClass).toBe('budget_denied_global');
    expect(h.logs[0]?.statusCode).toBeNull();
  });
});

describe('the 403 path', () => {
  // The DoD blocker, proven end to end rather than only in the policy unit.
  it('makes exactly one attempt on a 403 and never retries it', async () => {
    const h = harness({ responses: [status(403), ok(body)] });
    const result = await call(h);

    expect(h.calls()).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'entitlement', endpoint: 'quote', status: 403 });
    }
    expect(h.slept).toEqual([]);
  });

  it('does not count a 403 toward opening the circuit', async () => {
    const h = harness({ responses: [status(403)] });
    for (let i = 0; i < 6; i += 1) await call(h);
    // Six entitlement failures, and the seventh call still reaches the provider.
    expect(h.calls()).toBe(6);
    const last = await call(h);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error.kind).toBe('entitlement');
  });
});

describe('retry and backoff through the pipeline', () => {
  it('retries a 503 twice and then gives up', async () => {
    const h = harness({ responses: [status(503)] });
    const result = await call(h);

    expect(h.calls()).toBe(3);
    expect(h.slept).toEqual([250, 500]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'upstream', status: 503 });
  });

  it('recovers when a retry succeeds', async () => {
    const h = harness({ responses: [status(503), ok(body)] });
    const result = await call(h);

    expect(h.calls()).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(body);
  });

  it('waits the Retry-After a 429 asks for', async () => {
    const h = harness({ responses: [status(429, { 'retry-after': '2' }), ok(body)] });
    const result = await call(h);

    expect(h.slept).toEqual([2_000]);
    expect(result.ok).toBe(true);
  });
});

describe('the circuit breaker in the pipeline', () => {
  it('short-circuits without a request once open, and reports circuit_open', async () => {
    const h = harness({
      responses: [ok(body)],
      breaker: { consecutiveFailures: 5, openedAt: '2026-08-30T12:00:00.000Z', probing: false },
    });
    const result = await call(h);

    expect(h.calls()).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('circuit_open');
  });

  it('returns the quota reservation when the circuit refuses the call', async () => {
    const h = harness({
      responses: [ok(body)],
      breaker: { consecutiveFailures: 5, openedAt: '2026-08-30T12:00:00.000Z', probing: false },
    });
    await call(h);
    // The allowance was never spent, so it must not be consumed.
    expect(h.released).toEqual([1]);
  });

  it('admits the probe once the open window has passed', async () => {
    const h = harness({
      responses: [ok(body)],
      breaker: { consecutiveFailures: 5, openedAt: '2026-08-30T12:00:00.000Z', probing: false },
      now: new Date(Date.parse('2026-08-30T12:00:00.000Z') + OPEN_DURATION_MS + 1).toISOString(),
    });
    const result = await call(h);
    expect(h.calls()).toBe(1);
    expect(result.ok).toBe(true);
  });
});

describe('contract validation (stage 8)', () => {
  it('reports a shape change loudly and does not retry it', async () => {
    const h = harness({ responses: [ok({ symbol: 'AAPL', price: 'two thirty one' })] });
    const result = await call(h);

    expect(h.calls()).toBe(1);
    expect(h.violations).toHaveLength(1);
    expect(h.violations[0]?.issues.join(' ')).toContain('price');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('treats a malformed 200 as a contract failure, not as success', async () => {
    const h = harness({ responses: [ok({ unexpected: true })] });
    const result = await call(h);
    expect(result.ok).toBe(false);
  });

  it('does not open the circuit on a contract failure — the provider answered', async () => {
    const h = harness({ responses: [ok({ wrong: 1 })] });
    for (let i = 0; i < 6; i += 1) await call(h);
    expect(h.calls()).toBe(6);
  });
});

describe('cache and cost accounting', () => {
  it('serves a fresh entry without a request and without spending quota', async () => {
    const h = harness({ responses: [ok(body)] });
    await call(h, { cacheTtlMs: 60_000 });
    expect(h.calls()).toBe(1);

    const second = await call(h, { cacheTtlMs: 60_000 });
    expect(h.calls()).toBe(1);
    expect(second.meta.cache).toBe('hit');
    // B-16: §4.1 orders the ledger before the cache, so a cached read must hand its
    // reservation back or a well-cached cycle drains the day's allowance without a call.
    expect(h.released).toEqual([1]);
  });

  it('serves a stale entry inside the stale window and marks it stale, never silently', async () => {
    const h = harness({ responses: [ok(body)] });
    await call(h, { cacheTtlMs: 1_000, maxStaleMs: 60_000 });
    h.advance(30_000);

    const stale = await call(h, { cacheTtlMs: 1_000, maxStaleMs: 60_000 });
    expect(stale.meta.cache).toBe('stale');
    expect(h.calls()).toBe(1);
  });

  it('refetches once the stale window has passed', async () => {
    const h = harness({ responses: [ok(body)] });
    await call(h, { cacheTtlMs: 1_000, maxStaleMs: 5_000 });
    h.advance(60_000);

    const fresh = await call(h, { cacheTtlMs: 1_000, maxStaleMs: 5_000 });
    expect(fresh.meta.cache).toBe('miss');
    expect(h.calls()).toBe(2);
  });

  // DoD: "costUsd is null for unpriced calls and never 0."
  it('reports costUsd as null for an unpriced call and writes no cost event', async () => {
    const h = harness({ responses: [ok(body)] });
    const result = await call(h, { estimatedCostUsd: null });

    expect(result.meta.costUsd).toBeNull();
    expect(h.costs).toHaveLength(0);
    expect(h.trace).not.toContain('cost');
  });

  it('never charges a cache hit, because the request did not happen', async () => {
    const h = harness({ responses: [ok(body)] });
    await call(h, { cacheTtlMs: 60_000 });
    const cached = await call(h, { cacheTtlMs: 60_000 });

    expect(cached.meta.costUsd).toBeNull();
    expect(h.costs).toHaveLength(1);
  });

  it('carries cost as a decimal string, so nothing floats into cost_event', async () => {
    const h = harness({ responses: [ok(body)] });
    await call(h, { estimatedCostUsd: '0.0050' });
    expect(h.costs[0]?.costUsd).toBe('0.0050');
    expect(typeof h.costs[0]?.costUsd).toBe('string');
  });

  /**
   * Regression coverage for a real bug this file's own `call()` helper was already exposed to
   * (its default `estimatedCostUsd: '0.0010'` is non-null) but never asserted against: before
   * `finish`'s `dispatched` flag existed, `costUsd` was gated on `cache === 'miss'` alone, and
   * budget denial, quota refusal and an open breaker all report `cache: 'miss'` while never
   * reaching the fetcher. Every priced adapter merged before `x.ts` used `estimatedCostUsd:
   * null`, so the bug was invisible until F04's first priced adapter exercised
   * `budgetAllowed: false` against a non-null estimate. Fixed alongside `adapters/x.ts`.
   */
  it('never charges a refused-before-dispatch call — budget denial, quota refusal, circuit open', async () => {
    const budgetDenied = harness({ budgetAllowed: false });
    await call(budgetDenied);
    expect(budgetDenied.costs).toHaveLength(0);

    const quotaDenied = harness({ quotaGranted: false });
    await call(quotaDenied);
    expect(quotaDenied.costs).toHaveLength(0);

    const breakerOpen = harness({
      responses: [ok(body)],
      breaker: { consecutiveFailures: 5, openedAt: '2026-08-30T12:00:00.000Z', probing: false },
    });
    const result = await call(breakerOpen);
    expect(result.meta.costUsd).toBeNull();
    expect(breakerOpen.costs).toHaveLength(0);
  });

  /**
   * Finding 4 (review round). The `dispatched` flag's regression test above only pins the three
   * `false`-branch call sites (budget denial, quota refusal, circuit open). For a shared,
   * one-boolean-per-call-site change touching seven adapters' hot path, the `true` branch needs
   * an equally explicit pin — otherwise a future edit could silently zero cost on a call site
   * that should report it, and nothing here would catch it.
   */
  it('charges the full estimate for a genuine successful dispatch', async () => {
    const h = harness({ responses: [ok(body)] });
    const result = await call(h, { estimatedCostUsd: '0.0050' });

    expect(result.ok).toBe(true);
    expect(result.meta.costUsd).toBe('0.0050');
    expect(h.costs).toHaveLength(1);
    expect(h.costs[0]?.costUsd).toBe('0.0050');
  });

  /**
   * Finding 3 (review round). A dispatched call is not automatically a billable one: X prices
   * per Post *returned*, and a request that reached the provider but came back with an error —
   * a never-retried entitlement failure, every retry on a transient failure exhausted, or a
   * stage-8 contract failure — delivered nothing billable. All three previously billed the full
   * `estimatedCostUsd` because `dispatched` alone gated cost; `finish()` now also requires
   * `outcome.ok`. This is deliberately distinct from the never-dispatched case covered above:
   * both report `costUsd: null`, but only a dispatched-and-failed call reaches the fetcher and
   * a real status code, which is exactly what `wrapper.ts`'s own X adapter needs distinguished
   * to avoid draining F18's global budget ceiling against money never spent.
   */
  it('never charges a dispatched call that failed — entitlement, retries exhausted, contract failure', async () => {
    const entitlement = harness({ responses: [status(403)] });
    const entitlementResult = await call(entitlement, { estimatedCostUsd: '0.0050' });
    expect(entitlement.calls()).toBe(1); // it did reach the provider
    expect(entitlementResult.meta.costUsd).toBeNull();
    expect(entitlement.costs).toHaveLength(0);

    const retriesExhausted = harness({ responses: [status(503)] });
    const retriesResult = await call(retriesExhausted, { estimatedCostUsd: '0.0050' });
    expect(retriesExhausted.calls()).toBe(3);
    expect(retriesResult.meta.costUsd).toBeNull();
    expect(retriesExhausted.costs).toHaveLength(0);

    const contractFailure = harness({ responses: [ok({ nonsense: true })] });
    const contractResult = await call(contractFailure, { estimatedCostUsd: '0.0050' });
    expect(contractFailure.calls()).toBe(1);
    expect(contractResult.ok).toBe(false);
    expect(contractResult.meta.costUsd).toBeNull();
    expect(contractFailure.costs).toHaveLength(0);
  });

  /**
   * Round-2 lane-review finding 2 (F04-x-adapter). A dispatched call that reads zero billable
   * items must hand its whole reservation back, not just bill nothing for it — otherwise a run
   * of failures against a per-item-priced provider silently exhausts the day's read ledger with
   * nothing ever actually read. This is the quota-side twin of the cost test directly above.
   */
  it('releases the full quota reservation for a dispatched call that failed', async () => {
    const entitlement = harness({ responses: [status(403)] });
    await call(entitlement, { quotaUnits: 100 });
    expect(entitlement.released).toEqual([100]);

    const retriesExhausted = harness({ responses: [status(503)] });
    await call(retriesExhausted, { quotaUnits: 100 });
    expect(retriesExhausted.released).toEqual([100]);

    const contractFailure = harness({ responses: [ok({ nonsense: true })] });
    await call(contractFailure, { quotaUnits: 100 });
    expect(contractFailure.released).toEqual([100]);
  });

  /**
   * Round-2 lane-review finding 1+2. `countBillableUnits` is the hook a per-item-priced adapter
   * (X) uses to reconcile a worst-case `quotaUnits` reservation to what a response actually
   * contained. Zero actual items must bill nothing and release everything; a partial yield must
   * release exactly the unused units while still billing the (still worst-case, per the
   * documented residual gap) full estimate.
   */
  describe('countBillableUnits reconciliation', () => {
    it('bills nothing and releases everything for a genuine zero-item success', async () => {
      const h = harness({ responses: [ok({ items: [] })] });
      const result = await call(h, {
        schema: z.object({ items: z.array(z.unknown()) }),
        quotaUnits: 100,
        estimatedCostUsd: '0.5000',
        countBillableUnits: (data: { items: unknown[] }) => data.items.length,
      });

      expect(result.ok).toBe(true);
      expect(result.meta.costUsd).toBeNull();
      expect(h.costs).toHaveLength(0);
      expect(h.released).toEqual([100]);
    });

    it('bills the full estimate but releases only the unused units for a partial yield', async () => {
      const h = harness({ responses: [ok({ items: [1, 2] })] });
      const result = await call(h, {
        schema: z.object({ items: z.array(z.unknown()) }),
        quotaUnits: 100,
        estimatedCostUsd: '0.5000',
        countBillableUnits: (data: { items: unknown[] }) => data.items.length,
      });

      expect(result.ok).toBe(true);
      expect(result.meta.costUsd).toBe('0.5000');
      expect(h.costs).toHaveLength(1);
      expect(h.released).toEqual([98]);
    });

    it('leaves the full reservation untouched when the adapter reads exactly what it reserved', async () => {
      const h = harness({ responses: [ok({ items: [1, 2, 3] })] });
      await call(h, {
        schema: z.object({ items: z.array(z.unknown()) }),
        quotaUnits: 3,
        countBillableUnits: (data: { items: unknown[] }) => data.items.length,
      });

      expect(h.released).toEqual([]);
    });

    /**
     * Round-3 lane-review finding 4. `countBillableUnits` is adapter-supplied and its result was
     * used unvalidated — a `NaN` silently zeroed a real charge (`NaN > 0` is `false`) and released
     * nothing (`Math.max(0, NaN)` is `NaN`), a negative count would have pushed a negative amount
     * into `QuotaLedger.release`, and a count larger than the reservation would release nothing
     * while still under-billing relative to what was actually read. Each is now treated as
     * "unreconciled" and falls back to the pre-`countBillableUnits` behaviour (full cost, nothing
     * released) except the over-count case, which is clamped rather than trusted.
     */
    it('falls back to full cost and no release for a NaN, negative, or non-integer countBillableUnits result, and reports it loudly', async () => {
      for (const badCount of [Number.NaN, -1, 1.5]) {
        const h = harness({ responses: [ok({ items: [1, 2] })] });
        const result = await call(h, {
          schema: z.object({ items: z.array(z.unknown()) }),
          quotaUnits: 100,
          estimatedCostUsd: '0.5000',
          countBillableUnits: () => badCount,
        });

        expect(result.ok).toBe(true);
        expect(result.meta.costUsd).toBe('0.5000');
        expect(h.released).toEqual([]);
        // Round-4 lane-review finding 3: an adapter's broken reconciliation function must not
        // fail silently — this is the only signal that it needs fixing.
        expect(h.violations).toHaveLength(1);
        expect(h.violations[0]?.issues.join(' ')).toContain('countBillableUnits');
      }
    });

    /**
     * Round-5 lane-review finding 4. Clamping an over-count silently absorbed a real
     * adapter/provider mismatch — the provider returned more items than were reserved, and the
     * excess was unaccounted for in the read ledger with no record anywhere.
     */
    it('clamps a countBillableUnits result larger than the reservation, and reports it loudly', async () => {
      const h = harness({ responses: [ok({ items: [1, 2, 3] })] });
      const result = await call(h, {
        schema: z.object({ items: z.array(z.unknown()) }),
        quotaUnits: 2,
        estimatedCostUsd: '0.5000',
        countBillableUnits: () => 3, // more items than the 2-unit reservation ever allowed for
      });

      expect(result.ok).toBe(true);
      expect(result.meta.costUsd).toBe('0.5000');
      expect(h.released).toEqual([]);
      expect(h.violations).toHaveLength(1);
      expect(h.violations[0]?.issues.join(' ')).toContain('more than the 2-unit reservation');
    });

    /**
     * Round-4 lane-review finding 2. `countBillableUnits` is called from inside the same `try`
     * block that wraps the fetch itself — before this fix, a throw from it was caught by that
     * block's own `catch` and misclassified as a provider failure (`classifyThrown`'s generic
     * `upstream` bucket, with a fabricated status), discarding an already-validated, already
     * cached response and blaming the provider for a bug in this in-process function.
     */
    it('treats a throwing countBillableUnits as unreconciled, never as a provider failure', async () => {
      const h = harness({ responses: [ok({ items: [1, 2] })] });
      const result = await call(h, {
        schema: z.object({ items: z.array(z.unknown()) }),
        quotaUnits: 100,
        estimatedCostUsd: '0.5000',
        countBillableUnits: () => {
          throw new Error('adapter bug');
        },
      });

      expect(result.ok).toBe(true);
      expect(result.meta.costUsd).toBe('0.5000');
      expect(h.released).toEqual([]);
      expect(h.violations).toHaveLength(1);
      expect(h.violations[0]?.issues.join(' ')).toContain('threw');
      // Round-5 lane-review finding 3: the thrown error's own message must survive into the
      // violation report — a fixed "it threw" string gives an operator nothing to debug from.
      expect(h.violations[0]?.issues.join(' ')).toContain('adapter bug');
    });
  });
});

describe('meta', () => {
  it('never throws for an expected condition — every branch returns a result', async () => {
    const cases = [
      harness({ budgetAllowed: false }),
      harness({ quotaGranted: false }),
      harness({ responses: [status(403)] }),
      harness({ responses: [status(500)] }),
      harness({ responses: [new Error('ECONNRESET')] }),
      harness({ responses: [ok({ nonsense: true })] }),
    ];
    for (const h of cases) {
      await expect(call(h)).resolves.toBeDefined();
    }
  });

  it('reports the provider, endpoint and quota remaining on every result', async () => {
    const h = harness({ responses: [ok(body)] });
    const result = await call(h);
    expect(result.meta.provider).toBe('fmp');
    expect(result.meta.endpoint).toBe('quote');
    expect(result.meta.quotaRemaining).toBe(99);
    expect(result.meta.requestedAt).toBe('2026-08-30T12:00:00.000Z');
  });
});
