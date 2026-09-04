import { describe, expect, it } from 'vitest';
import {
  rniCombinedSummary,
  rniComparativeRelation,
  rniCitation,
  rniPlatformSlice,
  rniRadarPage,
  rniRadarQuery,
  rniRunRequest,
  rniManualRefreshRequest,
  rniManualRefreshResult,
  rniSecurityDetail,
  rniSecurityMention,
  rniSecurityObservation,
  rniSourceCommitResult,
  rniSourceItem,
  rniActiveUniverse,
  rniStagedUniversePreview,
  rniUniverseSearchQuery,
  rniUniverseSearchResult,
  rniActiveUniverseVersion,
  rniStagedUniverseVersion,
  rniUniverseSnapshotCandidate,
  type RniSourcePersistencePort,
  type RniReadService,
  type RniUniverseReadService,
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
  referenceActiveUniverse,
  referenceLegacyActiveUniverseVersion,
  referenceStagedUniversePreview,
  referenceUniverseSearchResult,
  referenceSecurityDetail,
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
      getSecurityDetail: async () => referenceSecurityDetail,
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
      getSecurityDetail: async () => referenceSecurityDetail,
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

  it('returns all four dimensions independently for Reddit and X security detail', async () => {
    const fake: RniReadService = {
      getRadarPage: async () => referenceRadarPage,
      getRun: async () => referenceRadarPage.run,
      getPlatformSlices: async () => independentPlatformSlices,
      getSecurityDetail: async () => rniSecurityDetail.parse(referenceSecurityDetail),
      getSecuritySummary: async () => partialCombinedSummary,
      getCitation: async () => comparativeCitation,
      getEvidence: async () => comparativeSource,
    };

    const detail = await fake.getSecurityDetail(rniFixtureIds.run, rniFixtureIds.nvda);
    expect(detail.security).toEqual(referenceRadarPage.rows[0]!.security);
    expect(detail.reddit.dimensions.map(({ dimension }) => dimension)).toEqual([
      'company_fundamentals',
      'market_trading',
      'catalyst_event',
      'retail_narrative',
    ]);
    expect(detail.x.dimensions.map(({ dimension }) => dimension)).toEqual(
      detail.reddit.dimensions.map(({ dimension }) => dimension),
    );
    expect(detail.reddit.dimensions[1]?.stance).toBe('bullish');
    expect(detail.x.dimensions[1]?.stance).toBe('bearish');
  });

  it('rejects missing, pooled, relabelled, or uncited security-detail dimensions', () => {
    expect(() =>
      rniSecurityDetail.parse({
        ...referenceSecurityDetail,
        reddit: {
          ...referenceSecurityDetail.reddit,
          dimensions: referenceSecurityDetail.reddit.dimensions.slice(0, 3),
        },
      }),
    ).toThrow();
    expect(() =>
      rniSecurityDetail.parse({
        ...referenceSecurityDetail,
        reddit: {
          ...referenceSecurityDetail.reddit,
          dimensions: [
            referenceSecurityDetail.reddit.dimensions[0],
            referenceSecurityDetail.reddit.dimensions[0],
            referenceSecurityDetail.reddit.dimensions[2],
            referenceSecurityDetail.reddit.dimensions[3],
          ],
        },
      }),
    ).toThrow(/each of the four RNI dimensions exactly once/u);
    expect(() =>
      rniSecurityDetail.parse({
        ...referenceSecurityDetail,
        eligibleSourceCount: 7,
      }),
    ).toThrow();
    expect(() =>
      rniSecurityDetail.parse({
        ...referenceSecurityDetail,
        x: { ...referenceSecurityDetail.x, platform: 'reddit' },
      }),
    ).toThrow(/X detail/u);
    expect(() =>
      rniSecurityDetail.parse({
        ...referenceSecurityDetail,
        x: {
          ...referenceSecurityDetail.x,
          dimensions: referenceSecurityDetail.x.dimensions.map((assignment, index) =>
            index === 1 ? { ...assignment, citationIds: [] } : assignment,
          ),
        },
      }),
    ).toThrow(/requires a citation/u);
    expect(() =>
      rniSecurityDetail.parse({
        ...referenceSecurityDetail,
        x: { ...referenceSecurityDetail.x, status: 'unavailable' },
      }),
    ).toThrow(/non-publishable platform/u);
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

  it('freezes client-owned manual refresh intent and server-resolved scope previews', () => {
    expect(
      rniManualRefreshRequest.parse({
        idempotencyKey: 'manual-nvda-1',
        scope: { kind: 'ticker', ticker: 'NVDA' },
      }),
    ).toEqual({
      idempotencyKey: 'manual-nvda-1',
      scope: { kind: 'ticker', ticker: 'NVDA' },
    });
    expect(
      rniManualRefreshResult.parse({
        disposition: 'accepted',
        runId: rniFixtureIds.run,
        idempotencyKey: 'manual-nvda-1',
        scopePreview: {
          kind: 'ticker',
          securityId: rniFixtureIds.nvda,
          ticker: 'NVDA',
          companyName: 'NVIDIA Corporation',
          exchange: 'NASDAQ',
          universeVersion: 'rni-universe-fixture-v1',
        },
      }),
    ).toMatchObject({ disposition: 'accepted', runId: rniFixtureIds.run });
    expect(
      rniManualRefreshResult.parse({
        disposition: 'duplicate',
        runId: rniFixtureIds.run,
        idempotencyKey: 'manual-full-1',
        scopePreview: {
          kind: 'full_universe',
          universeVersion: 'rni-universe-fixture-v1',
          securityCount: 501,
        },
      }),
    ).toMatchObject({ disposition: 'duplicate', runId: rniFixtureIds.run });
    expect(() => rniManualRefreshRequest.parse({ scope: { kind: 'full_universe' } })).toThrow();
    expect(() =>
      rniManualRefreshResult.parse({
        disposition: 'accepted',
        runId: rniFixtureIds.run,
        idempotencyKey: 'manual-full-over-limit',
        scopePreview: {
          kind: 'full_universe',
          universeVersion: 'rni-universe-fixture-v1',
          securityCount: 601,
        },
      }),
    ).toThrow();
  });

  it('freezes bounded active-universe search and immutable staged impact reads', async () => {
    const fake: RniUniverseReadService = {
      getActiveUniverse: async () => rniActiveUniverse.parse(referenceActiveUniverse),
      searchActiveUniverse: async (input) => {
        const query = rniUniverseSearchQuery.parse(input);
        const members = referenceUniverseSearchResult.members.filter(({ ticker, companyName }) =>
          `${ticker} ${companyName}`
            .toLocaleLowerCase('en-US')
            .includes(query.query.toLocaleLowerCase('en-US')),
        );
        return rniUniverseSearchResult.parse({
          ...referenceUniverseSearchResult,
          query: query.query,
          members: members.slice(0, query.limit),
        });
      },
      getStagedUniversePreview: async (versionId) => {
        if (versionId !== referenceStagedUniversePreview.stagedVersion.id) {
          throw new Error('staged universe not found');
        }
        return rniStagedUniversePreview.parse(referenceStagedUniversePreview);
      },
    };

    const active = await fake.getActiveUniverse();
    const nonRadarMatch = await fake.searchActiveUniverse({ query: 'MICRO' });
    const preview = await fake.getStagedUniversePreview('101');

    expect(active.defaultSecurity.ticker).toBe('NVDA');
    expect(nonRadarMatch.members.map(({ ticker }) => ticker)).toEqual(['MSFT']);
    expect(nonRadarMatch.version.id).toBe(active.version.id);
    expect(preview.stagedVersion.id).not.toBe(preview.activeVersion.id);
    expect(preview.stagedVersion.parentVersion).toBe(preview.activeVersion.id);
    expect(preview.stagedVersion.securityCount).toBe(
      preview.activeVersion.securityCount + preview.added.length - preview.removed.length,
    );
    expect(() =>
      rniActiveUniverse.parse({
        ...referenceActiveUniverse,
        defaultSecurity: referenceRadarPage.rows[1]!.security,
      }),
    ).toThrow(/default security must be NVDA/u);
    expect(() =>
      rniStagedUniversePreview.parse({
        ...referenceStagedUniversePreview,
        stagedVersion: {
          ...referenceStagedUniversePreview.stagedVersion,
          id: referenceStagedUniversePreview.activeVersion.id,
        },
      }),
    ).toThrow(/distinct from the active universe/u);
    expect(() =>
      rniStagedUniversePreview.parse({
        ...referenceStagedUniversePreview,
        stagedVersion: {
          ...referenceStagedUniversePreview.stagedVersion,
          parentVersion: '99',
        },
      }),
    ).toThrow(/displayed active universe/u);
    expect(() =>
      rniStagedUniversePreview.parse({
        ...referenceStagedUniversePreview,
        stagedVersion: {
          ...referenceStagedUniversePreview.stagedVersion,
          securityCount: referenceStagedUniversePreview.activeVersion.securityCount,
        },
      }),
    ).toThrow(/complete impact/u);

    const expansion = Array.from({ length: 401 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
      ticker: `L${index}`,
      companyName: `Legacy expansion ${index}`,
      exchange: 'NYSE',
    }));
    expect(
      rniStagedUniversePreview.parse({
        activeVersion: referenceLegacyActiveUniverseVersion,
        stagedVersion: {
          id: '102',
          status: 'staged',
          parentVersion: referenceLegacyActiveUniverseVersion.id,
          securityCount: 501,
          source: 'fmp_sp500_constituent',
          retrievedAt: '2026-09-05T01:00:00.000Z',
          payloadSha256: 'c'.repeat(64),
          createdAt: '2026-09-05T01:01:00.000Z',
        },
        added: expansion,
        removed: [],
      }).stagedVersion.securityCount,
    ).toBe(501);

    expect(() =>
      rniActiveUniverseVersion.parse({
        ...referenceActiveUniverse.version,
        securityCount: 500,
      }),
    ).toThrow();
    expect(() =>
      rniStagedUniverseVersion.parse({
        ...referenceStagedUniversePreview.stagedVersion,
        securityCount: 500,
      }),
    ).toThrow();

    const impossibleAdded = Array.from({ length: 504 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
      ticker: `A${index}`,
      companyName: `Impossible addition ${index}`,
      exchange: 'NYSE',
    }));
    const impossibleRemoved = Array.from({ length: 504 }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
      ticker: `R${index}`,
      companyName: `Impossible removal ${index}`,
      exchange: 'NYSE',
    }));
    expect(() =>
      rniStagedUniversePreview.parse({
        activeVersion: referenceActiveUniverse.version,
        stagedVersion: {
          ...referenceStagedUniversePreview.stagedVersion,
          securityCount: referenceActiveUniverse.version.securityCount,
        },
        added: impossibleAdded,
        removed: impossibleRemoved,
      }),
    ).toThrow(/cannot remove more members/u);
    expect(() =>
      rniStagedUniversePreview.parse({
        activeVersion: referenceActiveUniverse.version,
        stagedVersion: {
          ...referenceStagedUniversePreview.stagedVersion,
          securityCount: referenceActiveUniverse.version.securityCount,
        },
        added: impossibleAdded,
        removed: impossibleRemoved,
      }),
    ).toThrow(/cannot add more members/u);
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
