/**
 * `job_definition` and `job_run` (migration `0007`, F16 §4.1/§4.1b/§4.5, ADR-013). SQL lives
 * here and nowhere else (F03 DoD item 9).
 *
 * Built as a standalone cross-lane gap-fill, the same pattern as `attention_snapshot`'s
 * repository (`MEMORY.md` B-27) and the market/evidence/sentiment repositories (B-29): the
 * tables and their zod contracts already existed, but F16a (COLLECT)'s dispatch core needs
 * repository functions over them that only SPINE can write (`src/repositories/` is SPINE-owned,
 * `02-ARCHITECTURE-CONTRACTS.md` §3/§4).
 *
 * ## Neither table is append-only, and neither is bitemporal
 *
 * `migrations/0009_append_only.sql` enumerates exactly which tables reject UPDATE/DELETE at the
 * database level; `job_definition` and `job_run` are not in that list (checked directly — the
 * eight strictly append-only tables and the two lifecycle-only ones are all named there, and
 * neither of these two appears). That is a deliberate design choice this repository leans on
 * rather than works around: F16 §4.1 needs a job's schedule to advance (`next_due_at`) and a
 * run's status to transition (`queued` → `running` → a terminal state) as ordinary mutations,
 * not as successor rows — unlike every other table this codebase's repositories have built so
 * far. Likewise, neither table is in `contracts/bitemporal.ts`, so `no-unbounded-pit-read` does
 * not gate reads here and there is no `asOf`-bounded read to write — a job's current schedule
 * and a run's current status are live operational state, not a point-in-time fact series.
 *
 * ## Idempotency: `job_run.idempotency_key`'s own `unique` constraint is the mechanism (B-29-style
 * judgment call, but simpler than any of the three patterns recorded there)
 *
 * Migration `0007`'s own comment on `job_run.idempotency_key` states the intent directly: "the
 * UNIQUE constraint is what makes that true under concurrency rather than under review." Unlike
 * `attention_snapshot`/`market_snapshot` (raw-hash-based, no true concurrent-race guarantee) or
 * `evidence_item` (no guarantee at all), `job_run` already carries a real `unique` column built
 * for exactly this purpose, so `claimJobRun` below uses a real `on conflict (idempotency_key) do
 * nothing` — the same "database's own uniqueness is the correct and simplest idempotency check"
 * reasoning `market.ts` already applies to `price_return_snapshot` (B-29). A re-delivery of the
 * same `(job_id, due_at)` — F16a derives the key, not this module — finds the row already
 * claimed and reads it back rather than throwing or double-inserting; the caller (`JobService`)
 * uses the returned `claimed: false` to skip execution entirely, which is what stops a duplicate
 * delivery from costing a provider call or a cost-event twice (the same failure shape B-16 names
 * for a different repository: an operation that silently runs — or silently doesn't skip — a
 * second time is invisible on most providers and expensive on the one it isn't).
 *
 * ## Status transitions tolerate a re-entrant call, but not a genuine conflict
 *
 * `startJobRun` and `finishJobRun` are conditional updates (`where status = 'queued'` /
 * `where status in ('queued', 'running')`). A crash between `claimJobRun` succeeding and
 * `startJobRun`/`finishJobRun` being called is real and recoverable under this dispatcher's own
 * design (F16 §4.1 step 7: "Locks are released on every exit path... An expired lock must not
 * strand a job forever") — a later delivery re-enters the same code path against the same
 * `job_run` row it already partly progressed. So a re-entrant call that finds the row **already
 * in the state it was trying to reach** (already `running` for `startJobRun`; already terminal
 * with the *same* status for `finishJobRun`) returns the existing row rather than throwing —
 * this is the retry case, not an error. A call that finds the row in a genuinely incompatible
 * state (already terminal for `startJobRun`; terminal with a *different* status for
 * `finishJobRun`) throws, because that is not a duplicate delivery — it is two different,
 * incompatible claims about how the same run ended, and papering over that would hide a real
 * defect in whatever called this twice.
 */
import {
  jobDefinition,
  jobRun,
  type JobDefinition,
  type JobRun,
} from '../contracts/operations';
import { camelizeRow, insertClause, snakeizeRow, type Row } from './rows';
import { getPool, type Queryable } from './client';

// ── job_definition ──────────────────────────────────────────────────────────────────────────

/**
 * `contracts/operations.ts`'s `jobDefinition` schema does not model `created_at`, even though
 * migration `0007` has the column (the same kind of schema/contract gap `market.ts` reports for
 * `price_return_snapshot`'s horizon set and `evidence.ts` for `dedupeKey`). Not selected here —
 * see this feature's `CONTRACTS` report line rather than silently widening the contract.
 */
