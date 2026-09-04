/**
 * Retention (F22 §4.3, D-17). **The delete path fails closed on the social corpus.**
 *
 * D-17 superseded the original 90-day rolling delete for social data, and the reason is worth
 * restating where the code is: under forward-only collection a rolling delete means the corpus
 * never exceeds 90 days, so D-09's promotion path — which needs roughly a year — can never run.
 * The old policy would have destroyed the asset one day at a time **while every test stayed
 * green**, because deleting rows on schedule is exactly what it was written to do.
 *
 * So the guard here is not a check on the way to deleting. It is a refusal.
 */
import { getPool, withTransaction, type Queryable } from './client';

export type RetentionClass = 'permanent_corpus' | 'artifacts' | 'raw_payloads' | 'operational';

export type RetentionRule = {
  readonly table: string;
  readonly retentionClass: RetentionClass;
  readonly days: number | 'permanent';
  readonly why: string;
};

/** Every table F22 §4.3's table governs, with the class that decides whether it can be deleted. */
export const RETENTION_POLICY: readonly RetentionRule[] = [
  {
    table: 'evidence_item',
    retentionClass: 'permanent_corpus',
    days: 'permanent',
    why: 'The normalized social corpus. §6.8: it is the asset, not retained data. Full bodies for Reddit and Substack; for X, the bounded snippet that is its canonical scoring unit.',
  },
  {
    table: 'sentiment_snapshot',
    retentionClass: 'permanent_corpus',
    days: 'permanent',
    why: 'Derived scores over the corpus. Deleting these makes the corpus unre-evaluable, which is the same loss one step removed.',
  },
  {
    table: 'attention_snapshot',
    retentionClass: 'permanent_corpus',
    days: 'permanent',
    why: 'The attention series is what D-30 selected the universe on and what F08 renders. It is a backtest input.',
  },
  {
    table: 'market_snapshot',
    retentionClass: 'permanent_corpus',
    days: 'permanent',
    why: 'Market and price series are permanent — they are the return side of every Tier D4 evaluation.',
  },
  {
    table: 'price_return_snapshot',
    retentionClass: 'permanent_corpus',
    days: 'permanent',
    why: 'As above.',
  },
  {
    table: 'raw_provider_payload',
    retentionClass: 'raw_payloads',
    days: 7,
    why: 'Raw sanitized payloads: 7 days, or 0 where rights forbid retention at all. The normalized facts, hashes and formulas survive; a tombstone explains why the raw view is gone.',
  },
  {
    table: 'calculation_snapshot',
    retentionClass: 'artifacts',
    days: 90,
    why: 'Artifacts are 90 days EXCEPT those referenced by a claim, a live share grant, an open issue, or a Tier D4 record. Those are permanent either because retention_class says so or because the reference itself says so, and both are excluded by the query rather than by a later check.',
  },
  {
    table: 'provider_call_log',
    retentionClass: 'operational',
    days: 90,
    why: 'Operational telemetry. Losing it costs a debugging session, not a corpus.',
  },
  {
    table: 'collector_heartbeat',
    retentionClass: 'operational',
    days: 400,
    why: 'Kept longer than other operational data because gap detection reads it, and a gap that can no longer be derived is a gap that silently stops existing.',
  },
];

export class RetentionRefused extends Error {
  constructor(
    readonly table: string,
    readonly why: string,
  ) {
    super(
      `Retention refused to delete from ${table}. It is permanent-corpus data (F22 §4.3, D-17): ${why}\n` +
        'Under D-16 there is no backfill, so this deletion would be unrecoverable. If it is genuinely required, it is a decision with a MEMORY.md entry, not a job.',
    );
    this.name = 'RetentionRefused';
  }
}

export function ruleFor(table: string): RetentionRule | undefined {
  return RETENTION_POLICY.find((rule) => rule.table === table);
}

/**
 * The only delete path. It refuses before it computes a cutoff, before it counts rows, and
 * before it opens a transaction — a refusal that happens after any of those invites someone to
 * reach past it.
 */
export async function purgeExpired(
  table: string,
  now: Date,
  db: Queryable = getPool(),
): Promise<{ deleted: number; rule: RetentionRule }> {
  const rule = ruleFor(table);
  if (rule === undefined) {
    throw new Error(
      `No retention rule for ${table}. A table with no rule is not deleted from — add it to RETENTION_POLICY with a reason, deliberately.`,
    );
  }

  if (rule.days === 'permanent') throw new RetentionRefused(table, rule.why);

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - rule.days);

  if (table === 'calculation_snapshot') return purgeArtifacts(cutoff, rule);

  const { rowCount } = await db.query(`delete from ${table} where created_at < $1`, [cutoff]);
  return { deleted: rowCount ?? 0, rule };
}

