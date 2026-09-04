/**
 * Reading an artifact back, and deciding whether it may ever be deleted (F05 §4.7).
 *
 * Writing is F03's `calculations.ts`, which is deliberately append-only and stays that way. This
 * module adds the two things F05 needs on top of it: the child rows an Inspector page has to
 * render, and the retention question.
 *
 * ── Why promotion to `permanent` is derived rather than stored ──────────────────────────────
 *
 * §4.7 says a claim, share grant or open issue makes an artifact `retention_class = 'permanent'`.
 * The obvious implementation is an UPDATE, and migration `0012` forbids it absolutely — *"UPDATE
 * has no exception because no legitimate process needs one"*.
 *
 * That constraint is right, and following it produces a better answer than the one it blocks. A
 * stored flag has to be set by whoever creates the reference, so it can be forgotten, and a
 * forgotten flag means an artifact somebody's claim depends on is deleted on schedule with every
 * test green. Deriving it from the references themselves cannot be forgotten: the reference *is*
 * the protection. `effectiveRetentionClass` answers the question for a reader, and the retention
 * query in `retention.ts` excludes referenced artifacts in SQL rather than filtering afterwards,
 * so a referenced artifact is never a deletion candidate in the first place.
 *
 * A `retention_class = 'permanent'` written at insert time still does what it always did — it is
 * an *additional* floor, not the only one.
 */
import { getPool, type Queryable } from './client';

/** Which issue states F05 §4.7 calls "open". Reported, though every issue protects — see below. */
const OPEN_ISSUE_STATUSES = ['new', 'triaged', 'investigating'] as const;

/**
 * ── One deviation from §4.7, and it is forced by the schema ─────────────────────────────────
 *
 * §4.7 names *"a claim, share grant or open issue"*. Implemented literally, a **revoked** share
 * grant or a **resolved** issue would stop protecting the artifact — and both rows still carry a
 * foreign key to `calculation_snapshot.id` (migration `0004`), so the retention DELETE fails on
 * the constraint rather than doing anything at all.
 *
 * So any reference protects, and the *kind* records which. That is the safer reading anyway: a
 * resolved issue is the record of a dispute about a specific number, and keeping "this was
 * wrong, and here is why" pointing at an artifact that no longer exists is worse than keeping
 * the artifact. Revocation removes visibility, not the record — the same rule §4.5 states for a
 * retracted run: *"retraction adds state; it never deletes claims, evidence links, or
 * artifacts."*
 */
export type ArtifactReference = {
  readonly kind:
    | 'claim'
    | 'share'
    | 'revoked_share'
    | 'open_issue'
    | 'resolved_issue'
    | 'issue_resolution'
    | 'validation_run'
    | 'successor_reference';
  readonly referenceId: string;
  readonly detail: string;
};

/**
 * Every live reference that makes an artifact permanent. Returned rather than reduced to a
 * boolean because the Inspector has to be able to say *why* a record is being kept.
 *
 * **Kept in sync with `retention.ts`'s `purgeArtifacts` doomed-candidate query by hand** — the
 * two are independent SQL implementations of the same policy (this one for the reader, that one
 * for the delete), not a shared function, matching the existing claim/share/issue set. Adding a
 * new kind of protecting reference means updating both.
 */
export async function referencesRequiringPermanence(
  calculationId: string,
  db: Queryable = getPool(),
): Promise<ArtifactReference[]> {
  const { rows } = await db.query<{ kind: string; reference_id: string; detail: string }>(
    `select 'claim' as kind, c.id::text as reference_id, c.claim_text as detail
       from claim_ledger c
      where $1 = any(c.metric_ids)
      union all
     select case when s.revoked_at is null then 'share' else 'revoked_share' end,
            s.id::text,
            case when s.revoked_at is null then 'a live share grant'
                 else 'a share grant, since revoked — the grant is a record that someone was shown this number' end
       from calculation_share s
      where s.source_calculation_id = $1::uuid or s.shared_snapshot_id = $1::uuid
      union all
     select case when i.status = any($2::text[]) then 'open_issue' else 'resolved_issue' end,
            i.id::text,
            i.issue_type || ': ' || i.description
       from calculation_issue i
      where i.calculation_id = $1::uuid
      union all
     -- The successor an issue was resolved by, when that successor is a different artifact
     -- from the one the issue was filed against (already covered by the branch above).
     select 'issue_resolution', i.id::text, 'the resolution of: ' || i.issue_type || ': ' || i.description
       from calculation_issue i
      where i.resolution_calculation_id = $1::uuid and i.calculation_id <> $1::uuid
      union all
     -- 0012's own comment: a validation run "has no finite retention and therefore no reason
     -- to be deletable at all" — so the artifact it validated is never a delete target either.
     select 'validation_run', v.id::text, 'replayed on ' || v.started_at::text || ', result ' || v.status
       from calculation_validation_run v
      where v.calculation_id = $1::uuid
      union all
     -- Another snapshot's official/predecessor pointer keeps this one alive; deferring its
     -- deletion to a later cycle is free, a constraint violation mid-batch is not.
     select 'successor_reference', other.id::text,
            'referenced as ' ||
              case when other.official_calculation_id = $1::uuid then 'the official version of'
                   else 'the predecessor of' end || ' calculation ' || other.id::text
       from calculation_snapshot other
      where other.id <> $1::uuid
        and (other.official_calculation_id = $1::uuid or other.predecessor_calculation_id = $1::uuid)`,
    [calculationId, [...OPEN_ISSUE_STATUSES]],
  );

  return rows.map((row) => ({
    kind: row.kind as ArtifactReference['kind'],
    referenceId: row.reference_id,
    detail: row.detail,
  }));
}

