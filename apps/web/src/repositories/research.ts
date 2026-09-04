/**
 * `research_run`, `research_event` and `claim_ledger` (migration `0005`). SQL lives here and
 * nowhere else (F03 DoD item 9, `no-sql-outside-repositories`).
 *
 * **Why this file exists at all, given `CLAUDE.md`'s "never edit `src/repositories/` beyond a
 * strictly additive schema addition — SPINE-owned."** Migration `0005`'s own header is explicit:
 * *"Wave 3 (F11) writes these."* Unlike `evidence.ts`/`market.ts`/`sentiment.ts` (built by SPINE
 * as a cross-lane gap-fill for tables several features read), no repository over these three
 * tables existed before this feature, and the migration that introduces them names F11 as the
 * writer. This is a wholly new, additive file — nothing existing here is edited — scoped strictly
 * to the CRUD `contracts/research.ts`'s shapes and F11's state machine need. A larger or
 * different persistence shape than what F11 actually calls should go through SPINE as a contract
 * request, not be added here speculatively.
 *
 * **Append-only, per `02-ARCHITECTURE-CONTRACTS.md` §5: "research_event", "claim_ledger" are
 * both in that list.** Nothing here issues an `update` against `research_event` or
 * `claim_ledger` — a run's mutable fields (`status`, `result`, `cost_usd`, `completed_at`,
 * retraction columns) live on `research_run` itself, which the architecture doc does *not* list
 * as append-only (the run row's own lifecycle is what `research_event` narrates; the row is
 * allowed to carry current state precisely so a reader does not have to replay the whole event
 * log just to answer "is this run done yet").
 */
import { researchRun, researchEvent, claimLedgerEntry, type ResearchRun, type ResearchEvent, type ClaimLedgerEntry } from '../contracts/research';
import { camelizeRow, type Row } from './rows';
import { getPool, withTransaction, type Queryable } from './client';

const RUN_COLUMNS =
  'id, user_id, security_id, question, status, coverage_status, input_cutoff, started_at, ' +
  'completed_at, prompt_version, model_route, tool_manifest, cost_usd, result, error, ' +
  'retracted_reason, retracted_by, retracted_at';

function parseRun(row: Row): ResearchRun {
  return researchRun.parse(camelizeRow(row));
}

export type NewResearchRun = {
  readonly userId: string;
  readonly securityId: string | null;
  readonly question: string;
  readonly coverageStatus: string;
  readonly inputCutoff: Date;
  readonly promptVersion: string;
  readonly modelRoute: unknown;
  readonly toolManifest: unknown;
};

/** Every run starts `queued`, unretracted, uncosted. `startedAt`/`id` are database defaults. */
export async function insertResearchRun(
  input: NewResearchRun,
  db: Queryable = getPool(),
): Promise<ResearchRun> {
  const { rows } = await db.query(
    `insert into research_run
       (user_id, security_id, question, status, coverage_status, input_cutoff,
        prompt_version, model_route, tool_manifest, cost_usd)
     values ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, 0)
     returning ${RUN_COLUMNS}`,
    [
      input.userId,
      input.securityId,
      input.question,
      input.coverageStatus,
      input.inputCutoff,
      input.promptVersion,
      JSON.stringify(input.modelRoute ?? {}),
      JSON.stringify(input.toolManifest ?? {}),
    ],
  );
  const row = rows[0] as Row | undefined;
  if (row === undefined) throw new Error('insert into research_run returned no row');
  return parseRun(row);
}

export async function findResearchRun(
  id: string,
  db: Queryable = getPool(),
): Promise<ResearchRun | null> {
  const { rows } = await db.query(`select ${RUN_COLUMNS} from research_run where id = $1`, [id]);
  const row = rows[0] as Row | undefined;
  return row === undefined ? null : parseRun(row);
}

export type ResearchRunPatch = {
  readonly status?: ResearchRun['status'];
  readonly coverageStatus?: string;
  readonly completedAt?: Date | null;
  readonly costUsd?: string;
  readonly result?: unknown;
  readonly error?: unknown;
};

/**
 * The one place `research_run`'s mutable columns are written after creation. Every terminal
 * transition (`complete`/`degraded`/`verification_failed`/`failed`) and every accrued-cost update
 * along the way goes through this — `research_event` is the append-only narration of *why*, this
 * is the current-state row a reader consults without replaying the log.
 */