const JOB_DEFINITION_COLUMNS =
  'id, job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone, ' +
  'active_windows, jitter_seconds, scope, priority, max_runtime_seconds, concurrency_policy, ' +
  'max_attempts, backoff_policy, dependencies, max_calls_per_run, max_cost_usd_per_run, ' +
  'trigger_eligible, next_due_at, config_version, version, updated_by, updated_at';

const DEFAULT_DUE_JOB_LIMIT = 100;

export type DueJobDefinitions = {
  readonly jobs: readonly JobDefinition[];
  /**
   * **Post-review finding 8.** `true` when at least one more due `job_definition` row exists
   * past `jobs` — the query below fetches `limit + 1` rows and this is set when that extra row
   * is present. Without it, a caller processing a fixed-size page per dispatch tick cannot tell
   * "exactly 100 jobs were due this tick" from "at least 100 were due, and more are waiting" —
   * and because the read is ordered by `priority asc`, the jobs a truncated page silently drops
   * are always the *lowest*-priority due jobs, every single tick, which starve indefinitely
   * rather than merely running a tick late. `JobService` (F16a) is the one with the standing to
   * decide what to do about it (log, alert, tighten the schedule) — this read only supplies the
   * fact.
   */
  readonly truncated: boolean;
};

/**
 * F16 §4.1 step 3: "Select due `job_definition` rows." `enabled` and `next_due_at <= asOfInstant`
 * are the only predicates — everything else (active window checks, jitter, dependency checks) is
 * dispatch policy that belongs in `JobService` (F16a), not in this read. Ordered by `priority`
 * first (migration `0007`'s own column, lower value first, matching the DB default of `100`)
 * so a caller processing the returned list in order gets the priority ordering for free.
 */
export async function dueJobDefinitions(
  asOfInstant: Date,
  db: Queryable = getPool(),
  limit: number = DEFAULT_DUE_JOB_LIMIT,
): Promise<DueJobDefinitions> {
  const { rows } = await db.query(
    `select ${JOB_DEFINITION_COLUMNS} from job_definition
      where enabled = true and next_due_at <= $1
      order by priority asc, next_due_at asc
      limit $2`,
    [asOfInstant, limit + 1],
  );
  const truncated = rows.length > limit;
  const pageRows = truncated ? rows.slice(0, limit) : rows;
  return {
    jobs: pageRows.map((row) => jobDefinition.parse(camelizeRow(row as Row))),
    truncated,
  };
}

/** `job_key` is the human-referenced identity throughout F16 ("a job registered here"). */
export async function findJobDefinitionByKey(
  jobKey: string,
  db: Queryable = getPool(),
): Promise<JobDefinition | null> {
  const { rows } = await db.query(
    `select ${JOB_DEFINITION_COLUMNS} from job_definition where job_key = $1`,
    [jobKey],
  );
  const row = rows[0] as Row | undefined;
  return row === undefined ? null : jobDefinition.parse(camelizeRow(row));
}

/**
 * F16 §4.1b / D-15: "The trigger may never dispatch a job that was not registered as
 * trigger-eligible. The eligible set is a seeded column, not a runtime decision." Enforced here,
 * at the data layer, rather than left to every caller to remember to check `triggerEligible`
 * itself after a plain `findJobDefinitionByKey` — the same reasoning `attention.ts`'s
 * `countComparableAttentionSnapshots` gives for being a thin wrapper rather than a second,
 * independently-drifting query (B-27): a job that exists but is not eligible, and a job that
 * does not exist at all, must be indistinguishable to the trigger path, and a wrapper is what
 * guarantees the two callers of "is this dispatchable by a trigger" cannot answer it differently.
 */
export async function findTriggerEligibleJobDefinition(
  jobKey: string,
  db: Queryable = getPool(),
): Promise<JobDefinition | null> {
  const { rows } = await db.query(
    `select ${JOB_DEFINITION_COLUMNS} from job_definition
      where job_key = $1 and enabled = true and trigger_eligible = true`,
    [jobKey],
  );
  const row = rows[0] as Row | undefined;
  return row === undefined ? null : jobDefinition.parse(camelizeRow(row));
}

/**
 * F16 §4.1 step 6: "Record outcome, duration, cost, and the next run." Computing the next due
 * instant from `schedule_type`/`schedule_expression` (interval or cron, DST-aware per the
 * feature's own test plan) is dispatch logic that belongs in `JobService` (F16a) — this function
 * only writes the value it is given. `version` is incremented and `updated_by`/`updated_at` are
 * stamped for the same audit reason `versions.ts` stamps `activateConfigVersion`'s trail, even
 * though this is a plain UPDATE rather than an activation transaction — there is exactly one
 * writer of `next_due_at` in Wave 1 (the dispatcher itself; F16 §0 ships no admin UI), so there
 * is no concurrent-editor race to arbitrate with `version` yet. It exists so one exists when
 * Wave 4 adds a second writer, rather than being retrofitted then.
 */
