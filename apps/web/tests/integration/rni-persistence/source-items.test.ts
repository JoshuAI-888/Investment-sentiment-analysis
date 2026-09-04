import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { RniSourceItem } from '../../../src/rni/contracts';
import { getRniSourceById, persistRniSource } from '../../../src/rni/repositories/source-items';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';

const url = databaseUrl();
const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe.skipIf(url === undefined)('RNI D01 source-first persistence', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  function source(overrides: Partial<RniSourceItem> = {}): RniSourceItem {
    return {
      id: randomUUID(),
      platform: 'reddit',
      sourceKind: 'post',
      externalId: 't3_rni_d01',
      canonicalUrl: 'https://www.reddit.com/r/stocks/comments/rni_d01/source_first/',
      originalUrl:
        'https://www.reddit.com/r/stocks/comments/rni_d01/source_first/?utm_source=search',
      subredditOrScope: 'r/stocks',
      authorHandleHash: HASH_B,
      title: 'Source-first evidence',
      boundedContent: 'NVDA execution remains the central claim in this bounded post.',
      contentSha256: HASH_A,
      captureMode: 'full_post',
      publishedAt: '2026-09-05T00:00:00.000Z',
      discoveredAt: '2026-09-05T00:05:00.000Z',
      observedAt: '2026-09-05T00:05:00.000Z',
      searchQueryId: randomUUID(),
      providerRequestId: 'resp_rni_d01',
      metadata: { score: 42, commentCount: 7 },
      rightsPolicyVersion: 'rni-source-policy-v1',
      createdAt: '2026-09-05T00:05:01.000Z',
      ...overrides,
    };
  }

  it('applies the canonical source, retrieval, and bounded-content tables', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'rni_source_%'`,
    );
    expect(rows.map((row) => row.table_name).sort()).toEqual([
      'rni_source_content_version',
      'rni_source_item',
      'rni_source_retrieval',
    ]);
  });

  it('cannot attach retrieval provenance to the wrong platform', async () => {
    const input = source();
    await persistRniSource(input, pool);

    await expect(
      pool.query(
        `insert into rni_source_retrieval (
           source_item_id, platform, returned_url, discovered_at, observed_at
         ) values ($1, 'x', $2, $3, $3)`,
        [input.id, input.originalUrl, input.observedAt],
      ),
    ).rejects.toMatchObject({ constraint: 'rni_source_retrieval_source_platform_fk' });
  });

  it('commits one source identity with its retrieval and bounded content', async () => {
    const input = source();
    const result = await persistRniSource(input, pool);

    expect(result).toMatchObject({
      sourceInserted: true,
      retrievalInserted: true,
      contentVersionInserted: true,
    });
    expect(result.source).toEqual(input);
    expect(await getRniSourceById(input.id, pool)).toEqual(input);

    const { rows } = await pool.query<{
      sources: string;
      retrievals: string;
      versions: string;
      original_url: string;
    }>(
      `select
         (select count(*)::text from rni_source_item) as sources,
         (select count(*)::text from rni_source_retrieval) as retrievals,
         (select count(*)::text from rni_source_content_version) as versions,
         (select original_url from rni_source_item limit 1) as original_url`,
    );
    expect(rows[0]).toEqual({
      sources: '1',
      retrievals: '1',
      versions: '1',
      original_url: input.originalUrl,
    });
  });

  it('returns the committed identity on exact duplicate delivery', async () => {
    const firstInput = source();
    const first = await persistRniSource(firstInput, pool);
    const duplicate = await persistRniSource({ ...firstInput, id: randomUUID() }, pool);

    expect(duplicate.source.id).toBe(first.source.id);
    expect(duplicate).toMatchObject({
      sourceInserted: false,
      retrievalId: first.retrievalId,
      retrievalInserted: false,
      contentVersionId: first.contentVersionId,
      contentVersionInserted: false,
    });
  });

  it('uses platform plus canonical URL when no external ID is available', async () => {
    const firstInput = source({ externalId: null });
    const first = await persistRniSource(firstInput, pool);
    const duplicate = await persistRniSource(
      { ...firstInput, id: randomUUID(), providerRequestId: 'resp_rni_d01_retry' },
      pool,
    );

    expect(duplicate.source.id).toBe(first.source.id);
    expect(duplicate.sourceInserted).toBe(false);
    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from rni_source_item',
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('appends changed bounded content without replacing the original source record', async () => {
    const firstInput = source();
    const first = await persistRniSource(firstInput, pool);
    const changed = await persistRniSource(
      {
        ...firstInput,
        id: randomUUID(),
        boundedContent: 'NVDA execution remains the claim; the author added valuation context.',
        contentSha256: HASH_B,
        observedAt: '2026-09-05T01:05:00.000Z',
        createdAt: '2026-09-05T01:05:01.000Z',
      },
      pool,
    );

    expect(changed.source.id).toBe(first.source.id);
    expect(changed.sourceInserted).toBe(false);
    expect(changed.retrievalInserted).toBe(true);
    expect(changed.contentVersionInserted).toBe(true);
    expect(changed.contentVersionId).not.toBe(first.contentVersionId);

    const { rows } = await pool.query<{
      content_sha256: string;
      prior_version_id: string | null;
    }>(
      `select content_sha256, prior_version_id from rni_source_content_version
        where source_item_id = $1 order by created_at`,
      [first.source.id],
    );
    expect(rows).toEqual([
      { content_sha256: HASH_A, prior_version_id: null },
      { content_sha256: HASH_B, prior_version_id: first.contentVersionId },
    ]);
    expect((await getRniSourceById(first.source.id, pool))?.boundedContent).toBe(
      firstInput.boundedContent,
    );
  });

  it('rejects whole-page HTML at both validation and database boundaries', async () => {
    await expect(
      persistRniSource(source({ boundedContent: '<html><body>page chrome</body></html>' }), pool),
    ).rejects.toThrow('Whole-page HTML');

    const input = source();
    await expect(
      pool.query(
        `insert into rni_source_item (
           id, platform, source_kind, external_id, canonical_url, original_url,
           subreddit_or_scope, bounded_content, content_sha256, capture_mode, discovered_at,
           observed_at, metadata_json, rights_policy_version, created_at
         ) values ($1, 'reddit', 'post', $2, $3, $3, 'r/stocks', '<!doctype html><html>',
           $4, 'full_post', $5, $5, '{}'::jsonb, 'rni-source-policy-v1', $5)`,
        [randomUUID(), 't3_html', input.canonicalUrl, HASH_A, input.createdAt],
      ),
    ).rejects.toMatchObject({ constraint: 'rni_source_item_no_page_html_check' });
  });
});
