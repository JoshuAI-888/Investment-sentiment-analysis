/**
 * Unit tests for the B7/B8 arithmetic only. `Verifier` here is a small hand-written stand-in
 * for a subset of `05-TEST-STRATEGY.md` §6's checks — **not** F11's real deterministic
 * verifier, which this lane does not own and which is not merged yet. See the lane report's
 * DEFERRED field: real B7/B8 measurement needs F11's actual verifier.
 */
import { describe, expect, it } from 'vitest';
import {
  B7_CATCH_RATE_THRESHOLD,
  B8_FALSE_POSITIVE_THRESHOLD,
  measureVerifier,
  type Verifier,
} from '../../../../src/services/eval/verifier-harness';
import type { SeededErrorAnswer } from '../../../../src/services/eval/contracts';

function seeded(id: string, packId: string, baseAnswer: string, answer: string): SeededErrorAnswer {
  return { id, packId, faultClass: 'wrong_number', baseAnswer, answer, faultDescription: 'test fixture' };
}

/** Flags any answer whose number differs from the pack's one true stored value ("0.62"). */
const numberCheckVerifier: Verifier = (answerText) => {
  const flagged = answerText.includes('0.62') === false;
  return { flagged, reasons: flagged ? ['numeric token does not match the stored metric'] : [] };
};

/** A verifier that never flags anything — used to exercise a 0% catch rate / 0% false-positive rate. */
const permissiveVerifier: Verifier = () => ({ flagged: false, reasons: [] });

describe('measureVerifier', () => {
  it('computes a perfect catch rate and zero false-positive rate for a verifier that works correctly', () => {
    const answers = [
      seeded('se-01', 'pack-1', 'stance is bullish (0.62)', 'stance is bullish (0.91)'),
      seeded('se-02', 'pack-2', 'stance is bearish (0.62)', 'stance is bearish (0.10)'),
    ];
    const measurement = measureVerifier(answers, numberCheckVerifier);
    expect(measurement.catchRate).toBe('1.0000');
    expect(measurement.falsePositiveRate).toBe('0.0000');
    expect(measurement.catchRatePassed).toBe(true);
    expect(measurement.falsePositiveRatePassed).toBe(true);
    expect(measurement.catchRateThreshold).toBe(B7_CATCH_RATE_THRESHOLD);
    expect(measurement.falsePositiveRateThreshold).toBe(B8_FALSE_POSITIVE_THRESHOLD);
  });

  it('fails both thresholds for a verifier that never flags anything', () => {
    const answers = [
      seeded('se-01', 'pack-1', 'stance is bullish (0.62)', 'stance is bullish (0.91)'),
      seeded('se-02', 'pack-2', 'stance is bearish (0.62)', 'stance is bearish (0.10)'),
    ];
    const measurement = measureVerifier(answers, permissiveVerifier);
    expect(measurement.catchRate).toBe('0.0000');
    expect(measurement.catchRatePassed).toBe(false);
    // A permissive verifier also never false-positives, so B8 passes vacuously — correct
    // arithmetic, and exactly why B7 and B8 must both be read, never just one.
    expect(measurement.falsePositiveRatePassed).toBe(true);
  });

  it('throws rather than report B7/B8 from an empty seeded-error set', () => {
    expect(() => measureVerifier([], numberCheckVerifier)).toThrow(/empty/);
  });

  it('pairs baseAnswer/answer from the same fixture — catch rate and false-positive rate are apples-to-apples, not two unrelated samples', () => {
    const answers = [seeded('se-01', 'pack-1', 'clean text with 0.62', 'faulted text with 0.99')];
    let seenBase = false;
    let seenFaulted = false;
    const spyVerifier: Verifier = (answerText) => {
      if (answerText.includes('0.62')) seenBase = true;
      if (answerText.includes('0.99')) seenFaulted = true;
      return { flagged: answerText.includes('0.99'), reasons: [] };
    };
    measureVerifier(answers, spyVerifier);
    expect(seenBase).toBe(true);
    expect(seenFaulted).toBe(true);
  });
});