export async function advanceJobDefinitionSchedule(
  jobId: string,
  nextDueAt: Date,
  updatedBy: string,
  db: Queryable = getPool(),
): Promise<JobDefinition> {
  const { rows } = await db.query(
    `update job_definition
        set next_due_at = $2, version = version + 1, updated_by = $3, updated_at = now()
      where id = $1
      returning ${JOB_DEFINITION_COLUMNS}`,
    [jobId, nextDueAt, updatedBy],
  );
  const updated = rows[0] as Row | undefined;
  if (updated === undefined) {
    throw new Error(`job_definition ${jobId} does not exist and cannot be advanced`);
  }
  return jobDefinition.parse(camelizeRow(updated));
}

// ── job_run ──────────────────────────────────────────────────────────────────────────────────

/** Same schema/contract gap as `job_definition` above — `created_at` exists, the contract omits it. */
const JOB_RUN_COLUMNS =
  'id, job_id, trigger_type, idempotency_key, config_version, universe_version, status, ' +
  'attempt, dry_run, requested_by, request_reason, lock_key, started_at, completed_at, ' +
  'data_as_of, items_read, items_written, provider_calls, estimated_cost_usd, unpriced_units, ' +
  'error, metrics';

/**
 * A `jsonb` parameter, handled the way `evidence.ts` handles `metadata`: `JSON.stringify` a real
 * value, but pass `null`/`undefined` through unchanged. The distinction matters for `error`,
 * which is a genuinely nullable column (`job_run.error jsonb null`, migration `0007`) — passing
 * `JSON.stringify(null)` would store the *JSON scalar* `null` (a non-null jsonb value, and
 * `error is null` would then be false for that row), where the intent of "no error" is a real
 * SQL `NULL`. `undefined` is left alone too so `insertClause`'s own `undefined`-filtering (which
 * lets the column's DB default apply) still works on the transformed value.
 */
function jsonParam(value: unknown): unknown {
  return value === undefined || value === null ? value : JSON.stringify(value);
}

/**
 * Everything `claimJobRun` needs beyond what the database defaults (`attempt` = 1, `dry_run` =
 * false, the three counters = 0, `unpriced_units`/`metrics` = `{}`). `status` is deliberately not
 * a field here — a claim always enters as `'queued'` (see `claimJobRun`); a caller wanting a
 * different initial status is describing a different operation, not a variant of a claim.
 */
export type NewJobRun = {
  readonly jobId: string;
  readonly triggerType: JobRun['triggerType'];
  /** F16 §4.1 step 4: derived from `(job_id, due_at)` by the caller — this module only enforces it. */
  readonly idempotencyKey: string;
  readonly configVersion: string;
  readonly universeVersion?: string | null;
  readonly attempt?: number;
  readonly dryRun?: boolean;
  readonly requestedBy?: string | null;
  readonly requestReason?: string | null;
  readonly lockKey: string;
  readonly itemsRead?: number;
  readonly itemsWritten?: number;
  readonly providerCalls?: number;
  readonly estimatedCostUsd?: string;
  readonly unpricedUnits?: unknown;
  readonly metrics?: unknown;
};

export type JobRunClaim = {
  readonly run: JobRun;
  /**
   * `false` when a row with this exact `idempotencyKey` already existed — a re-delivery of the
   * same `(job_id, due_at)` (F16 §4.1 step 4) or a genuinely concurrent double-dispatch, both of
   * which the `unique` constraint on `idempotency_key` already serializes. The caller must treat
   * `false` as "do not execute again," the same way a cache hit must hand back its quota
   * reservation (`MEMORY.md` B-16) rather than silently letting the call proceed a second time.
   */
  readonly claimed: boolean;
};

/**
 * Claims one job run. A real `on conflict (idempotency_key) do nothing` — see the module
 * docstring for why this table, unlike every prior idempotent-write repository in this codebase,
 * gets to use the simplest of the three patterns B-29 records: `job_run.idempotency_key` already
 * has a database-level `unique` constraint built for exactly this purpose, so there is no
 * `where not exists` + `23505`-catch needed and no window where a true concurrent race escapes
 * the guarantee.
 */
