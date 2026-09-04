/**
 * A minimal, in-memory `Queryable` for unit-testing `services/evidence/*` against
 * `repositories/evidence.ts`'s real `evidenceForSecurity` without a live Postgres.
 *
 * It does not parse SQL. `evidenceForSecurity`'s own SQL construction is exercised for real by
 * `tests/integration/evidence.test.ts` (a live-DB suite); what this fake needs to get right is
 * the *positional parameter contract* that function relies on: `$1` is always the as-of instant,
 * `$2` is always `securityId`, and `$3` (present only when a `providers` filter was given) is the
 * provider array. Filtering happens on the in-memory row set using those same positions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import type { Queryable } from '@/repositories/client';
import { snakeizeRow } from '@/repositories/rows';
import { evidenceItem, type EvidenceItem } from '@/contracts/evidence';
import type { SecurityIdentity } from '@/services/evidence/candidates';

let counter = 0;

export function fakeEvidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  counter += 1;
  return {
    id: `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`,
    securityId: '00000000-0000-0000-0000-0000000000aa',
    evidenceType: 'social_result',
    provider: 'reddit',
    title: 'A test evidence item',
    snippet: 'A short snippet body.',
    sourceUrl: `https://example.com/item-${counter}`,
    publisher: null,
    authorRef: null,
    stanceLabel: null,
    stanceScore: null,
    relevanceScore: null,
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    availableAt: new Date('2026-09-01T00:05:00Z'),
    ingestedAt: new Date('2026-09-01T00:06:00Z'),
    lastCheckedAt: null,
    availability: 'unchecked',
    licenseClass: 'own_collected',
    coverageClass: 'licensed_sample',
    rawHash: `hash-${counter}`,
    metadata: {},
    ...overrides,
  };
}

/**
 * `rows` should be in `EvidenceItem` (camelCase) shape — this converts to the snake_case a real
 * query would return and applies the same `security_id`/`provider` filtering
 * `evidenceForSecurity` asks the database to do, positionally, from the params it actually sends.
 */
export function fakeEvidenceDb(rows: readonly EvidenceItem[]): Queryable {
  return {
    query: async <R extends pg.QueryResultRow>(_text: string, values: readonly unknown[] = []) => {
      const [, securityId, providers] = values;
      const filtered = rows.filter((row) => {
        if (securityId !== undefined && row.securityId !== securityId) return false;
        if (Array.isArray(providers) && !providers.includes(row.provider)) return false;
        return true;
      });
      // Most-recent-first, matching `evidenceForSecurity`'s own `order by available_at desc`.
      const sorted = [...filtered].sort((a, b) => b.availableAt.getTime() - a.availableAt.getTime());
      return {
        rows: sorted.map((row) => snakeizeRow({ ...row })) as unknown as R[],
        rowCount: sorted.length,
        command: 'SELECT',
        oid: 0,
        fields: [],
      };
    },
  };
}

const FIXTURES_ROOT = join(process.cwd(), 'fixtures', 'evidence-pack');

export type EvidencePackFixture = {
  readonly security: SecurityIdentity & { readonly id: string };
  readonly items: readonly EvidenceItem[];
};

/**
 * Loads one of `fixtures/evidence-pack/<name>.json`'s hand-built scenarios (F10 lane assignment:
 * "small, hand-built evidence_item-shaped fixture sets"), validating every item through the real
 * `evidenceItem` zod schema exactly as `evidenceForSecurity` would.
 */
export function loadEvidencePackFixture(name: string): EvidencePackFixture {
  const raw = readFileSync(join(FIXTURES_ROOT, `${name}.json`), 'utf-8');
  const parsed = JSON.parse(raw) as { security: SecurityIdentity & { id: string }; items: unknown[] };
  return {
    security: parsed.security,
    items: parsed.items.map((item) => evidenceItem.parse(item)),
  };
}
