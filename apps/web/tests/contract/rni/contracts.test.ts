import { describe, expect, it } from 'vitest';
import {
  rniCombinedSummary,
  rniComparativeRelation,
  rniPlatformSlice,
  rniRunRequest,
  rniSecurityMention,
  rniSecurityObservation,
  rniSourceItem,
  rniUniverseSnapshotCandidate,
} from '@/rni/contracts';
import {
  comparativeMentions,
  comparativeObservations,
  comparativeRelation,
  comparativeSource,
  independentPlatformSlices,
  partialCombinedSummary,
  rniFixtureIds,
} from '@/rni/testing/reference-fixtures';

describe('RNI frozen contracts', () => {
  it('represents one comparative source as two independent security observations', () => {
    expect(rniSourceItem.parse(comparativeSource).id).toBe(rniFixtureIds.source);
    expect(comparativeMentions.map((mention) => rniSecurityMention.parse(mention))).toHaveLength(2);

    const observations = comparativeObservations.map((observation) =>
      rniSecurityObservation.parse(observation),
    );
    expect(new Set(observations.map((observation) => observation.securityId)).size).toBe(2);
    expect(observations.map((observation) => observation.stance)).toEqual(['bullish', 'bearish']);
    expect(rniComparativeRelation.parse(comparativeRelation).relation).toBe('preferred_over');
  });

  it('keeps Reddit and X as separate terminal platform slices', () => {
    const slices = independentPlatformSlices.map((slice) => rniPlatformSlice.parse(slice));
    expect(slices.map((slice) => slice.platform)).toEqual(['reddit', 'x']);
    expect(slices.map((slice) => slice.status)).toEqual(['complete', 'unavailable']);
    expect(rniCombinedSummary.parse(partialCombinedSummary).status).toBe('partial');
  });

  it('rejects whole-page HTML as evidence content', () => {
    expect(() =>
      rniSourceItem.parse({ ...comparativeSource, boundedContent: '<!doctype html><html></html>' }),
    ).toThrow(/Whole-page HTML/u);
  });

  it('requires decimal strings for semantic scores so calculation inputs round-trip exactly', () => {
    expect(() =>
      rniSecurityObservation.parse({ ...comparativeObservations[0], stanceScore: 0.65 }),
    ).toThrow();
  });

  it('requires all three distinct summary sections', () => {
    const duplicate = {
      ...partialCombinedSummary,
      sections: [
        partialCombinedSummary.sections[0],
        partialCombinedSummary.sections[0],
        partialCombinedSummary.sections[2],
      ],
    };
    expect(() => rniCombinedSummary.parse(duplicate)).toThrow(/three distinct summary sections/u);
  });

  it('defaults future RNI runs to OpenAI Direct', () => {
    const request = rniRunRequest.parse({
      idempotencyKey: 'fixture-run-1',
      trigger: 'manual',
      ticker: 'NVDA',
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T00:00:00.000Z',
      comparisonStart: null,
      comparisonEnd: null,
    });
    expect(request.aiRoute).toBe('openai_direct');
  });

  it('rejects an over-600-member FMP universe candidate', () => {
    const members = Array.from({ length: 601 }, (_, index) => ({
      ticker: index === 0 ? 'NVDA' : `T${index}`,
      companyName: `Fixture ${index}`,
      exchange: 'NASDAQ',
      fmpSymbol: index === 0 ? 'NVDA' : `T${index}`,
    }));
    expect(() =>
      rniUniverseSnapshotCandidate.parse({
        source: 'fmp_sp500_constituent',
        retrievedAt: '2026-09-05T00:00:00.000Z',
        payloadSha256: 'a'.repeat(64),
        members,
      }),
    ).toThrow();
  });
});
