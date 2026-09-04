import { describe, expect, it } from 'vitest';
import { insertEvidenceItem, type NewEvidenceItem } from '../../../src/repositories/evidence';
import type { Queryable } from '../../../src/repositories/client';

/**
 * `evidence_item` has no unique constraint on `raw_hash` and its primary key is a freshly
 * `gen_random_uuid()`-ed `id` (see `evidence.ts`'s module docstring) — unlike `market_snapshot`
 * or `attention_snapshot`, there is no real composite primary key for two genuinely concurrent
 * inserts to collide on, so a true database-level race cannot be constructed against a real
 * Postgres instance for this table (`tests/integration/evidence.test.ts` proves the sequential
 * cases instead: exact-repeat idempotency, a genuine revision writing a new row, and the
 * as-of bound).
 *
 * This test exercises the one thing that genuinely is testable without a real race: that
 * `insertEvidenceItem` recovers gracefully if the underlying driver ever *does* report a `23505`
 * (e.g. a future unique index closing the gap this module's docstring flags under `CONTRACTS`),
 * rather than letting it escape as an unhandled rejection. It stubs the driver deliberately —
 * this is the one case in this feature's test suite that is not run against real Postgres, and
 * that is stated here rather than left for a reviewer to notice on their own.
 */
describe('insertEvidenceItem — the 23505 recovery path', () => {
  function baseItem(overrides: Partial<NewEvidenceItem> = {}): NewEvidenceItem {
    return {
      securityId: null,
      evidenceType: 'news',
      provider: 'marketaux',
      title: 'Stub item',
      snippet: null,
      sourceUrl: null,
      publisher: null,
      authorRef: null,
      stanceLabel: null,
      stanceScore: null,
      relevanceScore: null,
      publishedAt: null,
      availableAt: new Date('2026-09-01T00:00:00Z'),
      lastCheckedAt: null,
      availability: 'available',
      licenseClass: 'snippet',
      coverageClass: 'sample',
      rawHash: 'stub-hash',
      metadata: {},
      ...overrides,
    };
  }

  it('reads back the existing row rather than throwing when the driver reports 23505', async () => {
    const existingRow = {
      id: '11111111-1111-1111-1111-111111111111',
      security_id: null,
      evidence_type: 'news',
      provider: 'marketaux',
      title: 'Stub item',
      snippet: null,
      source_url: null,
      publisher: null,
      author_ref: null,
      stance_label: null,
      stance_score: null,
      relevance_score: null,
      published_at: null,
      available_at: new Date('2026-09-01T00:00:00Z'),
      ingested_at: new Date('2026-09-01T00:00:00Z'),
      last_checked_at: null,
      availability: 'available',
      license_class: 'snippet',
      coverage_class: 'sample',
      raw_hash: 'stub-hash',
      metadata: {},
    };

    let call = 0;
    const stub: Queryable = {
      query: async (text: string) => {
        call += 1;
        if (call === 1) {
          // The insert attempt: simulate the driver reporting a real unique violation.
          expect(text.trim().toLowerCase().startsWith('insert into evidence_item')).toBe(true);
          const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
          });
          throw error;
        }
        // The read-back through `asOf`.
        return { rows: [existingRow], rowCount: 1 } as never;
      },
    };

    const result = await insertEvidenceItem(baseItem(), stub);
    expect(result.inserted).toBe(false);
    expect(result.item.rawHash).toBe('stub-hash');
    expect(call).toBe(2);
  });

  it('does not swallow a driver error that is not a unique violation', async () => {
    const stub: Queryable = {
      query: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    };

    await expect(insertEvidenceItem(baseItem(), stub)).rejects.toThrow(
      'connection terminated unexpectedly',
    );
  });
});