export async function patchResearchRun(
  id: string,
  patch: ResearchRunPatch,
  db: Queryable = getPool(),
): Promise<ResearchRun> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.status !== undefined) {
    sets.push(`status = $${String(i)}`);
    values.push(patch.status);
    i += 1;
  }
  if (patch.coverageStatus !== undefined) {
    sets.push(`coverage_status = $${String(i)}`);
    values.push(patch.coverageStatus);
    i += 1;
  }
  if (patch.completedAt !== undefined) {
    sets.push(`completed_at = $${String(i)}`);
    values.push(patch.completedAt);
    i += 1;
  }
  if (patch.costUsd !== undefined) {
    sets.push(`cost_usd = $${String(i)}`);
    values.push(patch.costUsd);
    i += 1;
  }
  if (patch.result !== undefined) {
    sets.push(`result = $${String(i)}`);
    values.push(JSON.stringify(patch.result));
    i += 1;
  }
  if (patch.error !== undefined) {
    sets.push(`error = $${String(i)}`);
    values.push(JSON.stringify(patch.error));
    i += 1;
  }

  if (sets.length === 0) {
    const existing = await findResearchRun(id, db);
    if (existing === null) throw new Error(`research_run ${id} not found`);
    return existing;
  }

  values.push(id);
  const { rows } = await db.query(
    `update research_run set ${sets.join(', ')} where id = $${String(i)} returning ${RUN_COLUMNS}`,
    values,
  );
  const row = rows[0] as Row | undefined;
  if (row === undefined) throw new Error(`research_run ${id} not found`);
  return parseRun(row);
}

export class RunNotRetractableError extends Error {
  constructor(id: string, status: string) {
    super(
      `research_run ${id} cannot be retracted from status '${status}' — only 'complete' or ` +
        "'degraded' runs are (F11 §4.1's state diagram: complete|degraded → retracted).",
    );
    this.name = 'RunNotRetractableError';
  }
}

/**
 * F-20. Nothing is deleted — the row stays, gains the three retraction columns and moves to
 * `retracted`. Only reachable from `complete`/`degraded` (the DB's own check constraint also
 * enforces "a retracted row always carries its reason/actor/time", independent of this guard).
 * Writes an `audit_event` row in the same transaction as the "record" half of F-20's
 * identify/retract/notify/record sequence — "notify" is every future read of this run showing
 * the retraction (`patchResearchRun`'s `status` column is what every render surface reads).
 */
