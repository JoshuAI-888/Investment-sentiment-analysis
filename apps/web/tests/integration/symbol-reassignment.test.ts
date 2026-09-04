import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';

const url = databaseUrl();

/**
 * F03 §5, feature-specific: "a symbol reassignment (same ticker, new security.id) leaves prior
 * snapshots correctly attributed".
 *
 * This is the case surrogate keys exist for, and it is not hypothetical — tickers are reused
 * after delistings and mergers. If a ticker were the key, every historical observation of the
 * old company would silently become an observation of the new one, and the attention series
 * that made this product's headline claim would be measuring two different companies.
 */
describe.skipIf(url === undefined)('a ticker is an attribute, not an identity', () => {
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

  it('keeps prior snapshots attributed to the original company', async () => {
    // The original holder of the ticker, with history.
    const { rows: first } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('ABCD', 'First Corp', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    const firstId = first[0]?.id as string;

    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, raw_hash)
       values ($1, '10.00', 'eod', 'fmp', '2024-01-01T00:00:00Z', 'h1')`,
      [firstId],
    );
    await pool.query(
      `insert into attention_snapshot
         (security_id, source, mentions, window_hours, coverage_class, provider_methodology_version, observed_at, raw_hash)
       values ($1, 'reddit', 500, 24, 'licensed_sample', 'v1', '2024-01-01T00:00:00Z', 'h1')`,
      [firstId],
    );

    // The delisting, and the reassignment. Same ticker, different company, new surrogate key.
    await pool.query(`update security set active = false, symbol = 'ABCD-OLD' where id = $1`, [firstId]);
    const { rows: second } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('ABCD', 'Second Corp', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    const secondId = second[0]?.id as string;

    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, raw_hash)
       values ($1, '80.00', 'eod', 'fmp', '2026-01-01T00:00:00Z', 'h2')`,
      [secondId],
    );

    expect(secondId).not.toBe(firstId);

    const { rows: firstHistory } = await pool.query<{ price: string }>(
      `select price from market_snapshot where security_id = $1`,
      [firstId],
    );
    expect(firstHistory.map((row) => row.price)).toEqual(['10.00']);

    const { rows: secondHistory } = await pool.query<{ price: string }>(
      `select price from market_snapshot where security_id = $1`,
      [secondId],
    );
    expect(secondHistory.map((row) => row.price)).toEqual(['80.00']);

    // And the attention history — the series that carries the product's headline claim —
    // still belongs to the company that earned it.
    const { rows: attention } = await pool.query<{ security_id: string; mentions: number }>(
      `select security_id, mentions from attention_snapshot`,
    );
    expect(attention).toHaveLength(1);
    expect(attention[0]?.security_id).toBe(firstId);
  });

  it('lets the same ticker exist on two exchanges without collision', async () => {
    await pool.query(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('DUAL', 'Dual Listed', 'NASDAQ', 'equity', 'USD')`,
    );
    await expect(
      pool.query(
        `insert into security (symbol, name, exchange, asset_type, currency)
         values ('DUAL', 'Dual Listed', 'NYSE', 'equity', 'USD')`,
      ),
    ).resolves.toBeDefined();
  });

  it('still refuses two active rows for the same ticker on one exchange', async () => {
    await pool.query(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('ONCE', 'Once Inc', 'NASDAQ', 'equity', 'USD')`,
    );
    await expect(
      pool.query(
        `insert into security (symbol, name, exchange, asset_type, currency)
         values ('ONCE', 'Twice Inc', 'NASDAQ', 'equity', 'USD')`,
      ),
    ).rejects.toThrow(/security_symbol_exchange_unique/);
  });
});
