import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { RniSourceItem } from '../../../src/rni/contracts';
import {
  recordRniRejectedDiscovery,
  tombstoneRniSource,
  type RniRejectedDiscoveryInput,
} from '../../../src/rni/repositories/source-states';
import { getRniSourceById, persistRniSource } from '../../../src/rni/repositories/source-items';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';

const url = databaseUrl();
const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe.skipIf(url === undefined)('RNI D07 source tombstone and rejection states', () => {
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

  function source(): RniSourceItem {
    return {
      id: randomUUID(),
      platform: 'reddit',
      sourceKind: 'comment',
      externalId: 't1_tombstone',
      canonicalUrl: 'https://www.reddit.com/r/stocks/comments/post/comment/tombstone/',
      originalUrl: 'https://www.reddit.com/r/stocks/comments/post/comment/tombstone/?context=3',
      subredditOrScope: 'r/stocks',
      authorHandleHash: null,
      title: null,
      boundedContent: 'This is one bounded comment, not the surrounding page.',
      contentSha256: HASH,
      captureMode: 'full_comment',
      publishedAt: '2026-09-05T00:00:00.000Z',
      discoveredAt: '2026-09-05T00:01:00.000Z',
      observedAt: '2026-09-05T00:01:00.000Z',
      searchQueryId: randomUUID(),
      providerRequestId: 'resp_tombstone',
      metadata: { scoreAtCapture: 5 },
      rightsPolicyVersion: 'rni-source-policy-v1',
      createdAt: '2026-09-05T00:01:01.000Z',
    };
  }

  function rejected(overrides: Partial<RniRejectedDiscoveryInput> = {}): RniRejectedDiscoveryInput {
    return {
      id: randomUUID(),
      platform: 'reddit',
      returnedUrl: 'https://www.reddit.com/r/stocks/comments/rejected/',
      canonicalUrl: 'https://www.reddit.com/r/stocks/comments/rejected/',
      searchQueryId: randomUUID(),
      providerRequestId: 'resp_rejected',
      rejectionReason: 'whole_page_html',
      discoveryFingerprint: HASH,
      metadata: { title: 'Rejected result', reasonDetail: 'page payload was not bounded' },
      observedAt: '2026-09-05T00:01:00.000Z',
      createdAt: '2026-09-05T00:01:01.000Z',
      ...overrides,
    };
  }

  it('moves an active source to a terminal tombstone without changing its URL or evidence', async () => {
    const input = source();
    await persistRniSource(input, pool);
    const state = await tombstoneRniSource(
      input.id,
      'tombstoned',
      'source takedown request',
      '2026-09-05T01:00:00.000Z',
      pool,
    );

    expect(state).toEqual({
      sourceItemId: input.id,
      status: 'tombstoned',
      tombstonedAt: '2026-09-05T01:00:00.000Z',
      reason: 'source takedown request',
    });
    expect(await getRniSourceById(input.id, pool)).toEqual(input);
    await expect(
      pool.query("update rni_source_item set bounded_content = 'replacement' where id = $1", [
        input.id,
      ]),
    ).rejects.toMatchObject({ code: '23001' });
    await expect(
      tombstoneRniSource(
        input.id,
        'restricted',
        'attempted second terminal state',
        '2026-09-05T02:00:00.000Z',
        pool,
      ),
    ).rejects.toThrow('already in a terminal');
  });

  it('records rejected discovery provenance without a content/page column', async () => {
    const input = rejected();
    const first = await recordRniRejectedDiscovery(input, pool);
    const duplicate = await recordRniRejectedDiscovery({ ...input, id: randomUUID() }, pool);
    expect(first.inserted).toBe(true);
    expect(duplicate).toEqual({ id: first.id, inserted: false });

    const { rows: columns } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'rni_rejected_discovery'`,
    );
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain('bounded_content');
    expect(names).not.toContain('page_html');
    expect(names).not.toContain('provider_payload');
  });

  it('rejects whole-page HTML even when hidden inside rejection metadata', async () => {
    await expect(
      recordRniRejectedDiscovery(
        rejected({ metadata: { response: '<!doctype html><html><body>full page</body></html>' } }),
        pool,
      ),
    ).rejects.toThrow('Whole-page HTML');

    await expect(
      pool.query(
        `insert into rni_rejected_discovery (
           id, platform, rejection_reason, discovery_fingerprint, metadata_json, observed_at
         ) values ($1, 'reddit', 'whole_page_html', $2, $3::jsonb, now())`,
        [randomUUID(), HASH, JSON.stringify({ response: '<html>full page</html>' })],
      ),
    ).rejects.toMatchObject({ constraint: 'rni_rejected_discovery_no_page_html_check' });
  });
});
