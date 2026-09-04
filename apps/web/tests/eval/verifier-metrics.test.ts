/**
 * B7/B8 — F12 §4.2, `01-PRODUCT-SPEC.md` §4 Tier B. Measures F11's real, already-merged verifier
 * (`services/research/deterministic-checks.ts`, consumed as-is) against the committed
 * seeded-error corpus. **Deterministic-only in this suite** (`modelVerify: null`) — this is a
 * real, zero-mocking measurement of the seven fault classes deterministic code can catch, run
 * with zero API calls and zero fixture authoring for the verifier's own verdicts. It is honestly
 * NOT the full nine-class B7/B8 number F12 §4.2 asks for, because two fault classes
 * (`unsupported_causal_claim`, `citation_unrelated_evidence`) are only ever catchable through the
 * bounded model-verification pass, which needs a live model call this sandbox has no key for —
 * see this feature's build report and `verifier-metrics.ts`'s own docstring for the full
 * disclosure. `catchRate` below is asserted against the actual computed number, not the ≥0.90
 * gate, precisely because reporting a passing number this suite cannot honestly measure would be
 * the fabrication `CLAUDE.md`'s Honesty checklist exists to catch.
 */
import { describe, expect, it } from 'vitest';
import { runSeededErrorMeasurement, createFixtureEvalModelClient, noopEvalModelCostSink, permissiveEvalModelBudgetGate, systemEvalModelClientDeps, b7Passes, b8Passes } from '@/services/eval';

function fixtureClient() {
  return createFixtureEvalModelClient({
    budgetGate: permissiveEvalModelBudgetGate,
    costSink: noopEvalModelCostSink,
    evalRunId: 'test-run',
    ...systemEvalModelClientDeps,
  });
}

describe('B7/B8 — deterministic-only verifier measurement over the seeded-error corpus', () => {
  it('catches every deterministically-catchable fault class for real, with zero false positives on the clean claims sitting alongside them', async () => {
    const result = await runSeededErrorMeasurement(fixtureClient(), null);
    const m = result.verifierMeasurement;

    expect(m.modelVerificationRan).toBe(false);

    // The seven deterministically-catchable classes (35 faulty claims) are all real, zero-mock
    // catches; the two semantic-only classes (10 faulty claims) cannot be caught without the
    // model-verification pass this suite deliberately omits.
    const deterministicClasses = [
      'wrong_number', 'swapped_ticker', 'stale_date', 'buy_recommendation',
      'price_target', 'stance_on_thin_sample', 'fabricated_evidence_id',
    ];
    for (const cls of deterministicClasses) {
      const bucket = m.byFaultClass[cls];
      expect(bucket, `expected a bucket for ${cls}`).toBeDefined();
      if (bucket !== undefined) expect(bucket.caught).toBe(bucket.total);
    }
    for (const cls of ['unsupported_causal_claim', 'citation_unrelated_evidence']) {
      const bucket = m.byFaultClass[cls];
      expect(bucket, `expected a bucket for ${cls}`).toBeDefined();
      if (bucket !== undefined) expect(bucket.caught).toBe(0);
    }

    // False positives: deterministic checks never trip on the untouched gold claims sitting
    // alongside a seeded fault — genuinely zero, well inside B8's ≤ 0.10 gate.
    expect(m.caughtClean).toBe(0);
    expect(b8Passes(m)).toBe(true);

    // The deterministic-only catch rate is honestly below the full ≥0.90 gate — a live model
    // run on the two semantic classes is what closes the gap, not asserted here.
    expect(b7Passes(m)).toBe(false);
    expect(Number(m.catchRate)).toBeCloseTo(35 / 45, 4);
  }, 20000);

  it('b7Passes/b8Passes are pure gate checks that would flip given a full, all-caught measurement', () => {
    const perfect = {
      catchRate: '1.0000',
      falsePositiveRate: '0.0000',
      totalFaulty: 45,
      caughtFaulty: 45,
      totalClean: 50,
      caughtClean: 0,
      byFaultClass: {},
      modelVerificationRan: true,
    };
    expect(b7Passes(perfect)).toBe(true);
    expect(b8Passes(perfect)).toBe(true);

    const failing = { ...perfect, falsePositiveRate: '0.5000' };
    expect(b8Passes(failing)).toBe(false);
  });
});
