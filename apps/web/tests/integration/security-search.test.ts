import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { searchSecurities } from '../../src/repositories/security';
import { closePool, getPool } from '../../src/repositories/client';

const url = databaseUrl();

/**
 * F09 §4.5: `GET /api/search?q=` — local-only, over the security master, returning symbol,
 * company, exchange and eligibility. No provider call is possible from this repository function
 * at all (it never imports an adapter), which is what F09's DoD item 8 and its own test plan
 * ("search hits no provider") actually rest on.
 */
describe.skipIf(url === undefined)('searchSecurities', () => {
  let pool: pg.Pool;
  let gmeId: string;
  let amcId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const gme = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency, active)
       values ('GME', 'GameStop Corp', 'NYSE', 'equity', 'USD', true) returning id`,
    );
    gmeId = gme.rows[0]?.id as string;

    const amc = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency, active)
       values ('AMC', 'AMC Entertainment Holdings', 'NYSE', 'equity', 'USD', true) returning id`,
    );
    amcId = amc.rows[0]?.id as string;

    await pool.query(
      `insert into security (symbol, name, exchange, asset_type, currency, active)
       values ('OLD', 'Delisted Co', 'NYSE', 'equity', 'USD', false)`,
    );
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  it('matches a symbol prefix', async () => {
    const results = await searchSecurities({ q: 'GM', asOfInstant: new Date('2026-09-01T00:00:00Z') });
    expect(results.map((row) => row.symbol)).toEqual(['GME']);
  });

  it('matches a name substring', async () => {
    const results = await searchSecurities({
      q: 'entertainment',
      asOfInstant: new Date('2026-09-01T00:00:00Z'),
    });
    expect(results.map((row) => row.symbol)).toEqual(['AMC']);
  });

  it('excludes an inactive security', async () => {
    const results = await searchSecurities({ q: 'Delisted', asOfInstant: new Date('2026-09-01T00:00:00Z') });
    expect(results).toHaveLength(0);
  });

  it('treats a literal "%" as a literal character, not a wildcard matching everything (lane-review finding 5)', async () => {
    // A user typing `%` into a per-keystroke search box should get no matches, not a page of
    // every active security presented as if it were a real result of what they typed.
    const results = await searchSecurities({ q: '%', asOfInstant: new Date('2026-09-01T00:00:00Z') });
    expect(results).toHaveLength(0);
  });

  it('treats a literal "_" as a literal character, not a single-character wildcard', async () => {
    // Unescaped, `_` matches any one character — every three-letter symbol in the fixture data
    // ('GME', 'AMC', 'OLD') would otherwise match a bare `_` pattern search.
    const results = await searchSecurities({ q: '_', asOfInstant: new Date('2026-09-01T00:00:00Z') });
    expect(results).toHaveLength(0);
  });

  it('still matches normally once the metacharacters are escaped away', async () => {
    // Sanity check that escaping did not also break ordinary matching: 'GME' is still a real,
    // unescaped prefix match — chosen over a single letter because 'AMC Entertainment
    // **Holdings**' contains a literal 'g', which a single-character query would also match via
    // the name-substring arm and turn this into a false negative about escaping, not a true one.
    const results = await searchSecurities({ q: 'GME', asOfInstant: new Date('2026-09-01T00:00:00Z') });
    expect(results.map((row) => row.symbol)).toEqual(['GME']);
  });

  it('returns an empty result for a blank query without touching the database predicate', async () => {
    const results = await searchSecurities({ q: '   ', asOfInstant: new Date('2026-09-01T00:00:00Z') });
    expect(results).toEqual([]);
  });

  it('returns eligibility null when no profile snapshot has been observed yet', async () => {
    const results = await searchSecurities({ q: 'GME', asOfInstant: new Date('2026-09-01T00:00:00Z') });
    expect(results[0]).toMatchObject({ symbol: 'GME', eligibilityState: null });
  });

  it('returns the current eligibility state as of the given instant', async () => {
    await pool.query(
      `insert into security_profile_snapshot
         (security_id, provider, eligibility_state, observed_at, ingested_at, raw_hash)
       values ($1, 'fmp', 'ready', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 'p1')`,
      [gmeId],
    );

    const results = await searchSecurities({ q: 'GME', asOfInstant: new Date('2026-09-02T00:00:00Z') });
    expect(results[0]).toMatchObject({ symbol: 'GME', eligibilityState: 'ready' });
  });

  it('excludes an eligibility state ingested after the as-of instant (F22 §4.2 look-ahead guard)', async () => {
    const cutoff = new Date('2026-09-01T12:00:00Z');
    await pool.query(
      `insert into security_profile_snapshot
         (security_id, provider, eligibility_state, observed_at, ingested_at, raw_hash)
       values ($1, 'fmp', 'ready', '2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z', 'known-then')`,
      [gmeId],
    );
    await pool.query(
      `insert into security_profile_snapshot
         (security_id, provider, eligibility_state, observed_at, ingested_at, raw_hash)
       values ($1, 'fmp', 'rights_blocked', '2026-09-01T00:00:00Z', '2026-09-05T00:00:00Z', 'learned-later')`,
      [gmeId],
    );

    const asOfCutoff = await searchSecurities({ q: 'GME', asOfInstant: cutoff });
    expect(asOfCutoff[0]).toMatchObject({ eligibilityState: 'ready' });

    const asOfLater = await searchSecurities({ q: 'GME', asOfInstant: new Date('2026-09-06T00:00:00Z') });
    expect(asOfLater[0]).toMatchObject({ eligibilityState: 'rights_blocked' });
  });

  it('collapses eligibility to the latest observation and matches each result to its own security', async () => {
    await pool.query(
      `insert into security_profile_snapshot
         (security_id, provider, eligibility_state, observed_at, ingested_at, raw_hash)
       values ($1, 'fmp', 'ready', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 'gme-1')`,
      [gmeId],
    );
    await pool.query(
      `insert into security_profile_snapshot
         (security_id, provider, eligibility_state, observed_at, ingested_at, raw_hash)
       values ($1, 'fmp', 'partial', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 'amc-1')`,
      [amcId],
    );

    const results = await searchSecurities({ q: 'A', asOfInstant: new Date('2026-09-02T00:00:00Z') });
    const bySymbol = new Map(results.map((row) => [row.symbol, row.eligibilityState]));
    expect(bySymbol.get('GME')).toBe('ready');
    expect(bySymbol.get('AMC')).toBe('partial');
  });
});
