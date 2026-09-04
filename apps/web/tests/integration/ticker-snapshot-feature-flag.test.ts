import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { assembleTickerSnapshot } from '../../src/services/ticker/snapshot';
import { env } from '../../src/env';

const url = databaseUrl();

/**
 * F18 §4.4 DoD: "X, Stocktwits and Congress are hidden by default, not greyed." This is the
 * dedicated test for the *default* state — `tests/integration/ticker-snapshot.test.ts` (F09)
 * predates this flag and switches it on for its own duration, so it no longer exercises the
 * off-by-default behaviour on its own.
 */
describe.skipIf(url === undefined)('F18 — FEATURE_X hides the X stance frame by default', () => {
  let pool: pg.Pool;
  const originalFeatureX = env.FEATURE_X;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterEach(() => {
    env.FEATURE_X = originalFeatureX;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function insertSecurity(symbol: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency, sector, active)
       values ($1, $2, 'NYSE', 'equity', 'USD', 'Consumer', true) returning id`,
      [symbol, `${symbol} Inc.`],
    );
    return rows[0]?.id as string;
  }

  it('omits the X frame entirely — not disabled, not greyed, simply not present — when the flag is off (the default)', async () => {
    env.FEATURE_X = false;
    await insertSecurity('FLAGOFF');
    const snapshot = await assembleTickerSnapshot('FLAGOFF', { asOf: new Date('2026-09-06T00:00:00.000Z') });
    expect(snapshot.resolved).toBe(true);
    if (!snapshot.resolved) return;

    const axes = snapshot.stance.map((frame) => frame.axis).sort();
    expect(axes).toEqual(['reddit', 'substack']);
    expect(snapshot.stance.find((frame) => frame.axis === 'x')).toBeUndefined();
  });

  it('renders the X frame once the flag is explicitly enabled — proving this is a real gate, not a permanent removal', async () => {
    env.FEATURE_X = true;
    await insertSecurity('FLAGON');
    const snapshot = await assembleTickerSnapshot('FLAGON', { asOf: new Date('2026-09-06T00:00:00.000Z') });
    expect(snapshot.resolved).toBe(true);
    if (!snapshot.resolved) return;

    const axes = snapshot.stance.map((frame) => frame.axis).sort();
    expect(axes).toEqual(['reddit', 'substack', 'x']);
  });

  it('confirms the env default itself is false — the off state this whole file exercises is what a real deployment actually starts with', () => {
    expect(originalFeatureX).toBe(false);
  });
});
