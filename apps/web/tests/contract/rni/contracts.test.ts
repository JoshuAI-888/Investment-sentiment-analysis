import { describe, expect, it } from 'vitest';
import {
  rniCombinedSummary,
  rniComparativeRelation,
  rniCitation,
  rniPlatformSlice,
  rniRadarPage,
  rniRadarQuery,
  rniRunRequest,
  rniSecurityMention,
  rniSecurityObservation,
  rniSourceCommitResult,
  rniSourceItem,
  rniUniverseSnapshotCandidate,
  type RniSourcePersistencePort,
  type RniReadService,
} from '@/rni/contracts';
import {
  comparativeCitation,
  comparativeMentions,
  comparativeObservations,
  comparativeRelation,
  comparativeSource,
  independentPlatformSlices,
  partialCombinedSummary,
  referenceRadarPage,
  comparativeSourceCommit,
  comparativeSourceDuplicateCommit,
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

  it('freezes a commit-before-interpret persistence port with explicit idempotency outcomes', async () => {
    let committed = false;
    const fake: RniSourcePersistencePort = {
      async commitSource(source) {
        rniSourceItem.parse(source);
        const result = committed ? comparativeSourceDuplicateCommit : comparativeSourceCommit;
        committed = true;
        return rniSourceCommitResult.parse(result);
      },
    };

    const first = await fake.commitSource(comparativeSource);
    const duplicate = await fake.commitSource(comparativeSource);

    expect(first).toEqual(comparativeSourceCommit);
    expect(duplicate).toEqual(comparativeSourceDuplicateCommit);
    expect(duplicate.sourceItemId).toBe(first.sourceItemId);
    expect(duplicate).toMatchObject({
      sourceInserted: false,
      retrievalInserted: false,
      contentVersionInserted: false,
    });
  });

  it('resolves summary citation IDs before reading their persisted source evidence', async () => {
    const fake: RniReadService = {
      getRadarPage: async () => referenceRadarPage,
      getRun: async () => {
        throw new Error('not used');
      },
      getPlatformSlices: async () => {
        throw new Error('not used');
      },
      getSecuritySummary: async () => partialCombinedSummary,
      getCitation: async (citationId) => {
        if (citationId !== comparativeCitation.id) throw new Error('citation not found');
        return rniCitation.parse(comparativeCitation);
      },
      getEvidence: async (sourceItemId) => {
        if (sourceItemId !== comparativeSource.id) throw new Error('source not found');
        return rniSourceItem.parse(comparativeSource);
      },
    };

    const summary = await fake.getSecuritySummary(rniFixtureIds.run, rniFixtureIds.nvda);
    const citation = await fake.getCitation(summary.sections[0]!.citationIds[0]!);
    const evidence = await fake.getEvidence(citation.sourceItemId);

    expect(citation.platform).toBe('reddit');
    expect(citation.url).toBe(evidence.originalUrl);
    expect(evidence.boundedContent).toContain(citation.evidenceText);
  });

  it('keeps cursor-paginated Radar results security-aware and source-separated', async () => {
    const query = rniRadarQuery.parse({ runId: rniFixtureIds.run });
    const fake: RniReadService = {
      getRadarPage: async () => rniRadarPage.parse(referenceRadarPage),
      getRun: async () => referenceRadarPage.run,
      getPlatformSlices: async () => independentPlatformSlices,
      getSecuritySummary: async () => partialCombinedSummary,
      getCitation: async () => comparativeCitation,
      getEvidence: async () => comparativeSource,
    };

    const page = await fake.getRadarPage(query);
    expect(query.limit).toBe(50);
    expect(page.rows.map((row) => `${row.security.ticker} — ${row.security.companyName}`)).toEqual([
      'NVDA — NVIDIA Corporation',
      'AMD — Advanced Micro Devices, Inc.',
    ]);
    expect(page.rows[0]?.reddit.eligibleSourceCount).toBe(2);
    expect(page.rows[0]?.x.eligibleSourceCount).toBe(5);
    expect(page.rows[0]?.combined.state).toBe('divergent');
    expect(page.rows[1]?.x.stance).toBe('insufficient');
    expect(page.rows[1]?.combined.state).toBe('partial');
  });

  it('rejects relabelled, pooled, or fallback Radar cells', () => {
    const row = referenceRadarPage.rows[1]!;
    expect(() =>
      rniRadarPage.parse({
        ...referenceRadarPage,
        rows: [{ ...row, x: { ...row.x, platform: 'reddit' } }],
      }),
    ).toThrow(/X cell/u);
    expect(() =>
      rniRadarPage.parse({
        ...referenceRadarPage,
        rows: [{ ...row, eligibleSourceCount: 1 }],
      }),
    ).toThrow();
    expect(() =>
      rniRadarPage.parse({
        ...referenceRadarPage,
        rows: [{ ...row, combined: { ...row.combined, state: 'aligned' } }],
      }),
    ).toThrow(/missing platform/u);
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
