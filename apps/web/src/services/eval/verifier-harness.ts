/**
 * Measures the deterministic verifier against the seeded-error corpus (F12 §4.2, B7/B8).
 *
 * **The verifier itself is injected, not built here.** F11 owns the real deterministic checks
 * (`05-TEST-STRATEGY.md` §6 — numeric string-match, citation resolution, thin-sample stance,
 * banned vocabulary, etc.) and this lane does not import `src/services/research/`. `Verifier`
 * is the seam: this module only knows how to turn a verifier's per-answer verdicts into B7/B8
 * numbers. See the lane report's DEFERRED field for why the real B7/B8 measurement needs F11's
 * actual merged verifier, not the toy fakes the tests here exercise this arithmetic with.
 */
import Decimal from 'decimal.js';
import type { SeededErrorAnswer, VerifierMeasurement } from './contracts';

export type VerifierVerdict = { flagged: boolean; reasons: string[] };

/** A verifier decides, for one answer against its pack, whether it should be flagged. */
export type Verifier = (answerText: string, packId: string) => VerifierVerdict;

/** B7 (`01-PRODUCT-SPEC.md` §4 Tier B). */
export const B7_CATCH_RATE_THRESHOLD = '0.90';
/** B8 (`01-PRODUCT-SPEC.md` §4 Tier B). */
export const B8_FALSE_POSITIVE_THRESHOLD = '0.10';

/**
 * B7 is the fraction of `answer` (the faulted text) the verifier flags. Using the paired
 * base/faulted answer from the same seeded-error fixture is what `contracts.ts`'s
 * `SeededErrorAnswer` shape is for.
 *
 * **B8's denominator is distinct base answers, not distinct fixtures (lane-review round 1
 * finding 6).** Several fixtures share one pack's clean `baseAnswer` — they inject different
 * faults into the same underlying answer — so `seeded.length` overcounts how many *actually
 * distinct* known-good answers were tested. Counting a shared clean answer once per fixture
 * would silently mis-weight whichever base answer the verifier happens to false-positive on:
 * with 8 fixtures over 5 distinct base answers, one real false positive is 1/5 = 0.2000, not
 * 1/8 = 0.1250 — the difference between passing and failing the B8 ≤ 0.10 gate is exactly the
 * kind of thing this rate exists to get right.
 */
export function measureVerifier(
  seeded: readonly SeededErrorAnswer[],
  verify: Verifier,
): VerifierMeasurement {
  if (seeded.length === 0) {
    throw new Error('measureVerifier: the seeded-error corpus is empty — B7/B8 are not measurable');
  }

  let caught = 0;
  for (const entry of seeded) {
    if (verify(entry.answer, entry.packId).flagged) caught += 1;
  }

  const distinctGoodAnswers = new Map<string, SeededErrorAnswer>();
  for (const entry of seeded) {
    if (!distinctGoodAnswers.has(entry.baseAnswer)) distinctGoodAnswers.set(entry.baseAnswer, entry);
  }

  let falsePositives = 0;
  for (const [baseAnswer, owner] of distinctGoodAnswers) {
    if (verify(baseAnswer, owner.packId).flagged) falsePositives += 1;
  }

  const catchRate = new Decimal(caught).dividedBy(seeded.length);
  const falsePositiveRate = new Decimal(falsePositives).dividedBy(distinctGoodAnswers.size);

  return {
    catchRate: catchRate.toFixed(4),
    falsePositiveRate: falsePositiveRate.toFixed(4),
    seededCount: seeded.length,
    goodCount: distinctGoodAnswers.size,
    catchRateThreshold: B7_CATCH_RATE_THRESHOLD,
    falsePositiveRateThreshold: B8_FALSE_POSITIVE_THRESHOLD,
    catchRatePassed: catchRate.greaterThanOrEqualTo(B7_CATCH_RATE_THRESHOLD),
    falsePositiveRatePassed: falsePositiveRate.lessThanOrEqualTo(B8_FALSE_POSITIVE_THRESHOLD),
  };
}
