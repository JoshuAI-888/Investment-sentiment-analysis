import type pg from 'pg';
import { rniPlatformSlice, rniRun, type RniPlatformSlice, type RniRun } from '../contracts';
import { getPool, withTransaction, type Queryable } from '../../repositories/client';

type RunRow = {
  readonly id: string;
  readonly idempotency_key: string;
  readonly trigger: string;
  readonly status: string;
  readonly window_start: Date | string;
  readonly window_end: Date | string;
  readonly comparison_start: Date | string | null;
  readonly comparison_end: Date | string | null;
  readonly universe_version: string;
  readonly config_version: string;
  readonly prompt_version: string;
  readonly ai_route: string;
  readonly requested_at: Date | string;
  readonly completed_at: Date | string | null;
};

type SliceRow = {
  readonly id: string;
  readonly run_id: string;
  readonly platform: string;
  readonly status: string;
  readonly eligible_source_count: number;
  readonly coverage_disclosure: string;
  readonly last_attempt_at: Date | string | null;
  readonly last_successful_refresh_at: Date | string | null;
  readonly data_through_at: Date | string | null;
  readonly computed_at: Date | string | null;
  readonly error_code: string | null;
};

const RUN_COLUMNS = `
  id, idempotency_key, trigger, status, window_start, window_end, comparison_start,
  comparison_end, universe_version, config_version, prompt_version, ai_route, requested_at,
  completed_at
`;

const SLICE_COLUMNS = `
  id, run_id, platform, status, eligible_source_count, coverage_disclosure, last_attempt_at,
  last_successful_refresh_at, data_through_at, computed_at, error_code
`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function runFromRow(row: RunRow): RniRun {
  return rniRun.parse({
    id: row.id,
    idempotencyKey: row.idempotency_key,
    trigger: row.trigger,
    status: row.status,
    windowStart: iso(row.window_start),
    windowEnd: iso(row.window_end),
    comparisonStart: nullableIso(row.comparison_start),
    comparisonEnd: nullableIso(row.comparison_end),
    universeVersion: row.universe_version,
    configVersion: row.config_version,
    promptVersion: row.prompt_version,
    aiRoute: row.ai_route,
    requestedAt: iso(row.requested_at),
    completedAt: nullableIso(row.completed_at),
  });
}

function sliceFromRow(row: SliceRow): RniPlatformSlice {
  return rniPlatformSlice.parse({
    id: row.id,
    runId: row.run_id,
    platform: row.platform,
    status: row.status,
    eligibleSourceCount: row.eligible_source_count,
    coverageDisclosure: row.coverage_disclosure,
    lastAttemptAt: nullableIso(row.last_attempt_at),
    lastSuccessfulRefreshAt: nullableIso(row.last_successful_refresh_at),
    dataThroughAt: nullableIso(row.data_through_at),
    computedAt: nullableIso(row.computed_at),
    errorCode: row.error_code,
  });
}

async function insertOrReadRun(
  run: RniRun,
  db: Queryable,
): Promise<{ readonly row: RunRow; readonly inserted: boolean }> {
  const { rows } = await db.query<RunRow>(
    `insert into rni_run (
       id, idempotency_key, trigger, status, window_start, window_end, comparison_start,
       comparison_end, universe_version, config_version, prompt_version, ai_route, requested_at,
       completed_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (idempotency_key) do nothing returning ${RUN_COLUMNS}`,
    [
      run.id,
      run.idempotencyKey,
      run.trigger,
      run.status,
      run.windowStart,
      run.windowEnd,
      run.comparisonStart,
      run.comparisonEnd,
      run.universeVersion,
      run.configVersion,
      run.promptVersion,
      run.aiRoute,
      run.requestedAt,
      run.completedAt,
    ],
  );
  const inserted = rows[0];
  if (inserted !== undefined) return { row: inserted, inserted: true };

  const { rows: existingRows } = await db.query<RunRow>(
    `select ${RUN_COLUMNS} from rni_run where idempotency_key = $1`,
    [run.idempotencyKey],
  );
  const existing = existingRows[0];
  if (existing === undefined) throw new Error('RNI run upsert could not read its conflict');
  return { row: existing, inserted: false };
}

