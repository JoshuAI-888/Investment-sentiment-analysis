import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import {
  purgeExpired,
  RetentionRefused,
  RETENTION_POLICY,
  ruleFor,
} from '../../src/repositories/retention';
import {
  coverageWindowFor,
  detectGaps,
  listGaps,
  recordGap,
  recordHeartbeat,
} from '../../src/repositories/coverage';
import { recordCollectorStart } from '../../src/repositories/as-of';
import { evaluateWindow } from '../../src/calc/coverage';

const url = databaseUrl();
const HOUR = 3_600_000;

describe.skipIf(url === undefined)('F22 §4.3 — retention fails closed on the corpus', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  const permanent = RETENTION_POLICY.filter((rule) => rule.days === 'permanent').map((r) => r.table);

  it.each(permanent)('refuses to delete from %s', async (table) => {
    await expect(purgeExpired(table, new Date())).rejects.toBeInstanceOf(RetentionRefused);
  });

  it('says why, in the terms the decision was made in', async () => {
    // D-17's reasoning belongs in the error, because the person hitting it is usually trying to
    // free space and has a good local reason.
    await expect(purgeExpired('evidence_item', new Date())).rejects.toThrow(/no backfill/);
    await expect(purgeExpired('evidence_item', new Date())).rejects.toThrow(/D-17/);
  });

  it('refuses even when the corpus rows are old enough to look expired', async () => {
    await pool.query(
      `insert into evidence_item
         (evidence_type, provider, title, available_at, license_class, coverage_class, raw_hash, created_at)
       values ('news', 'marketaux', 'Ancient', '2020-01-01T00:00:00Z', 'snippet', 'sample', 'old',
               '2020-01-01T00:00:00Z')`,
    );
    await expect(purgeExpired('evidence_item', new Date())).rejects.toBeInstanceOf(RetentionRefused);

    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from evidence_item',
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('deletes expired raw payloads, which are not the corpus', async () => {
    await pool.query(
      `insert into raw_provider_payload
         (provider, operation, request_fingerprint, payload_hash, content_class,
          redaction_status, rights_status, parser_version, retention_until, created_at)
       values ('reddit', 'listing', 'fp', 'h', 'social', 'sanitized', 'internal_only', '1',
               now(), '2020-01-01T00:00:00Z')`,
    );
    const outcome = await purgeExpired('raw_provider_payload', new Date());
    expect(outcome.deleted).toBe(1);
    expect(outcome.rule.days).toBe(7);
  });

  it('never deletes an artifact marked permanent', async () => {
    // Referenced by a claim, an open issue, or a Tier D4 record. Excluded by the query rather
    // than by a later check — a post-hoc check is one somebody can forget to run.
    const config = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('test', 'active', 'o', 'r', 'c') returning id`,
    );
    for (const [hash, retention] of [
      ['standard-old', 'standard'],
      ['permanent-old', 'permanent'],
    ] as const) {
      await pool.query(
        `insert into calculation_snapshot
           (metric_key, subject_type, subject_id, scenario_type, method_key, method_version,
            config_version, input_cutoff, status, exact_result, display_result, input_hash,
            result_hash, retention_class, created_at)
         values ('m', 'security', 's', 'official', 'k', '1', $1, now(), 'complete',
                 '{}'::jsonb, '{}'::jsonb, $2, $2, $3, '2020-01-01T00:00:00Z')`,
        [config.rows[0]?.id, hash, retention],
      );
    }

    const outcome = await purgeExpired('calculation_snapshot', new Date());
    expect(outcome.deleted).toBe(1);

    const { rows } = await pool.query<{ input_hash: string }>(
      'select input_hash from calculation_snapshot',
    );
    expect(rows.map((r) => r.input_hash)).toEqual(['permanent-old']);
  });

  it('still refuses a plain DELETE on an artifact outside the retention process', async () => {
    // The exception is a door, not a removal of the wall. Ordinary code paths see no change.
    const config = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('test', 'active', 'o', 'r', 'c') returning id`,
    );
    await pool.query(
      `insert into calculation_snapshot
         (metric_key, subject_type, subject_id, scenario_type, method_key, method_version,
          config_version, input_cutoff, status, exact_result, display_result, input_hash,
          result_hash)
       values ('m', 'security', 's', 'official', 'k', '1', $1, now(), 'complete',
               '{}'::jsonb, '{}'::jsonb, 'h', 'h')`,
      [config.rows[0]?.id],
    );

    await expect(pool.query('delete from calculation_snapshot')).rejects.toThrow(
      /only inside the audited retention process/,
    );
  });

  it('forbids UPDATE on an artifact even inside the retention process', async () => {
    // There is no flag for UPDATE and no reason to want one: retention removes whole expired
    // artifacts, it does not rewrite numbers. This is the assertion that keeps the exception
    // from widening into "append-only unless you really need to".
    const config = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('test', 'active', 'o', 'r', 'c') returning id`,
    );
    await pool.query(
      `insert into calculation_snapshot
         (metric_key, subject_type, subject_id, scenario_type, method_key, method_version,
          config_version, input_cutoff, status, exact_result, display_result, input_hash,
          result_hash)
       values ('m', 'security', 's', 'official', 'k', '1', $1, now(), 'complete',
               '{}'::jsonb, '{}'::jsonb, 'h', 'h')`,
      [config.rows[0]?.id],
    );

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("set local app.retention_process = 'on'");
      await expect(
        client.query(`update calculation_snapshot set status = 'stale'`),
      ).rejects.toThrow(/UPDATE is not permitted, ever/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('writes an audit event for every purge that deletes something', async () => {
    const config = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('test', 'active', 'o', 'r', 'c') returning id`,
    );
    await pool.query(
      `insert into calculation_snapshot
         (metric_key, subject_type, subject_id, scenario_type, method_key, method_version,
          config_version, input_cutoff, status, exact_result, display_result, input_hash,
          result_hash, created_at)
       values ('m', 'security', 's', 'official', 'k', '1', $1, now(), 'complete',
               '{}'::jsonb, '{}'::jsonb, 'h', 'h', '2020-01-01T00:00:00Z')`,
      [config.rows[0]?.id],
    );

    const outcome = await purgeExpired('calculation_snapshot', new Date());
    expect(outcome.deleted).toBe(1);

    const { rows } = await pool.query<{ action: string; reason: string }>(
      `select action, reason from audit_event where object_type = 'calculation_snapshot'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('purge');
    expect(rows[0]?.reason).toContain('90 days');
  });

  it('leaves the retention flag unset for the next statement on the connection', async () => {
    // `set local` is transaction-scoped. If it were `set`, a pooled connection would carry the
    // permission to delete artifacts into whatever ran next on it.
    const config = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('test', 'active', 'o', 'r', 'c') returning id`,
    );
    await pool.query(
      `insert into calculation_snapshot
         (metric_key, subject_type, subject_id, scenario_type, method_key, method_version,
          config_version, input_cutoff, status, exact_result, display_result, input_hash,
          result_hash, created_at)
       values ('m', 'security', 's', 'official', 'k', '1', $1, now(), 'complete',
               '{}'::jsonb, '{}'::jsonb, 'h', 'h', '2020-01-01T00:00:00Z')`,
      [config.rows[0]?.id],
    );
    await purgeExpired('calculation_snapshot', new Date());

    await pool.query(
      `insert into calculation_snapshot
         (metric_key, subject_type, subject_id, scenario_type, method_key, method_version,
          config_version, input_cutoff, status, exact_result, display_result, input_hash,
          result_hash)
       values ('m2', 'security', 's', 'official', 'k', '1', $1, now(), 'complete',
               '{}'::jsonb, '{}'::jsonb, 'h2', 'h2')`,
      [config.rows[0]?.id],
    );

    await expect(pool.query('delete from calculation_snapshot')).rejects.toThrow(
      /only inside the audited retention process/,
    );
  });

  it('refuses a table with no rule rather than guessing', async () => {
    await expect(purgeExpired('security', new Date())).rejects.toThrow(/No retention rule/);
    expect(ruleFor('security')).toBeUndefined();
  });
});

