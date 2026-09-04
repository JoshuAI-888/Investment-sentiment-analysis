/**
 * `app_setting` — the typed runtime settings catalogue (ADR-012). Rows are keyed by
 * `(config_version, setting_key, scope_type, scope_id)`; a setting's *history* is therefore the
 * sequence of `config_version`s that carried a value for its key, not a mutable cell. Additive
 * to `versions.ts`, which owns `config_version`/`universe_version` themselves — this file only
 * reads and writes the settings that ride inside one.
 */
import { appSetting, type AppSetting } from '../contracts/config';
import { camelizeRow } from './rows';
import { getPool, type Queryable } from './client';

const COLUMNS =
  'config_version, setting_key, scope_type, scope_id, value, value_type, governance_class, setting_schema_version, method_affecting, sensitive';
const S_COLUMNS = COLUMNS.split(', ')
  .map((column) => `s.${column}`)
  .join(', ');

export type NewAppSetting = {
  readonly configVersion: string;
  readonly settingKey: string;
  readonly scopeType: AppSetting['scopeType'];
  readonly scopeId: string;
  readonly value: unknown;
  readonly valueType: string;
  readonly governanceClass: string;
  readonly settingSchemaVersion: string;
  readonly methodAffecting: boolean;
};

/**
 * Writes one setting row into an existing (draft) `config_version`. `sensitive` is always
 * `false` here — the column exists so a client cannot construct a request that sets it `true`;
 * the database's `app_setting_no_secrets_check` constraint is the second, independent line of
 * defence (ADR-012, F15 §4.2).
 */
export async function insertAppSetting(
  input: NewAppSetting,
  db: Queryable = getPool(),
): Promise<AppSetting> {
  const { rows } = await db.query(
    `insert into app_setting (${COLUMNS})
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
     returning ${COLUMNS}`,
    [
      input.configVersion,
      input.settingKey,
      input.scopeType,
      input.scopeId,
      JSON.stringify(input.value),
      input.valueType,
      input.governanceClass,
      input.settingSchemaVersion,
      input.methodAffecting,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insert into app_setting returned no row');
  return appSetting.parse(camelizeRow(row as Record<string, unknown>));
}

/** Every setting row carried by one config version — the full catalogue snapshot it represents. */
export async function listAppSettingsForVersion(
  configVersion: string,
  db: Queryable = getPool(),
): Promise<AppSetting[]> {
  const { rows } = await db.query(
    `select ${COLUMNS} from app_setting where config_version = $1 order by setting_key, scope_type, scope_id`,
    [configVersion],
  );
  return rows.map((row) => appSetting.parse(camelizeRow(row as Record<string, unknown>)));
}

/** One key's currently-active value (global scope), or `null` if never set. */
export async function findActiveAppSetting(
  environment: string,
  settingKey: string,
  db: Queryable = getPool(),
): Promise<AppSetting | null> {
  const { rows } = await db.query(
    `select ${S_COLUMNS}
       from app_setting s
       join config_version c on c.id = s.config_version
      where c.environment = $1 and c.status = 'active' and s.setting_key = $2 and s.scope_type = 'global'`,
    [environment, settingKey],
  );
  const row = rows[0];
  return row === undefined ? null : appSetting.parse(camelizeRow(row as Record<string, unknown>));
}