async function insertOrReadSlice(
  slice: RniPlatformSlice,
  persistedRunId: string,
  db: Queryable,
): Promise<{ readonly row: SliceRow; readonly inserted: boolean }> {
  const { rows } = await db.query<SliceRow>(
    `insert into rni_platform_slice (
       id, run_id, platform, status, eligible_source_count, coverage_disclosure, last_attempt_at,
       last_successful_refresh_at, data_through_at, computed_at, error_code
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (run_id, platform) do nothing returning ${SLICE_COLUMNS}`,
    [
      slice.id,
      persistedRunId,
      slice.platform,
      slice.status,
      slice.eligibleSourceCount,
      slice.coverageDisclosure,
      slice.lastAttemptAt,
      slice.lastSuccessfulRefreshAt,
      slice.dataThroughAt,
      slice.computedAt,
      slice.errorCode,
    ],
  );
  const inserted = rows[0];
  if (inserted !== undefined) return { row: inserted, inserted: true };

  const { rows: existingRows } = await db.query<SliceRow>(
    `select ${SLICE_COLUMNS} from rni_platform_slice where run_id = $1 and platform = $2`,
    [persistedRunId, slice.platform],
  );
  const existing = existingRows[0];
  if (existing === undefined)
    throw new Error('RNI platform slice upsert could not read its conflict');
  return { row: existing, inserted: false };
}

export type RniRunWithSlicesWrite = {
  readonly run: RniRun;
  readonly slices: readonly [RniPlatformSlice, RniPlatformSlice];
  readonly runInserted: boolean;
  readonly insertedSliceCount: number;
};

function validateSlices(
  run: RniRun,
  inputs: readonly RniPlatformSlice[],
): readonly [RniPlatformSlice, RniPlatformSlice] {
  const slices = inputs.map((input) => rniPlatformSlice.parse(input));
  if (slices.length !== 2) throw new Error('RNI run requires exactly two platform slices');
  if (slices.some((slice) => slice.runId !== run.id)) {
    throw new Error('Every RNI platform slice must reference the supplied run');
  }
  if (new Set(slices.map((slice) => slice.platform)).size !== 2) {
    throw new Error('RNI run requires one reddit and one x platform slice');
  }
  return slices as [RniPlatformSlice, RniPlatformSlice];
}

export async function persistRniRunWithSlices(
  runInput: RniRun,
  sliceInputs: readonly RniPlatformSlice[],
  pool: pg.Pool = getPool(),
): Promise<RniRunWithSlicesWrite> {
  const run = rniRun.parse(runInput);
  const slices = validateSlices(run, sliceInputs);
  return withTransaction(async (tx) => {
    const persistedRun = await insertOrReadRun(run, tx);
    const persistedSlices = await Promise.all(
      slices.map((slice) => insertOrReadSlice(slice, persistedRun.row.id, tx)),
    );
    const sorted = persistedSlices
      .map(({ row }) => sliceFromRow(row))
      .sort((left, right) => left.platform.localeCompare(right.platform));
    return {
      run: runFromRow(persistedRun.row),
      slices: sorted as [RniPlatformSlice, RniPlatformSlice],
      runInserted: persistedRun.inserted,
      insertedSliceCount: persistedSlices.filter(({ inserted }) => inserted).length,
    };
  }, pool);
}

export async function getRniRunById(
  runId: string,
  db: Queryable = getPool(),
): Promise<RniRun | undefined> {
  const { rows } = await db.query<RunRow>(`select ${RUN_COLUMNS} from rni_run where id = $1`, [
    runId,
  ]);
  return rows[0] === undefined ? undefined : runFromRow(rows[0]);
}

export async function getRniPlatformSlices(
  runId: string,
  db: Queryable = getPool(),
): Promise<readonly RniPlatformSlice[]> {
  const { rows } = await db.query<SliceRow>(
    `select ${SLICE_COLUMNS} from rni_platform_slice where run_id = $1 order by platform`,
    [runId],
  );
  return rows.map(sliceFromRow);
}
