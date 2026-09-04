import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { RniSourceItem } from '../../../src/rni/contracts';
import {
  pendingRniOutboxEvents,
  persistRniSource,
} from '../../../src/rni/repositories/source-items';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';

const url = databaseUrl();
const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe.skipIf(url === undefined)(
  'RNI D06 concurrent idempotency and transactional outbox',
  () => {
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

    function source(id: string = randomUUID()): RniSourceItem {
      return {
        id,
        platform: 'reddit',
        sourceKind: 'post',
        externalId: 't3_concurrent_source',
        canonicalUrl: 'https://www.reddit.com/r/stocks/comments/concurrent/source/',
        originalUrl: 'https://www.reddit.com/r/stocks/comments/concurrent/source/',
        subredditOrScope: 'r/stocks',
        authorHandleHash: null,
        title: 'Concurrent source persistence',
        boundedContent: 'One bounded source survives concurrent duplicate delivery.',
        contentSha256: HASH,
        captureMode: 'full_post',
        publishedAt: '2026-09-05T00:00:00.000Z',
        discoveredAt: '2026-09-05T00:01:00.000Z',
        observedAt: '2026-09-05T00:01:00.000Z',
        searchQueryId: randomUUID(),
        providerRequestId: 'resp_concurrent',
        metadata: { bounded: true },
        rightsPolicyVersion: 'rni-source-policy-v1',
        createdAt: '2026-09-05T00:01:01.000Z',
      };
    }

    it('converges concurrent duplicate inserts on one source, retrieval, content, and outbox event', async () => {
      const first = source();
      const inputs = Array.from({ length: 8 }, (_, index) => ({
        ...first,
        id: randomUUID(),
        searchQueryId: first.searchQueryId,
        metadata: { bounded: true, delivery: index },
      }));
      const results = await Promise.all(inputs.map((input) => persistRniSource(input, pool)));

      expect(new Set(results.map((result) => result.source.id)).size).toBe(1);
      expect(new Set(results.map((result) => result.retrievalId)).size).toBe(1);
      expect(new Set(results.map((result) => result.contentVersionId)).size).toBe(1);
      expect(new Set(results.map((result) => result.outboxEventId)).size).toBe(1);
      expect(results.filter((result) => result.sourceInserted)).toHaveLength(1);
      expect(results.filter((result) => result.outboxInserted)).toHaveLength(1);

      const { rows } = await pool.query<{
        sources: string;
        retrievals: string;
        contents: string;
        events: string;
      }>(
        `select
         (select count(*)::text from rni_source_item) as sources,
         (select count(*)::text from rni_source_retrieval) as retrievals,
         (select count(*)::text from rni_source_content_version) as contents,
         (select count(*)::text from rni_event_outbox) as events`,
      );
      expect(rows[0]).toEqual({ sources: '1', retrievals: '1', contents: '1', events: '1' });
    });

    it('exposes only ID-only committed outbox payloads', async () => {
      const result = await persistRniSource(source(), pool);
      const events = await pendingRniOutboxEvents(10, pool);
      expect(events).toEqual([
        {
          id: result.outboxEventId,
          eventType: 'rni.source_persisted.v1',
          sourceItemId: result.source.id,
          retrievalId: result.retrievalId,
          contentVersionId: result.contentVersionId,
          createdAt: result.source.createdAt,
        },
      ]);

      const { rows } = await pool.query<{ payload_json: Record<string, unknown> }>(
        'select payload_json from rni_event_outbox',
      );
      expect(Object.keys(rows[0]!.payload_json).sort()).toEqual([
        'contentVersionId',
        'retrievalId',
        'sourceItemId',
      ]);
    });

    it('rolls back source evidence when the same transaction cannot write its outbox event', async () => {
      await pool.query(`
      create function rni_test_reject_outbox() returns trigger language plpgsql as $$
      begin
        raise exception 'simulated outbox failure';
      end;
      $$;
      create trigger rni_test_reject_outbox before insert on rni_event_outbox
        for each row execute function rni_test_reject_outbox();
    `);
      try {
        await expect(persistRniSource(source(), pool)).rejects.toThrow('simulated outbox failure');
        const { rows } = await pool.query<{ sources: string; events: string }>(
          `select
           (select count(*)::text from rni_source_item) as sources,
           (select count(*)::text from rni_event_outbox) as events`,
        );
        expect(rows[0]).toEqual({ sources: '0', events: '0' });
      } finally {
        await pool.query('drop trigger rni_test_reject_outbox on rni_event_outbox');
        await pool.query('drop function rni_test_reject_outbox()');
      }
    });
  },
);
