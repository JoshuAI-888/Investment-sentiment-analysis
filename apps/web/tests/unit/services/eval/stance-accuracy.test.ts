/**
 * Tier D1 (`01-PRODUCT-SPEC.md` §4): per-axis stance macro-F1. Added in response to lane-review
 * round 1 finding 3 — D1 is a v1 gate assigned to F12 and was previously neither built nor
 * listed as deferred.
 */
import { describe, expect, it } from 'vitest';
import {
  D1_MACRO_F1_THRESHOLD,
  computeStanceMacroF1,
  evaluateD1Gate,
} from '../../../../src/services/eval/stance-accuracy';
import type { CorpusPack } from '../../../../src/services/eval/contracts';

/**
 * A minimal fake satisfying only the fields `computeStanceMacroF1` reads
 * (`pack.items[].axis`, `pack.items[].item.{id,stanceLabel}`, `labels[].{itemId,expectedStance}`)
 * — not a full, schema-valid `CorpusPack`. Kept deliberately light: this is a unit test of the
 * F1 arithmetic, not of the corpus contract (covered by `tests/contract/eval-corpus.test.ts`).
 */
function fakePack(
  items: readonly { id: string; axis: 'reddit' | 'x' | 'substack'; stanceLabel: string | null; expectedStance: string | null }[],
): CorpusPack {
  return {
    pack: {
      items: items.map((i) => ({ item: { id: i.id, stanceLabel: i.stanceLabel }, axis: i.axis })),
    },
    labels: items.map((i) => ({ itemId: i.id, expectedStance: i.expectedStance })),
  } as unknown as CorpusPack;
}

describe('computeStanceMacroF1', () => {
  it('reports macroF1: 1 for perfect agreement on one axis', () => {
    const packs = [
      fakePack([
        { id: 'a', axis: 'reddit', stanceLabel: 'bullish', expectedStance: 'bullish' },
        { id: 'b', axis: 'reddit', stanceLabel: 'bearish', expectedStance: 'bearish' },
        { id: 'c', axis: 'reddit', stanceLabel: 'neutral', expectedStance: 'neutral' },
        { id: 'd', axis: 'reddit', stanceLabel: null, expectedStance: null },
      ]),
    ];
    const report = computeStanceMacroF1(packs);
    expect(report.reddit.macroF1).toBe('1.0000');
    expect(report.reddit.n).toBe(4);
  });

  it('reports macroF1: null and n: 0 for an axis with zero labelled items', () => {
    const packs = [fakePack([{ id: 'a', axis: 'reddit', stanceLabel: 'bullish', expectedStance: 'bullish' }])];
    const report = computeStanceMacroF1(packs);
    expect(report.x.macroF1).toBeNull();
    expect(report.x.n).toBe(0);
    expect(report.substack.macroF1).toBeNull();
    expect(report.substack.n).toBe(0);
  });

  it('computes a fractional macroF1 when the predicted and actual labels disagree', () => {
    const packs = [
      fakePack([
        { id: 'a', axis: 'x', stanceLabel: 'bullish', expectedStance: 'bullish' },
        { id: 'b', axis: 'x', stanceLabel: 'bullish', expectedStance: 'bearish' }, // wrong
        { id: 'c', axis: 'x', stanceLabel: 'bearish', expectedStance: 'bearish' },
      ]),
    ];
    const report = computeStanceMacroF1(packs);
    expect(report.x.macroF1).not.toBeNull();
    expect(Number(report.x.macroF1)).toBeLessThan(1);
    expect(Number(report.x.macroF1)).toBeGreaterThan(0);
  });

  it('never blends axes — D-14: platforms are never combined into one figure', () => {
    const packs = [
      fakePack([
        { id: 'a', axis: 'reddit', stanceLabel: 'bullish', expectedStance: 'bearish' }, // wrong on reddit
        { id: 'b', axis: 'x', stanceLabel: 'bullish', expectedStance: 'bullish' }, // right on x
      ]),
    ];
    const report = computeStanceMacroF1(packs);
    expect(report.reddit.n).toBe(1);
    expect(report.x.n).toBe(1);
    expect(report.reddit.macroF1).not.toBe(report.x.macroF1);
  });

  it('skips items with no matching label rather than throwing', () => {
    const pack = fakePack([{ id: 'a', axis: 'reddit', stanceLabel: 'bullish', expectedStance: 'bullish' }]);
    // Remove the label to simulate an unlabelled item slipping through.
    const withoutLabel = { ...pack, labels: [] } as CorpusPack;
    const report = computeStanceMacroF1([withoutLabel]);
    expect(report.reddit.n).toBe(0);
  });
});

describe('evaluateD1Gate', () => {
  it('passes every axis at or above the 0.80 macro-F1 threshold', () => {
    const verdict = evaluateD1Gate({
      reddit: { macroF1: '0.9000', n: 10 },
      x: { macroF1: '0.8000', n: 5 },
      substack: { macroF1: null, n: 0 },
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.perAxis.substack.passed).toBe(true); // no items yet: reported, never failed
    expect(verdict.reasons).toEqual([]);
  });

  it('fails an axis below the threshold and names it in reasons', () => {
    const verdict = evaluateD1Gate({
      reddit: { macroF1: '0.60', n: 10 },
      x: { macroF1: null, n: 0 },
      substack: { macroF1: null, n: 0 },
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.perAxis.reddit.passed).toBe(false);
    expect(verdict.reasons.some((r) => r.startsWith('reddit'))).toBe(true);
  });

  it('exports the threshold as a decimal string', () => {
    expect(D1_MACRO_F1_THRESHOLD).toBe('0.80');
  });
});