export async function claimJobRun(
  input: NewJobRun,
  db: Queryable = getPool(),
): Promise<JobRunClaim> {
  // `insertClause` snakeizes keys and drops `undefined` values itself (`rows.ts`), the same way
  // `versions.ts`'s `insertConfigVersion` builds its own insert — so a field left unset here
  // (e.g. `attempt`) takes the column's own DB default rather than an explicit value.
  const { columns, placeholders, values } = insertClause({
    jobId: input.jobId,
    triggerType: input.triggerType,
    idempotencyKey: input.idempotencyKey,
    configVersion: input.configVersion,
    universeVersion: input.universeVersion,
    status: 'queued',
    attempt: input.attempt,
    dryRun: input.dryRun,
    requestedBy: input.requestedBy,
    requestReason: input.requestReason,
    lockKey: input.lockKey,
    itemsRead: input.itemsRead,
    itemsWritten: input.itemsWritten,
    providerCalls: input.providerCalls,
    estimatedCostUsd: input.estimatedCostUsd,
    unpricedUnits: jsonParam(input.unpricedUnits),
    metrics: jsonParam(input.metrics),
  });

  const { rows } = await db.query(
    `insert into job_run (${columns}) values (${placeholders})
     on conflict (idempotency_key) do nothing
     returning ${JOB_RUN_COLUMNS}`,
    values,
  );

  const inserted = rows[0] as Row | undefined;
  if (inserted !== undefined) {
    return { run: jobRun.parse(camelizeRow(inserted)), claimed: true };
  }

  const { rows: existingRows } = await db.query(
    `select ${JOB_RUN_COLUMNS} from job_run where idempotency_key = $1`,
    [input.idempotencyKey],
  );
  const existing = existingRows[0] as Row | undefined;
  if (existing === undefined) {
    throw new Error(
      `job_run claim on idempotency_key ${input.idempotencyKey} reported a conflict but the row could not be read back`,
    );
  }
  const existingRun = jobRun.parse(camelizeRow(existing));
  // Post-review finding 4: the module doc states plainly that F16a derives the idempotency key,
  // not this module — this module only enforces it. Enforcing it means checking what it was
  // actually built to guarantee: that a re-delivery of the same (job_id, due_at) is a no-op, not
  // merely that *some* row already holds this exact key string. If the key's own derivation ever
  // lost the job_id component (every job shares the same five-minute tick, so deriving from
  // due_at alone is a plausible future mistake), two different jobs whose due instants collide
  // would silently share a "claim" — the second job's caller is correctly told to skip execution
  // per this function's own contract, and that job's collector then never runs, with no error and
  // no log. Under D-16 a collector that silently does not run is permanent, unrecoverable corpus
  // loss. Converting that into a loud failure here is the one-line guard the prior version of
  // this function lacked.
  if (existingRun.jobId !== input.jobId) {
    throw new Error(
      `idempotency_key ${input.idempotencyKey} is already claimed by job_run ${existingRun.id} ` +
        `for job ${existingRun.jobId}, not the requested job ${input.jobId} — the idempotency ` +
        'key collides across two different jobs, which should be impossible if it is genuinely ' +
        'derived from (job_id, due_at)',
    );
  }
  return { run: existingRun, claimed: false };
}

export async function findJobRunById(
  id: string,
  db: Queryable = getPool(),
): Promise<JobRun | null> {
  const { rows } = await db.query(`select ${JOB_RUN_COLUMNS} from job_run where id = $1`, [id]);
  const row = rows[0] as Row | undefined;
  return row === undefined ? null : jobRun.parse(camelizeRow(row));
}

export type JobRunStart = {
  readonly run: JobRun;
  /**
   * `false` when this call did not perform the `queued` → `running` transition itself — the row
   * was already `running` when this call arrived. **Post-review finding 1.** Reproduced directly
   * against Postgres 16: under READ COMMITTED, two genuinely concurrent callers racing this same
   * UPDATE do not both match zero rows and both fall through to "already running, return it" by
   * luck — the loser's `where id = $1 and status = 'queued'` blocks on the winner's uncommitted
   * update, then re-evaluates against the now-committed row via EvalPlanQual and matches zero
   * rows, landing in the exact same fallback branch a genuine crash-recovery retry would. Without
   * this flag, both callers received an identical, successful-looking `JobRun` with no way to
   * tell which of them actually won the race. F16 §4.1 step 7 names the scenario this matters
   * for: an expired Redis lock can admit a second dispatcher while the first is still executing —
   * dispatcher two must be able to tell "someone else already has this" (`started: false`) from
   * "I just claimed it" (`started: true`), the same distinction `claimJobRun`'s own `claimed`
   * flag already gives the claim step, now given to the start step too.
   */
  readonly started: boolean;
};

/**
 * `queued` → `running`. Tolerant of a re-entrant call that finds the row already `running` (see
 * the module docstring) — anything else incompatible (already terminal) throws, because that is
 * a genuine state-machine violation, not a retried delivery.
 */
