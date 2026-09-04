import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from '../../src/repositories/migrate';
import { camelizeRow } from '../../src/repositories/rows';
import { marketSnapshot, security } from '../../src/contracts/security';
import { costEvent } from '../../src/contracts/cost';

pg.types.setTypeParser(1700, (value) => value);
pg.types.setTypeParser(20, (value) => value);

const url = process.env['DATABASE_URL'];

/**
 * F03 §5: "DB row → domain object → DB row is byte-identical for decimals and timestamps".
 *
 * This is the test that would have caught the default node-postgres numeric parser. A float
 * round-trip looks correct for `100.00` and wrong for `0.1` — and the second only ever shows
 * up in a hash mismatch, months later, in an artifact nobody can replay.
 */
describe.skipIf(url === undefined || url === '')('serialization parity', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    await pool.query('drop schema public cascade; create schema public;');
    await migrate(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  const DECIMALS = ['0.1', '100.00', '0.30000000000000004', '1234567890.123456789', '-0.05', '0'];

  it.each(DECIMALS)('round-trips the decimal %s byte-identically', async (value) => {
    const { rows: sec } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ($1, 'Test', 'NASDAQ', 'equity', 'USD') returning id`,
      [`D${value.replace(/[^0-9]/g, '').slice(0, 8)}${Math.random().toString(36).slice(2, 7)}`],
    );
    const securityId = sec[0]?.id as string;
    const observedAt = new Date('2026-08-30T12:34:56.789Z');

    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, raw_hash)
       values ($1, $2, 'eod', 'fmp', $3, 'h')`,
      [securityId, value, observedAt],
    );

    const { rows } = await pool.query(
      `select security_id, price, change_percent, session, provider, observed_at, ingested_at, raw_hash
         from market_snapshot where security_id = $1`,
      [securityId],
    );

    const domain = marketSnapshot.parse(camelizeRow(rows[0] as Record<string, unknown>));

    // Byte-identical: not "equal after rounding", not "close enough".
    expect(domain.price).toBe(value);
    expect(typeof domain.price).toBe('string');

    // And back again, unchanged.
    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, raw_hash)
       values ($1, $2, 'eod', 'fmp', $3, 'h2')`,
      [securityId, domain.price, new Date('2026-08-31T00:00:00.000Z')],
    );
    const { rows: again } = await pool.query<{ price: string }>(
      `select price from market_snapshot where security_id = $1 and raw_hash = 'h2'`,
      [securityId],
    );
    expect(again[0]?.price).toBe(value);
  });

  it('preserves a timestamp to the millisecond', async () => {
    const { rows: sec } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('TSTIME', 'Test', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    const observedAt = new Date('2026-08-30T12:34:56.789Z');

    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, raw_hash)
       values ($1, '1', 'eod', 'fmp', $2, 'ts')`,
      [sec[0]?.id, observedAt],
    );

    const { rows } = await pool.query(
      `select security_id, price, change_percent, session, provider, observed_at, ingested_at, raw_hash
         from market_snapshot where raw_hash = 'ts'`,
    );
    const domain = marketSnapshot.parse(camelizeRow(rows[0] as Record<string, unknown>));
    expect(domain.observedAt.toISOString()).toBe('2026-08-30T12:34:56.789Z');
  });

  it('round-trips a security row through its contract', async () => {
    const { rows } = await pool.query(
      `insert into security (symbol, name, exchange, asset_type, currency, aliases)
       values ('RTRIP', 'Round Trip Inc', 'NYSE', 'etf', 'USD', '["RT"]'::jsonb)
       returning id, symbol, name, exchange, asset_type, sector, industry, cik, currency, active, aliases, created_at, updated_at`,
    );
    const domain = security.parse(camelizeRow(rows[0] as Record<string, unknown>));
    expect(domain.symbol).toBe('RTRIP');
    expect(domain.assetType).toBe('etf');
    expect(domain.aliases).toEqual(['RT']);
  });

  it('keeps an unpriced cost event null rather than zero', async () => {
    const { rows } = await pool.query(
      `insert into cost_event
         (occurred_at, provider, service, operation_or_model, feature, request_id, unit_type,
          request_units, billable_units, cost_status, cache_status)
       values (now(), 'x', 'api', 'post_read', 'trigger', 'r1', 'post_read', '1', '1', 'unpriced', 'miss')
       returning id, occurred_at, provider, service, operation_or_model, feature, job_run_id,
                 research_run_id, user_id, request_id, unit_type, request_units, billable_units,
                 unit_price, currency, price_book_version, cost_usd, cost_status, cache_status,
                 metadata, supersedes_cost_event_id`,
    );
    const domain = costEvent.parse(camelizeRow(rows[0] as Record<string, unknown>));
    expect(domain.costUsd).toBeNull();
    expect(domain.costStatus).toBe('unpriced');
  });

  it('rejects a priced event that carries no amount', async () => {
    // The contract and the check constraint say the same thing, which is the point: the
    // constraint stops a second write path, the contract stops a bad object before it gets there.
    expect(() =>
      costEvent.parse({
        id: '00000000-0000-0000-0000-000000000001',
        occurredAt: new Date(),
        provider: 'x',
        service: 'api',
        operationOrModel: 'post_read',
        feature: 'trigger',
        jobRunId: null,
        researchRunId: null,
        userId: null,
        requestId: 'r',
        unitType: 'post_read',
        requestUnits: '1',
        billableUnits: '1',
        unitPrice: null,
        currency: 'USD',
        priceBookVersion: null,
        costUsd: null,
        costStatus: 'actual',
        cacheStatus: 'miss',
        metadata: {},
        supersedesCostEventId: null,
      }),
    ).toThrow(/unpriced/);
  });
});