export type EffectiveRetention = {
  readonly stored: 'standard' | 'permanent';
  readonly effective: 'standard' | 'permanent';
  readonly references: readonly ArtifactReference[];
};

/**
 * The retention class that actually governs an artifact: the stored one, raised to `permanent`
 * by any live reference. This is what the Inspector reads and what retention agrees with.
 */
export async function effectiveRetentionClass(
  calculationId: string,
  db: Queryable = getPool(),
): Promise<EffectiveRetention | null> {
  const { rows } = await db.query<{ retention_class: string }>(
    'select retention_class from calculation_snapshot where id = $1',
    [calculationId],
  );
  const stored = rows[0]?.retention_class;
  if (stored === undefined) return null;

  const references = await referencesRequiringPermanence(calculationId, db);
  return {
    stored: stored as 'standard' | 'permanent',
    effective: stored === 'permanent' || references.length > 0 ? 'permanent' : 'standard',
    references,
  };
}

// ── The child rows an Inspector page renders ─────────────────────────────────────────────────

export type StoredInputRow = {
  readonly inputKey: string;
  readonly sequence: number;
  readonly normalizedValue: unknown;
  readonly dataType: string;
  readonly unit: string | null;
  readonly provider: string | null;
  readonly sourceUrl: string | null;
  readonly primarySourceRef: unknown;
  readonly rawPayloadId: string | null;
  /**
   * ISO-8601 text with a full 6-digit fraction, not a `Date` — see the query below for why.
   */
  readonly observedAt: string | null;
  readonly availableAt: string | null;
  readonly ingestedAt: string | null;
  readonly qualityStatus: string;
  readonly freshnessStatus: string;
  readonly licenseClass: string;
  readonly redactionClass: string;
  readonly valueHash: string;
};

/**
 * Formats a `timestamptz` as microsecond-precision ISO-8601 text, in SQL rather than in JS.
 *
 * `canonical.ts` fixes the canonical fraction at 6 digits and a test there asserts it "carries
 * microseconds rather than truncating" — but node-postgres parses `timestamptz` into a JS `Date`
 * by default, and `Date` has millisecond resolution. Reading these three columns the ordinary
 * way and calling `.toISOString()` would silently drop any sub-millisecond precision Postgres
 * actually stored, changing `computeInputHash`'s canonical form on every read and turning a
 * genuinely-unchanged input into a permanent, false `result_mismatch` on replay (lane-review
 * finding 6). Formatting to text before it ever becomes a JS value avoids that lossy conversion.
 */
const ISO_MICROS = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export async function findCalculationInputs(
  calculationId: string,
  db: Queryable = getPool(),
): Promise<StoredInputRow[]> {
  const { rows } = await db.query(
    `select input_key, sequence, normalized_value, data_type, unit, provider, source_url,
            primary_source_ref, raw_payload_id,
            ${ISO_MICROS('observed_at')} as observed_at,
            ${ISO_MICROS('available_at')} as available_at,
            ${ISO_MICROS('ingested_at')} as ingested_at,
            quality_status, freshness_status, license_class, redaction_class, value_hash
       from calculation_input where calculation_id = $1 order by sequence`,
    [calculationId],
  );
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      inputKey: r['input_key'] as string,
      sequence: r['sequence'] as number,
      normalizedValue: r['normalized_value'],
      dataType: r['data_type'] as string,
      unit: r['unit'] as string | null,
      provider: r['provider'] as string | null,
      sourceUrl: r['source_url'] as string | null,
      primarySourceRef: r['primary_source_ref'],
      rawPayloadId: r['raw_payload_id'] as string | null,
      observedAt: r['observed_at'] as string | null,
      availableAt: r['available_at'] as string | null,
      ingestedAt: r['ingested_at'] as string | null,
      qualityStatus: r['quality_status'] as string,
      freshnessStatus: r['freshness_status'] as string,
      licenseClass: r['license_class'] as string,
      redactionClass: r['redaction_class'] as string,
      valueHash: r['value_hash'] as string,
    };
  });
}

export type StoredStepRow = {
  readonly sequence: number;
  readonly stepKey: string;
  readonly parentStepKey: string | null;
  readonly label: string;
  readonly formulaSymbolic: string;
  readonly formulaSubstituted: string;
  readonly operands: unknown;
  readonly exactOutput: unknown;
  readonly displayOutput: unknown;
  readonly unit: string | null;
  readonly roundingRule: string | null;
  readonly status: string;
  readonly notes: unknown;
  readonly stepHash: string;
};

