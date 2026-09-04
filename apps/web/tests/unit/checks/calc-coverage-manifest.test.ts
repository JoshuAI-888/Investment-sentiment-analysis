import { describe, expect, it } from 'vitest';
import { checkCalcCoverage } from '../../../scripts/checks/calc-coverage';
import { loadMetricManifest, loadRegistry } from '../../../scripts/checks/load';

/**
 * Loads the *real* `src/ui/metric-manifest.ts` and `src/analytics/registry.ts` — unlike
 * `calc-coverage.test.ts`, which only exercises the pure checker function against hand-crafted
 * fixtures and therefore cannot catch a surface that renders metrics without ever registering
 * them in the manifest at all.
 *
 * Lane-review round 2 finding 2: F08 renders 13 metric cells across
 * `ui/attention/AttentionTable.tsx` and `ui/attention/NotableMovers.tsx` and the manifest
 * registered none of them — `check:calc-coverage` reported "6 rendered metric(s)" (F07's alone)
 * and therefore could not fail for any number on the product's most visible surface, including a
 * future one added with a `methodId: null`. This test would have caught that.
 *
 * **What this actually checks — corrected per round 3 review.** `RENDERED_ATTENTION_METRIC_IDS`
 * below is a hand-written list, not scanned from the UI — an earlier version of this comment
 * claimed it "asserts every `attention.*` metric id the UI actually renders", which overstates
 * it: a new `InspectableMetric` cell added to `AttentionTable.tsx`/`NotableMovers.tsx` without
 * also updating this list would pass silently. What this test genuinely guarantees is narrower
 * but still real: (1) `checkCalcCoverage` reports zero findings against the manifest and registry
 * as they exist today, and (2) the seven ids this list already knows about — current as of this
 * writing — stay registered if a future edit to the manifest ever drops one. Catching a *newly
 * added, unregistered* metric id still depends on updating this list by hand alongside the UI
 * change, the same discipline `ui/metric-manifest.ts`'s own doc already asks of every surface.
 */
describe('check:calc-coverage against the real manifest (lane-review round 2 finding 2)', () => {
  const RENDERED_ATTENTION_METRIC_IDS = [
    'attention.mentions_now',
    'attention.mention_delta',
    'attention.mention_growth',
    'attention.engagement_now',
    'attention.rank_now',
    'attention.rank_change',
    'attention.mentions_zscore',
  ];

  it('has passed no findings against the real manifest and registry', async () => {
    const methods = await loadRegistry();
    const metrics = await loadMetricManifest();
    expect(checkCalcCoverage({ methods, metrics })).toEqual([]);
  });

  it('keeps every attention.* metric id in this hand-written list registered in the manifest', async () => {
    const metrics = await loadMetricManifest();
    const registeredIds = new Set(metrics.map((metric) => metric.id));
    for (const id of RENDERED_ATTENTION_METRIC_IDS) {
      expect(registeredIds.has(id), `'${id}' is rendered by the leaderboard but missing from ui/metric-manifest.ts`).toBe(true);
    }
  });

  it('states the mentions_now/rank_now/engagement_now judgment call explicitly, not just in a doc comment elsewhere', async () => {
    const metrics = await loadMetricManifest();
    // `mentions_now`/`rank_now` are `attention.rank_change`'s own frozen inputs.
    for (const id of ['attention.mentions_now', 'attention.rank_now']) {
      const entry = metrics.find((metric) => metric.id === id);
      expect(entry?.methodId).toBe('attention.rank_change');
    }
    // `engagement_now` is `attention.engagement_per_mention`'s frozen input in the normal case —
    // lane-review round 5 finding 3, correcting this test's own prior claim that all three
    // carried `rank_change`'s id, which locked the manifest's earlier mistake in place.
    const engagementNow = metrics.find((metric) => metric.id === 'attention.engagement_now');
    expect(engagementNow?.methodId).toBe('attention.engagement_per_mention');
  });
});
