import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  comparativeMentions,
  comparativeObservations,
  comparativeSource,
  rniFixtureIds,
} from '../../../src/rni/testing/reference-fixtures';
import type { RniDimensionAssignment } from '../../../src/rni/contracts';
import {
  persistRniSecurityMention,
  persistRniSecurityObservation,
} from '../../../src/rni/repositories/observations';
import { persistRniSource } from '../../../src/rni/repositories/source-items';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';

const url = databaseUrl();

describe.skipIf(url === undefined)('RNI D02 multi-security observations', () => {
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
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('stores two security links and independent opposing observations for one source', async () => {
    for (const mention of comparativeMentions) {
      expect((await persistRniSecurityMention(mention, pool)).inserted).toBe(true);
    }
    for (const observation of comparativeObservations) {
      expect((await persistRniSecurityObservation(observation, pool)).inserted).toBe(true);
    }

    const { rows } = await pool.query<{
      symbol: string;
      stance: string;
      claim_summary: string;
    }>(
      `select s.symbol, o.stance, o.claim_summary
         from rni_security_observation o
         join security s on s.id = o.security_id
        where o.source_item_id = $1
        order by s.symbol`,
      [comparativeSource.id],
    );
    expect(rows).toEqual([
      {
        symbol: 'AMD',
        stance: 'bearish',
        claim_summary: 'AMD is presented as trailing NVDA.',
      },
      {
        symbol: 'NVDA',
        stance: 'bullish',
        claim_summary: 'NVDA is presented as executing well.',
      },
    ]);
  });

  it('round-trips all four frozen dimension assignments', async () => {
    await persistRniSecurityMention(comparativeMentions[0]!, pool);
    const dimensions: RniDimensionAssignment[] = [
      {
        dimension: 'company_fundamentals',
        stance: 'bullish',
        score: '0.70',
        rationale: 'Execution claim.',
      },
      {
        dimension: 'market_trading',
        stance: 'bullish',
        score: '0.55',
        rationale: 'Momentum claim.',
      },
      {
        dimension: 'catalyst_event',
        stance: 'neutral',
        score: '0',
        rationale: 'No event direction asserted.',
      },
      {
        dimension: 'retail_narrative',
        stance: 'strong_bullish',
        score: '0.90',
        rationale: 'Strong positive retail framing.',
      },
    ];
    const input = { ...comparativeObservations[0]!, dimensions };
    const result = await persistRniSecurityObservation(input, pool);

    expect(result.observation.dimensions).toEqual(dimensions);
  });

  it('requires a persisted source-security link before an observation', async () => {
    await expect(
      persistRniSecurityObservation(comparativeObservations[0]!, pool),
    ).rejects.toMatchObject({ constraint: 'rni_security_observation_mention_fk' });
  });

  it('deduplicates repeated mention and observation delivery by natural identity', async () => {
    const mention = comparativeMentions[0]!;
    const observation = comparativeObservations[0]!;
    const firstMention = await persistRniSecurityMention(mention, pool);
    const duplicateMention = await persistRniSecurityMention(
      { ...mention, id: '10000000-0000-4000-8000-000000000005' },
      pool,
    );
    const firstObservation = await persistRniSecurityObservation(observation, pool);
    const duplicateObservation = await persistRniSecurityObservation(
      { ...observation, id: '10000000-0000-4000-8000-000000000007' },
      pool,
    );

    expect(firstMention.inserted).toBe(true);
    expect(duplicateMention).toEqual({ mention: firstMention.mention, inserted: false });
    expect(firstObservation.inserted).toBe(true);
    expect(duplicateObservation).toEqual({
      observation: firstObservation.observation,
      inserted: false,
    });
  });

  it('rejects duplicate or unknown dimension assignments at the database boundary', async () => {
    await persistRniSecurityMention(comparativeMentions[0]!, pool);
    const observation = comparativeObservations[0]!;
    const duplicateDimensions = [observation.dimensions[0], observation.dimensions[0]];

    await expect(
      pool.query(
        `insert into rni_security_observation (
           id, source_item_id, security_id, stance, relevance, claim_summary,
           dimension_assignments, classifier_run_id, prompt_version, model_id, input_hash,
           created_at
         ) values ($1, $2, $3, 'bullish', 1, 'duplicate dimensions', $4::jsonb, $5, 'v1',
           'model', $6, now())`,
        [
          '20000000-0000-4000-8000-000000000007',
          comparativeSource.id,
          rniFixtureIds.nvda,
          JSON.stringify(duplicateDimensions),
          '20000000-0000-4000-8000-000000000009',
          observation.inputHash,
        ],
      ),
    ).rejects.toMatchObject({ constraint: 'rni_security_observation_dimensions_check' });
  });
});