export async function findCalculationSteps(
  calculationId: string,
  db: Queryable = getPool(),
): Promise<StoredStepRow[]> {
  const { rows } = await db.query(
    `select sequence, step_key, parent_step_key, label, formula_symbolic, formula_substituted,
            operands, exact_output, display_output, unit, rounding_rule, status, notes, step_hash
       from calculation_step where calculation_id = $1 order by sequence`,
    [calculationId],
  );
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      sequence: r['sequence'] as number,
      stepKey: r['step_key'] as string,
      parentStepKey: r['parent_step_key'] as string | null,
      label: r['label'] as string,
      formulaSymbolic: r['formula_symbolic'] as string,
      formulaSubstituted: r['formula_substituted'] as string,
      operands: r['operands'],
      exactOutput: r['exact_output'],
      displayOutput: r['display_output'],
      unit: r['unit'] as string | null,
      roundingRule: r['rounding_rule'] as string | null,
      status: r['status'] as string,
      notes: r['notes'],
      stepHash: r['step_hash'] as string,
    };
  });
}

// ── Validation runs (§4.6) ───────────────────────────────────────────────────────────────────

export type NewValidationRun = {
  readonly calculationId: string;
  readonly requestedBy: string;
  readonly triggerType: 'user_replay' | 'scheduled_sample' | 'release_test' | 'issue_review';
  readonly methodVersion: string;
  readonly inputHashExpected: string;
  readonly inputHashActual: string;
  readonly resultHashExpected: string;
  readonly resultHashActual: string;
  readonly status: 'pass' | 'mismatch' | 'method_unavailable' | 'error';
  readonly differences: unknown;
};

/**
 * Records the outcome of a replay. `calculation_validation_run` is strictly append-only with no
 * retention exception at all — a failed validation is exactly the row somebody would want gone.
 */
export async function insertValidationRun(
  run: NewValidationRun,
  db: Queryable = getPool(),
): Promise<{ id: string; startedAt: Date }> {
  const { rows } = await db.query<{ id: string; started_at: Date }>(
    `insert into calculation_validation_run
       (calculation_id, requested_by, trigger_type, method_version,
        input_hash_expected, input_hash_actual, result_hash_expected, result_hash_actual,
        status, differences, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     returning id, started_at`,
    [
      run.calculationId,
      run.requestedBy,
      run.triggerType,
      run.methodVersion,
      run.inputHashExpected,
      run.inputHashActual,
      run.resultHashExpected,
      run.resultHashActual,
      run.status,
      JSON.stringify(run.differences),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insert into calculation_validation_run returned no row');
  return { id: row.id, startedAt: row.started_at };
}

/**
 * The audit trail for a replay (F05 §8, lane-review finding 7). `services/calculations.ts`'s
 * `runReplay` cannot write this itself — SQL belongs only in `repositories/` (F03 DoD item 9,
 * `no-sql-outside-repositories`) — so the query lives here even though the caller is the one
 * that knows the outcome.
 */
export async function insertReplayAuditEvent(
  event: {
    readonly calculationId: string;
    readonly requestedBy: string;
    readonly triggerType: string;
    readonly outcome: 'match' | 'result_mismatch' | 'method_missing';
    readonly validationRunId: string;
  },
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `insert into audit_event
       (actor_id, actor_role, action, object_type, object_id, environment, reason, result,
        request_id, correlation_id, after_value)
     values ($1, 'operator', 'replay', 'calculation_snapshot', $2, 'all', $3, $4,
             'replay', $5, $6)`,
    [
      event.requestedBy,
      event.calculationId,
      `Replay requested (${event.triggerType}).`,
      event.outcome === 'match' ? 'success' : 'failure',
      event.validationRunId,
      JSON.stringify({ outcome: event.outcome, validationRunId: event.validationRunId }),
    ],
  );
}

export type LatestValidationRun = {
  readonly id: string;
  readonly status: string;
  readonly triggerType: string;
  readonly requestedBy: string;
  readonly differences: unknown;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
};

/** §4.8 §7: the Inspector shows the last replay outcome. It never runs one to find out. */
export async function findLatestValidationRun(
  calculationId: string,
  db: Queryable = getPool(),
): Promise<LatestValidationRun | null> {
  const { rows } = await db.query(
    `select id, status, trigger_type, requested_by, differences, started_at, completed_at
       from calculation_validation_run
      where calculation_id = $1
      order by started_at desc, id desc
      limit 1`,
    [calculationId],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  return {
    id: row['id'] as string,
    status: row['status'] as string,
    triggerType: row['trigger_type'] as string,
    requestedBy: row['requested_by'] as string,
    differences: row['differences'],
    startedAt: row['started_at'] as Date,
    completedAt: row['completed_at'] as Date | null,
  };
}