export async function retractResearchRun(
  input: { readonly id: string; readonly reason: string; readonly actorId: string; readonly at?: Date },
): Promise<ResearchRun> {
  return withTransaction(async (tx) => {
    const current = await findResearchRun(input.id, tx);
    if (current === null) throw new Error(`research_run ${input.id} not found`);
    if (current.status !== 'complete' && current.status !== 'degraded') {
      throw new RunNotRetractableError(input.id, current.status);
    }

    const at = input.at ?? new Date();
    const { rows } = await tx.query(
      `update research_run
          set status = 'retracted', retracted_reason = $2, retracted_by = $3, retracted_at = $4
        where id = $1 and status in ('complete', 'degraded')
        returning ${RUN_COLUMNS}`,
      [input.id, input.reason, input.actorId, at],
    );
    const row = rows[0] as Row | undefined;
    if (row === undefined) throw new RunNotRetractableError(input.id, current.status);

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason, result,
          request_id, correlation_id, after_value)
       values ($1, 'operator', 'retract', 'research_run', $2, 'all', $3, 'success', $4, $4, $5)`,
      [
        input.actorId,
        input.id,
        input.reason,
        `research-retract-${input.id}`,
        JSON.stringify({ status: 'retracted', retractedReason: input.reason, retractedAt: at.toISOString() }),
      ],
    );

    return parseRun(row);
  });
}

// ── research_event ───────────────────────────────────────────────────────────────────────────

const EVENT_COLUMNS = 'run_id, sequence, event_type, label, payload, created_at';

/**
 * Append-only. `sequence` is caller-supplied (the state machine keeps its own monotonically
 * increasing counter per run) rather than a database-assigned identity — a caller replaying from
 * a known sequence (reload mid-run) needs to be able to say "give me everything after N", which
 * a `bigserial` would answer identically but a caller-owned counter also lets a retry of the
 * *same* transition be a harmless no-op-shaped duplicate-key error instead of a silent double
 * append.
 */
export async function appendResearchEvent(
  event: {
    readonly runId: string;
    readonly sequence: number;
    readonly eventType: string;
    readonly label: string;
    readonly payload: unknown;
  },
  db: Queryable = getPool(),
): Promise<ResearchEvent> {
  const { rows } = await db.query(
    `insert into research_event (run_id, sequence, event_type, label, payload)
     values ($1, $2, $3, $4, $5)
     returning ${EVENT_COLUMNS}`,
    [event.runId, event.sequence, event.eventType, event.label, JSON.stringify(event.payload ?? {})],
  );
  const row = rows[0] as Row | undefined;
  if (row === undefined) throw new Error('insert into research_event returned no row');
  return researchEvent.parse(camelizeRow(row));
}

/** Ordered by `sequence` — the replay order a reload reconstructs state from. */
export async function listResearchEvents(
  runId: string,
  db: Queryable = getPool(),
): Promise<readonly ResearchEvent[]> {
  const { rows } = await db.query(
    `select ${EVENT_COLUMNS} from research_event where run_id = $1 order by sequence asc`,
    [runId],
  );
  return rows.map((row) => researchEvent.parse(camelizeRow(row as Row)));
}

// ── claim_ledger ─────────────────────────────────────────────────────────────────────────────

const CLAIM_COLUMNS =
  'id, run_id, claim_text, claim_type, materiality, evidence_ids, metric_ids, ' +
  'verification_status, verifier_notes';

export type NewClaimLedgerEntry = Omit<ClaimLedgerEntry, 'id'>;

/** One insert per claim — a run's claims are written once, at the end of `verifying`, never revised. */
export async function insertClaimLedgerEntry(
  input: NewClaimLedgerEntry,
  db: Queryable = getPool(),
): Promise<ClaimLedgerEntry> {
  const { rows } = await db.query(
    `insert into claim_ledger
       (run_id, claim_text, claim_type, materiality, evidence_ids, metric_ids,
        verification_status, verifier_notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${CLAIM_COLUMNS}`,
    [
      input.runId,
      input.claimText,
      input.claimType,
      input.materiality,
      input.evidenceIds,
      input.metricIds,
      input.verificationStatus,
      input.verifierNotes,
    ],
  );
  const row = rows[0] as Row | undefined;
  if (row === undefined) throw new Error('insert into claim_ledger returned no row');
  return claimLedgerEntry.parse(camelizeRow(row));
}

export async function insertClaimLedgerEntries(
  inputs: readonly NewClaimLedgerEntry[],
  db: Queryable = getPool(),
): Promise<readonly ClaimLedgerEntry[]> {
  const out: ClaimLedgerEntry[] = [];
  for (const input of inputs) out.push(await insertClaimLedgerEntry(input, db));
  return out;
}

export async function listClaimLedgerForRun(
  runId: string,
  db: Queryable = getPool(),
): Promise<readonly ClaimLedgerEntry[]> {
  const { rows } = await db.query(
    `select ${CLAIM_COLUMNS} from claim_ledger where run_id = $1 order by id asc`,
    [runId],
  );
  return rows.map((row) => claimLedgerEntry.parse(camelizeRow(row as Row)));
}

// ── cost_event, read only ────────────────────────────────────────────────────────────────────

/**
 * Total recorded spend for one run, summed off `cost_event.research_run_id`
 * (`repositories/cost.ts` — SPINE-owned — has no run-scoped sum today; `insertCostEvent`/
 * `spendInWindow` are the only exports and neither answers "how much did *this* run cost", so
 * `services/research/run-service.ts` needs this and cannot reach `cost_event` itself —
 * `no-sql-outside-repositories` forbids SQL outside `repositories/` regardless of which table it
 * touches). Kept here rather than in `cost.ts` for the identical reason the rest of this file
 * exists: this feature does not edit another lane's repository file. Read-only; nothing here
 * writes `cost_event` — that stays `researchCostSinkOverCostEvent` (`services/research/
 * model-deps.ts`) calling the existing `insertCostEvent`.
 */
export async function sumCostEventForResearchRun(
  runId: string,
  db: Queryable = getPool(),
): Promise<string> {
  const { rows } = await db.query<{ total: string | null }>(
    `select coalesce(sum(cost_usd), 0)::text as total from cost_event where research_run_id = $1`,
    [runId],
  );
  return rows[0]?.total ?? '0';
}