export async function startJobRun(
  id: string,
  startedAt: Date,
  db: Queryable = getPool(),
): Promise<JobRunStart> {
  const { rows } = await db.query(
    `update job_run set status = 'running', started_at = $2
      where id = $1 and status = 'queued'
      returning ${JOB_RUN_COLUMNS}`,
    [id, startedAt],
  );
  const started = rows[0] as Row | undefined;
  if (started !== undefined) return { run: jobRun.parse(camelizeRow(started)), started: true };

  const existing = await findJobRunById(id, db);
  if (existing === null) {
    throw new Error(`job_run ${id} does not exist and cannot be started`);
  }
  if (existing.status === 'running') {
    return { run: existing, started: false };
  }
  throw new Error(
    `job_run ${id} is '${existing.status}', not 'queued' — cannot start a run that is not queued`,
  );
}

const TERMINAL_STATUSES = ['succeeded', 'degraded', 'failed', 'cancelled', 'skipped'] as const;
export type TerminalJobRunStatus = (typeof TERMINAL_STATUSES)[number];

export type JobRunOutcome = {
  readonly status: TerminalJobRunStatus;
  readonly completedAt: Date;
  readonly itemsRead?: number;
  readonly itemsWritten?: number;
  readonly providerCalls?: number;
  readonly estimatedCostUsd?: string;
  readonly unpricedUnits?: unknown;
  /** `null` explicitly clears/records no error; `undefined` leaves the column at its DB default. */
  readonly error?: unknown | null;
  readonly metrics?: unknown;
  readonly dataAsOf?: Date | null;
};

/**
 * A `JSON.stringify` with object keys sorted at every level, recursively. Postgres's `jsonb` type
 * does not preserve insertion order — it round-trips an object in its own canonical key order
 * (length, then bytewise) — so a plain `JSON.stringify(a) === JSON.stringify(b)` comparing a
 * caller's just-built object against a value read back from `jsonb` is comparing two different
 * serializations of the same data and reporting them as different. **Post-review finding 2
 * (round 2).** Confirmed directly against Postgres 16: `{latencyMs, itemsSkipped, a}` as written
 * comes back as `{a, latencyMs, itemsSkipped}`.
 *
 * **Post-review finding 1 (round 3): the value is first round-tripped through
 * `JSON.parse(JSON.stringify(...))` before comparison, matching exactly what `jsonParam` (this
 * repository's own write path) actually persists.** Without that round-trip, a caller's in-memory
 * object could still disagree with the row's stored value in ways `jsonb` itself never
 * distinguishes: `JSON.stringify` drops a property whose value is `undefined` and calls
 * `toJSON()` on a `Date` (serializing it to an ISO string), but comparing the *raw* in-memory
 * object directly saw the `undefined` key and the live `Date` instance — reporting a
 * byte-identical retry as a conflict for `{code, message, provider: undefined}` or
 * `{windowEnd: new Date(...)}`, confirmed directly against Postgres 16. `JobRunOutcome.metrics`/
 * `error`/`unpricedUnits` are typed `unknown`, so nothing at the type level prevents either shape.
 */
