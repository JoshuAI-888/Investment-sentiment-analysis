/**
 * `model_route` — task-scoped LLM routing (ADR-012). Read-heavy: F15's models tab renders the
 * routes carried by the active config version. Writing a route means writing it into a new
 * (draft) `config_version`, exactly like `settings.ts` — routes are versioned by riding inside a
 * config version, not by their own independent version chain.
 */
import { modelRoute, type ModelRoute } from '../contracts/config';
import { camelizeRow } from './rows';
import { getPool, type Queryable } from './client';

const COLUMNS =
  'config_version, task, transport, primary_provider, primary_model, model_revision, fallback_chain, prompt_version, schema_version, calibration_version, temperature, max_input_tokens, max_output_tokens, timeout_ms, max_cost_usd, allowed_data_classes, shadow_model, canary_percent, evaluation_run_id, enabled';

export type NewModelRoute = Omit<ModelRoute, 'temperature' | 'maxCostUsd' | 'canaryPercent'> & {
  readonly temperature: string;
  readonly maxCostUsd: string;
  readonly canaryPercent: string;
};

export async function insertModelRoute(
  input: NewModelRoute,
  db: Queryable = getPool(),
): Promise<ModelRoute> {
  const { rows } = await db.query(
    `insert into model_route (${COLUMNS})
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     returning ${COLUMNS}`,
    [
      input.configVersion,
      input.task,
      input.transport,
      input.primaryProvider,
      input.primaryModel,
      input.modelRevision,
      JSON.stringify(input.fallbackChain ?? []),
      input.promptVersion,
      input.schemaVersion,
      input.calibrationVersion,
      input.temperature,
      input.maxInputTokens,
      input.maxOutputTokens,
      input.timeoutMs,
      input.maxCostUsd,
      JSON.stringify(input.allowedDataClasses ?? []),
      input.shadowModel === null || input.shadowModel === undefined ? null : JSON.stringify(input.shadowModel),
      input.canaryPercent,
      input.evaluationRunId,
      input.enabled,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insert into model_route returned no row');
  return modelRoute.parse(camelizeRow(row as Record<string, unknown>));
}

export async function listModelRoutesForVersion(
  configVersion: string,
  db: Queryable = getPool(),
): Promise<ModelRoute[]> {
  const { rows } = await db.query(
    `select ${COLUMNS} from model_route where config_version = $1 order by task`,
    [configVersion],
  );
  return rows.map((row) => modelRoute.parse(camelizeRow(row as Record<string, unknown>)));
}

export async function findModelRoute(
  configVersion: string,
  task: string,
  db: Queryable = getPool(),
): Promise<ModelRoute | null> {
  const { rows } = await db.query(
    `select ${COLUMNS} from model_route where config_version = $1 and task = $2`,
    [configVersion, task],
  );
  const row = rows[0];
  return row === undefined ? null : modelRoute.parse(camelizeRow(row as Record<string, unknown>));
}
