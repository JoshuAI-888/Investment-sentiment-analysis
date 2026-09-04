/**
 * Config and universe versions, and the activation transaction (F03 §4.3).
 *
 * **The constraint is the partial unique index, not this file.** `config_version_single_active`
 * and `universe_version_single_active` are what make "at most one active version" true under a
 * concurrent activation — which is the only moment the rule matters. The transaction below
 * orders the work and writes the audit trail; it is not the guarantee.
 */
import {
  configVersion,
  universeVersion,
  type ConfigVersion,
  type UniverseVersion,
  UNIVERSE_MAX_SYMBOLS,
} from '../contracts/config';
import { camelizeRow, insertClause } from './rows';
import { getPool, withTransaction, type Queryable } from './client';

const CONFIG_COLUMNS =
  'id, environment, status, parent_version, created_by, change_reason, created_at, effective_at, activated_at, approved_by, checksum';

const UNIVERSE_COLUMNS =
  'id, environment, config_version, status, parent_version, selected_count, selection_query, impact_preview, created_by, change_reason, created_at, activated_at';

export type NewConfigVersion = {
  environment: string;
  status?: 'draft' | 'staged' | 'active';
  parentVersion?: string | null;
  createdBy: string;
  changeReason: string;
  checksum: string;
};

export async function insertConfigVersion(
  input: NewConfigVersion,
  db: Queryable = getPool(),
): Promise<ConfigVersion> {
  const { columns, placeholders, values } = insertClause({ status: 'draft', ...input });
  const { rows } = await db.query(
    `insert into config_version (${columns}) values (${placeholders}) returning ${CONFIG_COLUMNS}`,
    values,
  );
  return configVersion.parse(camelizeRow(rows[0] as Record<string, unknown>));
}

export async function findActiveConfigVersion(
  environment: string,
  db: Queryable = getPool(),
): Promise<ConfigVersion | null> {
  const { rows } = await db.query(
    `select ${CONFIG_COLUMNS} from config_version where environment = $1 and status = 'active'`,
    [environment],
  );
  const row = rows[0];
  return row === undefined ? null : configVersion.parse(camelizeRow(row as Record<string, unknown>));
}

export type ActivationAudit = {
  actorId: string;
  actorRole: string;
  reason: string;
  requestId: string;
  correlationId: string;
};

/**
 * Deactivate the current version, activate the successor, write the audit event — one
 * transaction. A failure at any point leaves the previous version active, which is the
 * property F03 §4.3 actually asks for and the reason this is not three statements at a call
 * site.
 */