function canonicalJsonString(value: unknown): string {
  const normalized: unknown = value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
  return canonicalize(normalized);
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * `null`/`undefined`-normalizing structural equality for the `jsonb` fields (`error`, `metrics`,
 * `unpricedUnits`) — the DB round-trip can hand back `null` for a column the caller never set,
 * so a plain `===` would treat "the caller didn't mention it" and "the caller explicitly cleared
 * it" as different, which is not the distinction `finishJobRun`'s conflict check needs. Compares
 * via `canonicalJsonString` rather than a bare `JSON.stringify`, for the reason documented there.
 */
function jsonFieldsMatch(a: unknown, b: unknown): boolean {
  return canonicalJsonString(a ?? null) === canonicalJsonString(b ?? null);
}

/**
 * Decimal-string equality for `estimatedCostUsd` (a `numeric` column, `contracts/primitives.ts`'s
 * `decimalString`) that is insensitive to trailing zeros in the fractional part. **Post-review
 * finding 2 (round 2).** Postgres's `numeric` type preserves scale on the way in, but a caller's
 * in-memory string and the value read back from the database are not guaranteed to have been
 * written with the same number of trailing zeros (`'0.015'` vs `'0.0150'`) — both denote the
 * identical amount, and comparing them with `!==` reported a genuinely identical retry as a
 * conflict. `repositories/` may only import `contracts/` (`02-ARCHITECTURE-CONTRACTS.md` §3), so
 * this is plain string manipulation rather than `calc/decimal`'s `D`/`exact` — `decimalString`'s
 * own regex (`^-?\d+(\.\d+)?$`) guarantees a plain decimal with no scientific notation, which is
 * exactly the shape trailing-zero-stripping is sound for.
 */
function decimalStringsMatch(a: string, b: string): boolean {
  const normalize = (value: string): string => {
    const [intPart = '', fracPart = ''] = value.split('.');
    const trimmedFrac = fracPart.replace(/0+$/, '');
    const normalized = trimmedFrac.length > 0 ? `${intPart}.${trimmedFrac}` : intPart;
    return normalized === '-0' ? '0' : normalized;
  };
  return normalize(a) === normalize(b);
}

/**
 * **Post-review finding 2.** `finishJobRun`'s re-entrant tolerance used to compare only `status`
 * — so a retry reporting the *same* terminal status with a *different* payload (a different
 * `providerCalls`/`estimatedCostUsd`/`error`) was silently treated as an identical duplicate and
 * discarded, returning the first call's stale row with no error and no signal that anything was
 * dropped. The scenario this tolerance exists for — F16 §4.1 step 7's "a crash between the commit
 * and the caller observing success" — means the *second* call is exactly as likely to carry the
 * real, final numbers as the first; silently keeping whichever one happened to land first (rather
 * than whichever one is actually correct) under-reports real spend against D-20's budget ceiling
 * with nothing to detect it. Only a call whose payload is a byte-for-byte match with what is
 * already recorded is safe to treat as a genuine duplicate; anything else is the same class of
 * "two different, incompatible claims" the status-mismatch throw already exists to catch, just
 * carried in a different field. Only fields the caller actually supplied are compared — a caller
 * that omits a field (leaving it at its prior/default value) is not thereby in conflict with a
 * database that already has some other value stored there from a first successful write.
 *
 * **`completedAt` is deliberately never compared, unlike every other field here — post-review
 * finding 4 (round 2).** It is the one `JobRunOutcome` field that is not optional, so every real
 * call supplies it, but it is not a fact the retry could have gotten wrong the way a metric or an
 * error payload could: it is a wall-clock reading of "when did the caller observe completion,"
 * and F16 §4.1 step 7's crash-recovery retry is, by construction, a *second* call to `finishJobRun`
 * made at a *later* instant than the first — normal operation, not evidence of a conflicting
 * claim. Comparing it would make the wrapper's own retry mechanism throw against every real crash
 * recovery, defeating the tolerance this function exists to provide. The already-recorded
 * `completed_at` (the first call's, kept by the `where status in (...)` guard never matching a
 * second time) remains the one used for `F16 §4.1 step 6`'s duration figure, which is correct:
 * duration is measured from the actual completion, not from whenever a retry happened to notice.
 */
function finishOutcomeConflictsWithExisting(existing: JobRun, outcome: JobRunOutcome): boolean {
  if (outcome.itemsRead !== undefined && outcome.itemsRead !== existing.itemsRead) return true;
  if (outcome.itemsWritten !== undefined && outcome.itemsWritten !== existing.itemsWritten) return true;
  if (outcome.providerCalls !== undefined && outcome.providerCalls !== existing.providerCalls) return true;
  if (
    outcome.estimatedCostUsd !== undefined &&
    !decimalStringsMatch(outcome.estimatedCostUsd, existing.estimatedCostUsd ?? '')
  ) {
    return true;
  }
  if (outcome.error !== undefined && !jsonFieldsMatch(outcome.error, existing.error)) return true;
  if (outcome.metrics !== undefined && !jsonFieldsMatch(outcome.metrics, existing.metrics)) return true;
  if (outcome.unpricedUnits !== undefined && !jsonFieldsMatch(outcome.unpricedUnits, existing.unpricedUnits)) {
    return true;
  }
  if (outcome.dataAsOf !== undefined) {
    const existingTime = existing.dataAsOf === null ? null : existing.dataAsOf.getTime();
    const outcomeTime = outcome.dataAsOf === null ? null : outcome.dataAsOf.getTime();
    if (existingTime !== outcomeTime) return true;
  }
  return false;
}

/**
 * `queued` or `running` → a terminal status. Tolerant of a re-entrant call reporting the *same*
 * outcome it already recorded (a retried finish after a crash between the commit and the caller
 * observing success) — returns the existing row rather than throwing. A call reporting a
 * *different* terminal status, or the *same* status with a different payload
 * (`finishOutcomeConflictsWithExisting`, post-review finding 2), throws: a run does not get two
 * different final outcomes, and silently accepting the second would hide whatever called this
 * twice with conflicting information.
 */
export async function finishJobRun(
  id: string,
  outcome: JobRunOutcome,
  db: Queryable = getPool(),
): Promise<JobRun> {
  if (!TERMINAL_STATUSES.includes(outcome.status)) {
    // Defence against a caller that bypasses the type system (a raw JS call site, or a value
    // read back from an untyped source) — the `job_run_status_check` constraint would reject
    // `'queued'`/`'running'` here anyway, but failing here names *why*, before a query is sent.
    throw new Error(`'${outcome.status}' is not a terminal job_run status`);
  }

  const setEntries = Object.entries(
    snakeizeRow({
      status: outcome.status,
      completedAt: outcome.completedAt,
      itemsRead: outcome.itemsRead,
      itemsWritten: outcome.itemsWritten,
      providerCalls: outcome.providerCalls,
      estimatedCostUsd: outcome.estimatedCostUsd,
      unpricedUnits: jsonParam(outcome.unpricedUnits),
      error: jsonParam(outcome.error),
      metrics: jsonParam(outcome.metrics),
      dataAsOf: outcome.dataAsOf,
    }),
  ).filter(([, value]) => value !== undefined);

  // $1 is `id`; the SET clause's own parameters start at $2.
  const setSql = setEntries.map(([key], index) => `"${key}" = $${index + 2}`).join(', ');
  const values = setEntries.map(([, value]) => value);

  const { rows } = await db.query(
    `update job_run set ${setSql}
      where id = $1 and status in ('queued', 'running')
      returning ${JOB_RUN_COLUMNS}`,
    [id, ...values],
  );

  const finished = rows[0] as Row | undefined;
  if (finished !== undefined) return jobRun.parse(camelizeRow(finished));

  const existing = await findJobRunById(id, db);
  if (existing === null) {
    throw new Error(`job_run ${id} does not exist and cannot be finished`);
  }
  if (existing.status === outcome.status && !finishOutcomeConflictsWithExisting(existing, outcome)) {
    return existing;
  }
  if (existing.status === outcome.status) {
    throw new Error(
      `job_run ${id} was already finished as '${existing.status}', but this call reports a ` +
        'different outcome payload for the same status — a retried finish must report the ' +
        'identical result, not conflicting numbers for an already-recorded run',
    );
  }
  throw new Error(
    `job_run ${id} is already '${existing.status}' and cannot be finished as '${outcome.status}' — a run does not get two different final outcomes`,
  );
}

/**
 * The currently-running run for one job, if any. F16 §4.1's `concurrency_policy`
 * (`skip`/`queue`/`cancel_running`) is a dispatch decision `JobService` makes, but it needs this
 * read to make it — this module supplies the fact, not the policy. Uses
 * `job_run_job_started_idx (job_id, started_at desc)` (migration `0007`).
 */
export async function findRunningJobRun(
  jobId: string,
  db: Queryable = getPool(),
): Promise<JobRun | null> {
  const { rows } = await db.query(
    `select ${JOB_RUN_COLUMNS} from job_run
      where job_id = $1 and status = 'running'
      order by started_at desc
      limit 1`,
    [jobId],
  );
  const row = rows[0] as Row | undefined;
  return row === undefined ? null : jobRun.parse(camelizeRow(row));
}

export type JobRunHistoryQuery = {
  readonly jobId: string;
  readonly statuses?: readonly JobRun['status'][];
  readonly limit?: number;
};

const DEFAULT_JOB_RUN_HISTORY_LIMIT = 100;

/**
 * One job's run history, most-recent-first. **Post-review finding 3: does not actually use
 * `job_run_job_started_idx (job_id, started_at desc)`, despite an earlier version of this comment
 * claiming it did.** Measured directly against Postgres 16 at 50,000 rows: `order by started_at
 * desc` uses the index; `order by coalesce(started_at, created_at) desc` does not — the
 * `coalesce` does not "widen" the index's sort key, it makes the planner abandon the index
 * entirely (including for the `job_id =` equality filter) in favour of a sequential scan plus an
 * explicit sort. The `coalesce` itself is still the right ranking (see the reasoning below); the
 * cost is real and disclosed rather than claimed away. At F16 §4.3's 288 dispatches/day one job
 * accumulates roughly 105k rows a year, so every read here seq-scans and sorts the whole table
 * before applying `limit`. If this becomes measurably slow, the fix is a dedicated expression
 * index — `job_run ((coalesce(started_at, created_at)) desc)`, or a companion `(job_id,
 * coalesce(started_at, created_at) desc)` — a migration, out of a `repositories/`-only slice's
 * scope; reported rather than added unilaterally, the same standing this file already takes for
 * `mostRecentJobRun`'s identical, already-honestly-disclosed cost below.
 *
 * A still-`queued` row has no `started_at` yet (`startJobRun` has not run), and a plain
 * `started_at desc` — with either `nulls first` or `nulls last` — gets this wrong in one
 * direction or the other. `nulls last` (Postgres's own default for `desc`) buries a
 * just-claimed, about-to-run job underneath every already-finished one; `nulls first`
 * unconditionally puts *every* queued row above *every* started one regardless of actual
 * recency. `coalesce` instead ranks each row by the most recent instant it is actually known to
 * have happened — `started_at` once it exists, `created_at` (when it was claimed) until then —
 * which is what "most recent" means for a mix of pending and finished runs.
 *
 * **Post-review finding 5: an empty `statuses: []` used to mean "match every status" instead of
 * "match none."** A caller building a filter programmatically (an admin view with every status
 * checkbox deselected) asking for nothing must not be shown everything. Guarding on
 * `!== undefined` alone — not also `.length > 0` — sends an empty array through to `= any($1)`,
 * which Postgres itself evaluates to `false` for every row, correctly matching nothing.
 */
export async function jobRunHistory(
  query: JobRunHistoryQuery,
  db: Queryable = getPool(),
): Promise<JobRun[]> {
  const predicates = ['job_id = $1'];
  const params: unknown[] = [query.jobId];

  if (query.statuses !== undefined) {
    params.push(query.statuses);
    predicates.push(`status = any($${params.length})`);
  }

  params.push(query.limit ?? DEFAULT_JOB_RUN_HISTORY_LIMIT);
  const { rows } = await db.query(
    `select ${JOB_RUN_COLUMNS} from job_run
      where ${predicates.join(' and ')}
      order by coalesce(started_at, created_at) desc
      limit $${params.length}`,
    params,
  );
  return rows.map((row) => jobRun.parse(camelizeRow(row as Row)));
}

export type MostRecentJobRunQuery = {
  /**
   * **Post-review finding 1 (round 2): required, not optional — round 1's fix removed the `= {}`
   * default from the function's own parameter but left this field itself optional, so `{}` still
   * type-checked and still meant "no status filter."** The docstring below has stated since round
   * 1 that there is no safe default; making the type agree with the docstring is what actually
   * enforces it. A caller wanting every status regardless of outcome must say so explicitly
   * (every member of `TERMINAL_STATUSES` plus `'queued'`/`'running'`), not reach it by omission.
   */
  readonly statuses: readonly JobRun['status'][];
};

/**
 * System-wide latest job run. No `job_id` filter, so this cannot use `job_run_job_started_idx`
 * (scoped to one job) and runs an unindexed `order by ... limit 1` instead — unlike
 * `evidence.ts`'s `CANDIDATE_SCAN_LIMIT` (B-29), this is not a per-request read against an
 * unbounded per-security corpus with its own p95 budget; it is a once-a-day heartbeat check
 * against a table that grows at the dispatch cadence (288/day at minimum under F16 §4.3), not
 * per caller. If this ever becomes measurably slow as the table grows, the fix is a dedicated
 * `job_run (started_at desc)` (or `(created_at desc)`) index — a migration, out of a
 * `repositories/`-only slice's scope — reported rather than added unilaterally.
 *
 * **Post-review finding 7 (round 1), tightened by finding 1 (round 2): `statuses` is required,
 * with no default anywhere a caller could reach by omission.** F16 §4.5 states the heartbeat
 * plainly: it "checks the last **successful** dispatch and alerts if it is stale," because "a
 * dispatcher that dies quietly on a Friday costs three days of history that can never be
 * reconstructed." A caller with no status filter would happily return a `queued` row that was
 * claimed and never executed, or a run that failed — ranked purely by recency, not by whether
 * anything actually succeeded — so a heartbeat wired to a convenient no-filter call would see a
 * recent row and stay silent through exactly the outage this function exists to help catch.
 * There is no safe default to fall back to: the caller must state which statuses count as
 * "healthy" for its own purpose (`{ statuses: ['succeeded'] }` for F16 §4.5's heartbeat; a wider
 * set for e.g. an admin view of dispatch activity of any kind) rather than inherit one silently.
 *
 * **Post-review finding 5: an empty `statuses: []` used to mean "match every status" instead of
 * "match none"** — the identical bug `jobRunHistory` had, and the identical fix: guard on
 * `!== undefined` alone, not also `.length > 0`, so `= any($1)` against an empty array correctly
 * matches nothing rather than falling through to no filter at all.
 */
export async function mostRecentJobRun(
  query: MostRecentJobRunQuery,
  db: Queryable = getPool(),
): Promise<JobRun | null> {
  const { rows } = await db.query(
    `select ${JOB_RUN_COLUMNS} from job_run
      where status = any($1)
      order by coalesce(started_at, created_at) desc
      limit 1`,
    [query.statuses],
  );
  const row = rows[0] as Row | undefined;
  return row === undefined ? null : jobRun.parse(camelizeRow(row));
}