describe.skipIf(url === undefined)('F22 §4.4 — coverage gaps', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    await recordCollectorStart('reddit', new Date('2026-09-01T00:00:00Z'), 'first item');
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  it('detects a gap between heartbeats beyond the threshold', async () => {
    await recordHeartbeat('reddit', new Date('2026-09-01T00:00:00Z'), 12);
    await recordHeartbeat('reddit', new Date('2026-09-01T01:00:00Z'), 8);
    await recordHeartbeat('reddit', new Date('2026-09-03T00:00:00Z'), 5);

    const gaps = await detectGaps('reddit', 2 * HOUR);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.from.toISOString()).toBe('2026-09-01T01:00:00.000Z');
    expect(gaps[0]?.permanent).toBe(true);
  });

  it('does not manufacture a gap from a quiet window', async () => {
    // items_seen = 0 with a heartbeat present means the collector ran and there was nothing to
    // see. Treating that as a gap produces one on every quiet weekend and buries the real ones.
    await recordHeartbeat('reddit', new Date('2026-09-01T00:00:00Z'), 0);
    await recordHeartbeat('reddit', new Date('2026-09-01T01:00:00Z'), 0);

    expect(await detectGaps('reddit', 2 * HOUR)).toEqual([]);
  });

  it('is idempotent — re-running the detector writes nothing new', async () => {
    await recordHeartbeat('reddit', new Date('2026-09-01T00:00:00Z'), 1);
    await recordHeartbeat('reddit', new Date('2026-09-05T00:00:00Z'), 1);

    await detectGaps('reddit', 2 * HOUR);
    await detectGaps('reddit', 2 * HOUR);
    await detectGaps('reddit', 2 * HOUR);

    expect(await listGaps('reddit')).toHaveLength(1);
  });

  it('records a budget-denied window as a gap, not a shortened sample', async () => {
    // F16 §4.1b: a window that would breach an X ceiling is refused and recorded as a coverage
    // gap, never truncated. A shortened window is a sample nobody can describe.
    await recordGap({
      axis: 'x',
      from: new Date('2026-11-20T14:00:00Z'),
      to: new Date('2026-11-20T15:00:00Z'),
      reason: 'budget_denied',
    });

    const gaps = await listGaps('x');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.reason).toBe('budget_denied');
  });

  it('rejects an edit to a recorded gap', async () => {
    await recordGap({
      axis: 'reddit',
      from: new Date('2026-09-02T00:00:00Z'),
      to: new Date('2026-09-03T00:00:00Z'),
      reason: 'collector_down',
    });
    await expect(
      pool.query(`update coverage_gap set reason = 'unknown'`),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('delete from coverage_gap')).rejects.toThrow(/append-only/);
  });

  it('rejects a gap that ends before it begins', async () => {
    await expect(
      pool.query(
        `insert into coverage_gap (axis, gap_from, gap_to, reason)
         values ('reddit', '2026-09-05T00:00:00Z', '2026-09-01T00:00:00Z', 'unknown')`,
      ),
    ).rejects.toThrow(/coverage_gap_ordered_check/);
  });

  it('assembles a coverage window a metric can be evaluated against', async () => {
    await recordHeartbeat('reddit', new Date('2026-09-01T00:00:00Z'), 3);
    await recordHeartbeat('reddit', new Date('2026-09-10T00:00:00Z'), 3);
    await detectGaps('reddit', 2 * HOUR);

    const window = await coverageWindowFor('reddit');
    expect(window).not.toBeNull();
    if (window === null) return;

    expect(window.startedAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(window.gaps).toHaveLength(1);

    const verdict = evaluateWindow(
      window,
      new Date('2026-09-02T00:00:00Z'),
      new Date('2026-09-08T00:00:00Z'),
    );
    expect(verdict.eligibility).toBe('overlaps_gap');
  });

  it('returns no window for an axis that never started', async () => {
    expect(await coverageWindowFor('substack')).toBeNull();
  });
});