export async function activateConfigVersion(
  environment: string,
  versionId: string,
  audit: ActivationAudit,
): Promise<ConfigVersion> {
  return withTransaction(async (tx) => {
    // Serialise concurrent activations for this environment. Without the lock, two callers
    // both pass the "is there an active one?" read and the second fails on the unique index —
    // correct, but as a constraint violation rather than as a wait.
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`config:${environment}`]);

    const previous = await tx.query(
      `select ${CONFIG_COLUMNS} from config_version where environment = $1 and status = 'active'`,
      [environment],
    );

    await tx.query(
      `update config_version set status = 'superseded' where environment = $1 and status = 'active'`,
      [environment],
    );

    const { rows } = await tx.query(
      `update config_version
          set status = 'active', activated_at = now()
        where id = $1 and environment = $2 and status in ('draft', 'staged')
      returning ${CONFIG_COLUMNS}`,
      [versionId, environment],
    );

    const activated = rows[0];
    if (activated === undefined) {
      throw new Error(
        `config_version ${versionId} is not a draft or staged version in ${environment}. Activating an already-superseded version would resurrect configuration that artifacts have already recorded as retired.`,
      );
    }

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          before_value, after_value, result, request_id, correlation_id)
       values ($1, $2, 'activate', 'config_version', $3, $4, $5, $6, $7, 'success', $8, $9)`,
      [
        audit.actorId,
        audit.actorRole,
        versionId,
        environment,
        audit.reason,
        JSON.stringify(previous.rows[0] ?? null),
        JSON.stringify(activated),
        audit.requestId,
        audit.correlationId,
      ],
    );

    return configVersion.parse(camelizeRow(activated as Record<string, unknown>));
  });
}

export type NewUniverseVersion = {
  environment: string;
  configVersion: string;
  createdBy: string;
  changeReason: string;
  status?: 'draft' | 'staged';
  parentVersion?: string | null;
  selectionQuery?: unknown;
};

export async function insertUniverseVersion(
  input: NewUniverseVersion,
  db: Queryable = getPool(),
): Promise<UniverseVersion> {
  const { columns, placeholders, values } = insertClause({ status: 'draft', ...input });
  const { rows } = await db.query(
    `insert into universe_version (${columns}) values (${placeholders}) returning ${UNIVERSE_COLUMNS}`,
    values,
  );
  return universeVersion.parse(camelizeRow(rows[0] as Record<string, unknown>));
}

export async function findActiveUniverseVersion(
  environment: string,
  db: Queryable = getPool(),
): Promise<UniverseVersion | null> {
  const { rows } = await db.query(
    `select ${UNIVERSE_COLUMNS} from universe_version where environment = $1 and status = 'active'`,
    [environment],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : universeVersion.parse(camelizeRow(row as Record<string, unknown>));
}

export async function countUniverseVersions(
  environment: string,
  db: Queryable = getPool(),
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'select count(*)::text as count from universe_version where environment = $1',
    [environment],
  );
  return Number(rows[0]?.count ?? '0');
}

/**
 * Materialise membership and activate. **Membership is materialised at activation** so a later
 * catalogue or profile change cannot silently alter a historical universe version — which is
 * what makes ADR-015's "historical results are never rewritten" true rather than aspirational.
 */
export async function activateUniverseVersion(
  environment: string,
  versionId: string,
  members: readonly { securityId: string; addedBy: string; selectionSource: string }[],
  audit: ActivationAudit,
): Promise<UniverseVersion> {
  if (members.length > UNIVERSE_MAX_SYMBOLS) {
    throw new Error(
      `${members.length} members exceeds universe.max_symbols (${UNIVERSE_MAX_SYMBOLS}, D-27). The database constraint would reject this too; failing here names the limit.`,
    );
  }

  return withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`universe:${environment}`]);

    const previous = await tx.query(
      `select ${UNIVERSE_COLUMNS} from universe_version where environment = $1 and status = 'active'`,
      [environment],
    );

    for (const member of members) {
      await tx.query(
        `insert into universe_member (universe_version, security_id, added_by, selection_source)
         values ($1, $2, $3, $4)
         on conflict (universe_version, security_id) do nothing`,
        [versionId, member.securityId, member.addedBy, member.selectionSource],
      );
    }

    await tx.query(
      `update universe_version set status = 'superseded' where environment = $1 and status = 'active'`,
      [environment],
    );

    const { rows } = await tx.query(
      `update universe_version
          set status = 'active', activated_at = now(), selected_count = $3
        where id = $1 and environment = $2 and status in ('draft', 'staged')
      returning ${UNIVERSE_COLUMNS}`,
      [versionId, environment, members.length],
    );

    const activated = rows[0];
    if (activated === undefined) {
      throw new Error(`universe_version ${versionId} is not a draft or staged version in ${environment}`);
    }

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          before_value, after_value, result, request_id, correlation_id)
       values ($1, $2, 'activate', 'universe_version', $3, $4, $5, $6, $7, 'success', $8, $9)`,
      [
        audit.actorId,
        audit.actorRole,
        versionId,
        environment,
        audit.reason,
        JSON.stringify(previous.rows[0] ?? null),
        JSON.stringify(activated),
        audit.requestId,
        audit.correlationId,
      ],
    );

    return universeVersion.parse(camelizeRow(activated as Record<string, unknown>));
  });
}

export async function listUniverseMembers(
  versionId: string,
  db: Queryable = getPool(),
): Promise<string[]> {
  const { rows } = await db.query<{ security_id: string }>(
    'select security_id from universe_member where universe_version = $1 and enabled = true order by security_id',
    [versionId],
  );
  return rows.map((row) => row.security_id);
}