/**
 * Artifacts are append-only, and DELETE reaches past that trigger only inside the audited
 * retention process source §7.2 names (migration 0012). This is that process, and everything
 * about it is deliberate:
 *
 * - `set local` scopes the flag to **this transaction**. A rollback un-sets it; nothing leaks
 *   to the next statement on a pooled connection.
 * - The `audit_event` is written in the **same** transaction, so an audited deletion is the
 *   only kind that commits.
 * - `retention_class = 'permanent'` is excluded by the query, not filtered afterwards. Anything
 *   a claim, an open issue or a Tier D4 record references is never a candidate in the first
 *   place, and a post-hoc check is one somebody can forget to run.
 * - **F05 §4.7:** the reference itself protects the artifact, not a flag somebody remembered to
 *   set. Migration `0012` forbids UPDATE on `calculation_snapshot` absolutely, so promotion to
 *   `permanent` cannot be a column write anyway — and deriving it is the better answer, because
 *   a flag that has to be set can be forgotten, and a forgotten flag deletes the artifact
 *   somebody's claim rests on with every test still green. See `repositories/artifacts.ts`.
 * - **Any** share grant or issue protects, not only a live grant or an open issue. §4.7 says
 *   "open issue", but a resolved issue and a revoked grant both still hold a foreign key to the
 *   snapshot, so the narrow reading does not delete the artifact — it fails on the constraint.
 *   The reason that is the right answer rather than a workaround is written out in
 *   `repositories/artifacts.ts`.
 * - **A validation run protects the artifact it validated, permanently.** `0012`'s own comment
 *   says `calculation_validation_run` "has no finite retention and therefore no reason to be
 *   deletable at all" — so it is never a delete target, and by the same reasoning it belongs in
 *   the protected-reference set rather than being deleted alongside step/input. Without this, a
 *   replayed artifact reaching its 90-day cutoff aborts the *entire* purge batch on the FK
 *   constraint, not just that one row (lane-review finding 2).
 * - **A snapshot's own self-references protect it too.** `official_calculation_id` and
 *   `predecessor_calculation_id` point from one `calculation_snapshot` row to another. A row
 *   excluded here for that reason is simply picked up on a later cycle once whatever points at
 *   it is gone — deferring a delete is free; a batch-aborting constraint violation is not.
 * - `calculation_issue.resolution_calculation_id` is checked in addition to `calculation_id`:
 *   an issue can be filed against one snapshot and resolved by producing a different, successor
 *   snapshot, and the successor needs protecting too, not just the one the issue was filed on.
 */
async function purgeArtifacts(
  cutoff: Date,
  rule: RetentionRule,
): Promise<{ deleted: number; rule: RetentionRule }> {
  return withTransaction(async (tx) => {
    await tx.query("set local app.retention_process = 'on'");

    const { rows: doomed } = await tx.query<{ id: string }>(
      `select s.id from calculation_snapshot s
        where s.created_at < $1
          and s.retention_class <> 'permanent'
          and not exists (
            select 1 from claim_ledger c where s.id::text = any(c.metric_ids)
          )
          and not exists (
            select 1 from calculation_share g
             where g.source_calculation_id = s.id or g.shared_snapshot_id = s.id
          )
          and not exists (
            select 1 from calculation_issue i
             where i.calculation_id = s.id or i.resolution_calculation_id = s.id
          )
          and not exists (
            select 1 from calculation_validation_run v where v.calculation_id = s.id
          )
          and not exists (
            select 1 from calculation_snapshot other
             where other.id <> s.id
               and (other.official_calculation_id = s.id or other.predecessor_calculation_id = s.id)
          )`,
      [cutoff],
    );

    if (doomed.length === 0) return { deleted: 0, rule };
    const ids = doomed.map((row) => row.id);

    // Children first: they carry the foreign key, and a snapshot deleted out from under its
    // inputs would leave rows nothing can reach and nothing can explain.
    await tx.query('delete from calculation_step where calculation_id = any($1)', [ids]);
    await tx.query('delete from calculation_input where calculation_id = any($1)', [ids]);
    const { rowCount } = await tx.query(
      'delete from calculation_snapshot where id = any($1)',
      [ids],
    );

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason, result,
          request_id, correlation_id, after_value)
       values ('retention', 'system', 'purge', 'calculation_snapshot', $1, 'all', $2,
               'success', 'retention', 'retention', $3)`,
      [
        `${ids.length} artifacts`,
        `Retention: ${rule.days} days, cutoff ${cutoff.toISOString()}. ${rule.why}`,
        JSON.stringify({ deleted: ids.length, cutoff: cutoff.toISOString() }),
      ],
    );

    return { deleted: rowCount ?? 0, rule };
  });
}
