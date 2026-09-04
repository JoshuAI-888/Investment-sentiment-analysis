import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  comparativeMentions,
  comparativeObservations,
  comparativeRelation,
  comparativeSource,
  rniFixtureIds,
} from '../../../src/rni/testing/reference-fixtures';
import {
  getRniCitationById,
  persistRniClaimCitation,
  persistRniComparativeRelation,
  persistRniEvidenceClaim,
  persistRniNarrative,
  persistRniNarrativeMembership,
  persistRniObservationTheme,
  persistRniThemeDefinition,
  type RniEvidenceClaimInput,
} from '../../../src/rni/repositories/claims-narratives';
import {
  persistRniSecurityMention,
  persistRniSecurityObservation,
} from '../../../src/rni/repositories/observations';
import { persistRniSource } from '../../../src/rni/repositories/source-items';
import { persistRniRunWithSlices } from '../../../src/rni/repositories/runs';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import { seedRniVersionLineage } from './version-fixtures';

const url = databaseUrl();
const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe.skipIf(url === undefined)('RNI D03 relational claims and narratives', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query(
      `insert into security (id, symbol, name, exchange, asset_type, currency) values
       ($1, 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD'),
       ($2, 'AMD', 'Advanced Micro Devices, Inc.', 'NASDAQ', 'equity', 'USD')`,
      [rniFixtureIds.nvda, rniFixtureIds.amd],
    );
    await persistRniSource(comparativeSource, pool);
    for (const mention of comparativeMentions) await persistRniSecurityMention(mention, pool);
    for (const observation of comparativeObservations) {
      await persistRniSecurityObservation(observation, pool);
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  function claim(overrides: Partial<RniEvidenceClaimInput> = {}): RniEvidenceClaimInput {
    return {
      id: randomUUID(),
      sourceItemId: comparativeSource.id,
      securityId: rniFixtureIds.nvda,
      observationId: rniFixtureIds.nvdaObservation,
      claimText: 'NVDA has execution momentum.',
      claimType: 'opinion',
      epistemicStatus: 'source_claim',
      supportStart: 0,
      supportEnd: 27,
      extractorRunId: randomUUID(),
      inputHash: HASH_A,
      createdAt: '2026-09-05T00:06:30.000Z',
      ...overrides,
    };
  }

  it('round-trips a claim citation to the persisted original URL', async () => {
    const storedClaim = await persistRniEvidenceClaim(claim(), pool);
    const citationId = randomUUID();
    const storedCitation = await persistRniClaimCitation(
      {
        id: citationId,
        claimId: storedClaim.id,
        sourceItemId: comparativeSource.id,
        evidenceText: 'NVDA has execution momentum',
        createdAt: '2026-09-05T00:06:31.000Z',
      },
      pool,
    );

    expect(storedClaim.inserted).toBe(true);
    expect(storedCitation).toEqual({ id: citationId, inserted: true });
    expect(await getRniCitationById(citationId, pool)).toEqual({
      id: citationId,
      sourceItemId: comparativeSource.id,
      platform: 'reddit',
      url: comparativeSource.originalUrl,
      evidenceText: 'NVDA has execution momentum',
    });
  });

  it('rejects dangling and mismatched claim lineage', async () => {
    await expect(
      persistRniEvidenceClaim(
        claim({
          id: randomUUID(),
          sourceItemId: randomUUID(),
          observationId: null,
          inputHash: HASH_B,
        }),
        pool,
      ),
    ).rejects.toMatchObject({ constraint: 'rni_evidence_claim_source_item_id_fkey' });

    await expect(
      persistRniEvidenceClaim(
        claim({
          id: randomUUID(),
          securityId: rniFixtureIds.amd,
          observationId: rniFixtureIds.nvdaObservation,
          inputHash: HASH_B,
        }),
        pool,
      ),
    ).rejects.toMatchObject({ constraint: 'rni_evidence_claim_observation_fk' });

    await expect(
      persistRniClaimCitation(
        {
          id: randomUUID(),
          claimId: randomUUID(),
          sourceItemId: comparativeSource.id,
          evidenceText: 'not attached to a claim',
          createdAt: '2026-09-05T00:06:31.000Z',
        },
        pool,
      ),
    ).rejects.toMatchObject({ constraint: 'rni_claim_citation_claim_source_fk' });
  });

  it('rejects a citation whose persisted source differs from its claim source', async () => {
    const otherSource = {
      ...comparativeSource,
      id: randomUUID(),
      externalId: 't1_rni_d03_other',
      canonicalUrl: 'https://www.reddit.com/r/stocks/comments/rni_d03/other/',
      originalUrl: 'https://www.reddit.com/r/stocks/comments/rni_d03/other/?context=3',
      boundedContent: 'AMD is discussed in a different persisted source.',
      contentSha256: HASH_B,
      searchQueryId: randomUUID(),
      providerRequestId: 'resp_rni_d03_other',
    };
    await persistRniSource(otherSource, pool);
    const storedClaim = await persistRniEvidenceClaim(claim(), pool);

    await expect(
      persistRniClaimCitation(
        {
          id: randomUUID(),
          claimId: storedClaim.id,
          sourceItemId: otherSource.id,
          evidenceText: 'wrong persisted source',
          createdAt: '2026-09-05T00:06:31.000Z',
        },
        pool,
      ),
    ).rejects.toMatchObject({ constraint: 'rni_claim_citation_claim_source_fk' });
  });

  it('stores the frozen comparative relationship only after both source-security links exist', async () => {
    const first = await persistRniComparativeRelation(comparativeRelation, pool);
    const duplicate = await persistRniComparativeRelation(
      { ...comparativeRelation, id: randomUUID() },
      pool,
    );

    expect(first.inserted).toBe(true);
    expect(duplicate).toEqual({ relation: first.relation, inserted: false });

    await expect(
      pool.query(
        `insert into rni_comparative_relation (
           id, source_item_id, subject_security_id, relation, object_security_id, evidence_text
         ) values ($1, $2, $3, 'preferred_over', $4, 'comparison')`,
        [randomUUID(), comparativeSource.id, rniFixtureIds.nvda, randomUUID()],
      ),
    ).rejects.toMatchObject({ constraint: 'rni_comparative_relation_object_mention_fk' });
  });

  it('persists theme assignment and adjudicated narrative membership idempotently', async () => {
    const versions = await seedRniVersionLineage(pool, 'd03');
    const themeId = randomUUID();
    await persistRniThemeDefinition(
      {
        id: themeId,
        taxonomyVersion: 'themes-v1',
        stableKey: 'ai_infrastructure',
        name: 'AI infrastructure',
        description: 'Compute and infrastructure demand.',
        parentStableKey: null,
        enabled: true,
        createdAt: '2026-09-05T00:06:30.000Z',
      },
      pool,
    );
    expect(
      await persistRniObservationTheme(
        {
          observationId: rniFixtureIds.nvdaObservation,
          themeDefinitionId: themeId,
          classificationConfidence: '0.9',
          themeStance: 'bullish',
          themeScore: '0.8',
          createdAt: '2026-09-05T00:06:31.000Z',
        },
        pool,
      ),
    ).toEqual({ inserted: true });

    const storedClaim = await persistRniEvidenceClaim(claim(), pool);
    const narrativeId = randomUUID();
    await persistRniRunWithSlices(
      {
        id: rniFixtureIds.run,
        idempotencyKey: 'd03-narrative-run',
        trigger: 'manual',
        status: 'running',
        windowStart: '2026-09-04T00:00:00.000Z',
        windowEnd: '2026-09-05T00:00:00.000Z',
        comparisonStart: null,
        comparisonEnd: null,
        universeVersion: versions.universeVersion,
        configVersion: versions.configVersion,
        promptVersion: 'p1',
        aiRoute: 'openai_direct',
        requestedAt: '2026-09-05T00:00:00.000Z',
        completedAt: null,
      },
      [
        {
          id: randomUUID(),
          runId: rniFixtureIds.run,
          platform: 'reddit',
          status: 'complete',
          eligibleSourceCount: 1,
          coverageDisclosure: 'sampled',
          lastAttemptAt: null,
          lastSuccessfulRefreshAt: null,
          dataThroughAt: null,
          computedAt: null,
          errorCode: null,
        },
        {
          id: randomUUID(),
          runId: rniFixtureIds.run,
          platform: 'x',
          status: 'unavailable',
          eligibleSourceCount: 0,
          coverageDisclosure: 'unavailable',
          lastAttemptAt: null,
          lastSuccessfulRefreshAt: null,
          dataThroughAt: null,
          computedAt: null,
          errorCode: 'unavailable',
        },
      ],
      pool,
    );
    await persistRniNarrative(
      {
        id: narrativeId,
        runId: rniFixtureIds.run,
        securityId: rniFixtureIds.nvda,
        canonicalThesis: 'NVDA execution supports AI infrastructure leadership.',
        direction: 'bullish',
        horizon: null,
        status: 'candidate',
        adjudicatorRunId: randomUUID(),
        firstSourceAt: comparativeSource.publishedAt,
        lastSourceAt: comparativeSource.publishedAt,
        independentSourceCount: 1,
        rawRepetitionCount: 1,
        inputHash: HASH_A,
        createdAt: '2026-09-05T00:07:00.000Z',
      },
      pool,
    );
    const membership = {
      narrativeId,
      claimId: storedClaim.id,
      similarity: '1',
      membershipConfidence: '0.95',
      isIndependent: true,
      duplicateGroupHash: null,
      adjudicationReason: 'Exact supported thesis.',
      createdAt: '2026-09-05T00:07:01.000Z',
    } as const;
    expect(await persistRniNarrativeMembership(membership, pool)).toEqual({ inserted: true });
    expect(await persistRniNarrativeMembership(membership, pool)).toEqual({ inserted: false });
  });

  it('rejects an opposing-security claim from a security-specific narrative', async () => {
    const versions = await seedRniVersionLineage(pool, 'd03-opposing-security');
    const runId = randomUUID();
    await persistRniRunWithSlices(
      {
        id: runId,
        idempotencyKey: 'd03-opposing-security-run',
        trigger: 'manual',
        status: 'running',
        windowStart: '2026-09-04T00:00:00.000Z',
        windowEnd: '2026-09-05T00:00:00.000Z',
        comparisonStart: null,
        comparisonEnd: null,
        universeVersion: versions.universeVersion,
        configVersion: versions.configVersion,
        promptVersion: 'p1',
        aiRoute: 'openai_direct',
        requestedAt: '2026-09-05T00:00:00.000Z',
        completedAt: null,
      },
      [
        {
          id: randomUUID(),
          runId,
          platform: 'reddit',
          status: 'complete',
          eligibleSourceCount: 1,
          coverageDisclosure: 'sampled',
          lastAttemptAt: null,
          lastSuccessfulRefreshAt: null,
          dataThroughAt: null,
          computedAt: null,
          errorCode: null,
        },
        {
          id: randomUUID(),
          runId,
          platform: 'x',
          status: 'unavailable',
          eligibleSourceCount: 0,
          coverageDisclosure: 'unavailable',
          lastAttemptAt: null,
          lastSuccessfulRefreshAt: null,
          dataThroughAt: null,
          computedAt: null,
          errorCode: 'unavailable',
        },
      ],
      pool,
    );

    const narrativeId = randomUUID();
    await persistRniNarrative(
      {
        id: narrativeId,
        runId,
        securityId: rniFixtureIds.nvda,
        canonicalThesis: 'NVDA execution supports AI infrastructure leadership.',
        direction: 'bullish',
        horizon: null,
        status: 'candidate',
        adjudicatorRunId: randomUUID(),
        firstSourceAt: comparativeSource.publishedAt,
        lastSourceAt: comparativeSource.publishedAt,
        independentSourceCount: 1,
        rawRepetitionCount: 1,
        inputHash: HASH_A,
        createdAt: '2026-09-05T00:07:00.000Z',
      },
      pool,
    );
    const amdClaim = await persistRniEvidenceClaim(
      claim({
        id: randomUUID(),
        securityId: rniFixtureIds.amd,
        observationId: rniFixtureIds.amdObservation,
        inputHash: HASH_B,
        claimText: 'AMD is the preferable execution story.',
      }),
      pool,
    );

    await expect(
      persistRniNarrativeMembership(
        {
          narrativeId,
          claimId: amdClaim.id,
          similarity: '0.9',
          membershipConfidence: '0.9',
          isIndependent: true,
          duplicateGroupHash: null,
          adjudicationReason: 'Must be rejected despite semantic similarity.',
          createdAt: '2026-09-05T00:07:01.000Z',
        },
        pool,
      ),
    ).rejects.toMatchObject({ constraint: 'rni_narrative_membership_security_match' });
  });
});
