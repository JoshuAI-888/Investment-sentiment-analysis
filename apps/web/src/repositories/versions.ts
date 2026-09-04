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
  'id, environment, config_version, status, parent_version, selected_count, selection_query, impact_preview, source_provider, source_endpoint, source_retrieved_at, source_payload_hash, provider_call_id, created_by, change_reason, created_at, activated_at, approved_by';
const QUALIFIED_UNIVERSE_COLUMNS = UNIVERSE_COLUMNS.split(', ')
  .map((column) => `uv.${column}`)
  .join(', ');

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
  return row === undefined
    ? null
    : configVersion.parse(camelizeRow(row as Record<string, unknown>));
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
  /** FMP versions must use stageFmpUniverseVersion so required lineage cannot be omitted. */
  sourceProvider?: null;
  sourceEndpoint?: null;
  sourceRetrievedAt?: null;
  sourcePayloadHash?: null;
  providerCallId?: null;
  approvedBy?: null;
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

export type UniverseProviderCallInput = {
  readonly operation: string;
  readonly requestFingerprint: string;
  readonly statusCode: number | null;
  readonly latencyMs: number;
  readonly cacheStatus: string;
  readonly itemsReturned: number | null;
  readonly estimatedCostUsd: string;
  readonly startedAt: Date;
  readonly errorClass: string | null;
};

export async function insertUniverseProviderCall(
  input: UniverseProviderCallInput,
  db: Queryable = getPool(),
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into provider_call_log
       (provider, operation, request_fingerprint, status_code, latency_ms, cache_status,
        items_returned, estimated_cost_usd, started_at, error_class)
     values ('fmp', $1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      input.operation,
      input.requestFingerprint,
      input.statusCode,
      input.latencyMs,
      input.cacheStatus,
      input.itemsReturned,
      input.estimatedCostUsd,
      input.startedAt,
      input.errorClass,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('provider_call_log insert returned no row');
  return id;
}

/** Persist an FMP attempt and attach it to its claimed command before control returns. */
export async function insertAndBindUniverseProviderCall(input: {
  readonly command: UniverseSyncCommandInput;
  readonly call: UniverseProviderCallInput;
}): Promise<string> {
  return withTransaction(async (tx) => {
    const providerCallId = await insertUniverseProviderCall(input.call, tx);
    const { rowCount } = await tx.query(
      `update rni_universe_sync_command
          set provider_call_id = $3
        where environment = $1 and idempotency_key = $2 and status = 'running'`,
      [input.command.environment, input.command.idempotencyKey, providerCallId],
    );
    if (rowCount !== 1) {
      throw new Error('Universe sync command was not running when its provider call was logged');
    }
    return providerCallId;
  });
}

export type UniverseSyncCommandInput = {
  readonly environment: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly correlationId: string;
};

export type UniverseSyncCommandClaim =
  | { readonly state: 'claimed' }
  | { readonly state: 'running'; readonly retryAt: string }
  | { readonly state: 'completed'; readonly result: unknown }
  | { readonly state: 'failed'; readonly errorMessage: string };

type UniverseSyncCommandRow = {
  readonly status: 'running' | 'completed' | 'failed';
  readonly result_payload: unknown | null;
  readonly error_message: string | null;
  readonly lease_expires_at: Date | null;
};

function universeSyncCommandObjectId(input: UniverseSyncCommandInput): string {
  return `${input.environment}:${input.idempotencyKey}`;
}

function commandClaimFromRow(row: UniverseSyncCommandRow): UniverseSyncCommandClaim {
  if (row.status === 'running') {
    if (row.lease_expires_at === null) {
      throw new Error('Running universe sync command has no lease expiry');
    }
    return { state: 'running', retryAt: row.lease_expires_at.toISOString() };
  }
  if (row.status === 'failed') {
    if (row.error_message === null) throw new Error('Failed universe sync command has no error');
    return { state: 'failed', errorMessage: row.error_message };
  }
  if (row.result_payload === null) throw new Error('Completed universe sync command has no result');
  return { state: 'completed', result: row.result_payload };
}

/** Claim and commit the idempotency key before any FMP request is allowed to start. */
export async function claimUniverseSyncCommand(
  input: UniverseSyncCommandInput,
): Promise<UniverseSyncCommandClaim> {
  return withTransaction(async (tx) => {
    const { rows: inserted } = await tx.query<UniverseSyncCommandRow>(
      `insert into rni_universe_sync_command
         (environment, idempotency_key, actor_id, correlation_id)
       values ($1, $2, $3, $4)
       on conflict (environment, idempotency_key) do nothing
       returning status, result_payload, error_message, lease_expires_at`,
      [input.environment, input.idempotencyKey, input.actorId, input.correlationId],
    );
    if (inserted[0] !== undefined) {
      await tx.query(
        `insert into audit_event
           (actor_id, actor_role, action, object_type, object_id, environment, reason,
            result, request_id, correlation_id)
         values ($1, 'admin', 'request', 'rni_universe_sync_command', $2, $3,
                 'Claim FMP universe synchronization before provider dispatch',
                 'success', $4, $5)`,
        [
          input.actorId,
          universeSyncCommandObjectId(input),
          input.environment,
          input.idempotencyKey,
          input.correlationId,
        ],
      );
      return { state: 'claimed' };
    }

    const { rows } = await tx.query<UniverseSyncCommandRow>(
      `select status, result_payload, error_message, lease_expires_at
         from rni_universe_sync_command
        where environment = $1 and idempotency_key = $2`,
      [input.environment, input.idempotencyKey],
    );
    let row = rows[0];
    if (row === undefined) throw new Error('Universe sync command conflict could not be read');
    if (row.status === 'running') {
      const { rows: abandoned } = await tx.query<UniverseSyncCommandRow>(
        `update rni_universe_sync_command
            set status = 'failed', error_message = 'UNIVERSE_SYNC_COMMAND_ABANDONED',
                lease_expires_at = null, completed_at = now()
          where environment = $1 and idempotency_key = $2 and status = 'running'
            and lease_expires_at <= now()
        returning status, result_payload, error_message, lease_expires_at`,
        [input.environment, input.idempotencyKey],
      );
      if (abandoned[0] !== undefined) {
        row = abandoned[0];
        await tx.query(
          `insert into audit_event
             (actor_id, actor_role, action, object_type, object_id, environment, reason,
              result, request_id, correlation_id, after_value)
           values ($1, 'admin', 'fail', 'rni_universe_sync_command', $2, $3,
                   'Terminalize abandoned FMP universe synchronization without redispatch',
                   'failure', $4, $5, $6)`,
          [
            input.actorId,
            universeSyncCommandObjectId(input),
            input.environment,
            input.idempotencyKey,
            input.correlationId,
            JSON.stringify({ errorMessage: 'UNIVERSE_SYNC_COMMAND_ABANDONED' }),
          ],
        );
      }
    }
    const claim = commandClaimFromRow(row);
    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          result, request_id, correlation_id, after_value)
       values ($1, 'admin', 'replay', 'rni_universe_sync_command', $2, $3,
               'Replay existing FMP universe synchronization command', $4, $5, $6, $7)`,
      [
        input.actorId,
        universeSyncCommandObjectId(input),
        input.environment,
        claim.state === 'failed' ? 'failure' : 'success',
        input.idempotencyKey,
        input.correlationId,
        JSON.stringify({ state: claim.state }),
      ],
    );
    return claim;
  });
}

export async function readUniverseSyncCommand(
  input: Pick<UniverseSyncCommandInput, 'environment' | 'idempotencyKey'>,
  db: Queryable = getPool(),
): Promise<UniverseSyncCommandClaim> {
  const { rows } = await db.query<UniverseSyncCommandRow>(
    `select status, result_payload, error_message, lease_expires_at
       from rni_universe_sync_command
      where environment = $1 and idempotency_key = $2`,
    [input.environment, input.idempotencyKey],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Universe sync command was not found');
  return commandClaimFromRow(row);
}

type CompleteUniverseSyncCommandInput = {
  readonly command: UniverseSyncCommandInput;
  readonly result: unknown;
  readonly auditResult: 'success' | 'failure';
  readonly providerCallId: string;
  readonly sourcePayloadHash: string | null;
  readonly universeVersionId: string | null;
};

async function completeUniverseSyncCommandInTransaction(
  input: CompleteUniverseSyncCommandInput,
  tx: Queryable,
): Promise<void> {
  const { rowCount } = await tx.query(
    `update rni_universe_sync_command
          set status = 'completed', result_payload = $3, provider_call_id = $4,
              source_payload_hash = $5, universe_version = $6, lease_expires_at = null,
              completed_at = now()
        where environment = $1 and idempotency_key = $2 and status = 'running'`,
    [
      input.command.environment,
      input.command.idempotencyKey,
      JSON.stringify(input.result),
      input.providerCallId,
      input.sourcePayloadHash,
      input.universeVersionId,
    ],
  );
  if (rowCount !== 1) throw new Error('Universe sync command was not running at completion');
  await tx.query(
    `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          result, request_id, correlation_id, after_value)
       values ($1, 'admin', 'complete', 'rni_universe_sync_command', $2, $3,
               'Persist terminal FMP universe synchronization outcome',
               $4, $5, $6, $7)`,
    [
      input.command.actorId,
      universeSyncCommandObjectId(input.command),
      input.command.environment,
      input.auditResult,
      input.command.idempotencyKey,
      input.command.correlationId,
      JSON.stringify({
        providerCallId: input.providerCallId,
        sourcePayloadHash: input.sourcePayloadHash,
        universeVersionId: input.universeVersionId,
      }),
    ],
  );
}

export async function completeUniverseSyncCommand(
  input: CompleteUniverseSyncCommandInput,
): Promise<void> {
  await withTransaction(async (tx) => completeUniverseSyncCommandInTransaction(input, tx));
}

export async function failUniverseSyncCommand(input: {
  readonly command: UniverseSyncCommandInput;
  readonly errorMessage: string;
  readonly providerCallId: string | null;
  readonly sourcePayloadHash: string | null;
}): Promise<void> {
  await withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      `update rni_universe_sync_command
          set status = 'failed', error_message = $3, provider_call_id = $4,
              source_payload_hash = $5, lease_expires_at = null, completed_at = now()
        where environment = $1 and idempotency_key = $2 and status = 'running'`,
      [
        input.command.environment,
        input.command.idempotencyKey,
        input.errorMessage,
        input.providerCallId,
        input.sourcePayloadHash,
      ],
    );
    if (rowCount !== 1) throw new Error('Universe sync command was not running at failure');
    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          result, request_id, correlation_id, after_value)
       values ($1, 'admin', 'fail', 'rni_universe_sync_command', $2, $3,
               'Persist failed FMP universe synchronization outcome',
               'failure', $4, $5, $6)`,
      [
        input.command.actorId,
        universeSyncCommandObjectId(input.command),
        input.command.environment,
        input.command.idempotencyKey,
        input.command.correlationId,
        JSON.stringify({
          errorMessage: input.errorMessage,
          providerCallId: input.providerCallId,
          sourcePayloadHash: input.sourcePayloadHash,
        }),
      ],
    );
  });
}

export type StageFmpUniverseMember = {
  readonly securityId: string;
  readonly providerSymbol: string;
  readonly providerCompanyName: string;
  readonly constituentFirstAddedAt: string | null;
};

export type StageFmpUniverseInput = {
  readonly environment: string;
  readonly sourceRetrievedAt: string;
  readonly sourcePayloadHash: string;
  readonly providerCallId: string;
  readonly members: readonly StageFmpUniverseMember[];
  readonly actorId: string;
  readonly requestId: string;
  readonly correlationId: string;
};

export type StageFmpUniverseOutcome = {
  readonly version: UniverseVersion;
  readonly memberCount: number;
  readonly reused: boolean;
  readonly impactPreview: {
    readonly addedSecurityIds: readonly string[];
    readonly removedSecurityIds: readonly string[];
  };
};

async function stageFmpUniverseVersionInTransaction(
  input: StageFmpUniverseInput,
  tx: Queryable,
): Promise<StageFmpUniverseOutcome> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [
    `universe-fmp-stage:${input.environment}`,
  ]);

  const requested = await tx.query(
    `select ${QUALIFIED_UNIVERSE_COLUMNS}
         from audit_event ae
         join universe_version uv on uv.id::text = ae.object_id
        where ae.environment = $1
          and ae.action = 'stage'
          and ae.object_type = 'universe_version'
          and ae.request_id = $2
        order by ae.occurred_at desc
        limit 1`,
    [input.environment, input.requestId],
  );
  const existing =
    requested.rows[0] === undefined
      ? await tx.query(
          `select ${UNIVERSE_COLUMNS}
               from universe_version
              where environment = $1 and source_provider = 'fmp' and source_payload_hash = $2`,
          [input.environment, input.sourcePayloadHash],
        )
      : requested;
  const existingRow = existing.rows[0];
  if (existingRow !== undefined) {
    const version = universeVersion.parse(camelizeRow(existingRow as Record<string, unknown>));
    const impact = version.impactPreview as {
      addedSecurityIds?: readonly string[];
      removedSecurityIds?: readonly string[];
    };
    return {
      version,
      memberCount: version.selectedCount,
      reused: true,
      impactPreview: {
        addedSecurityIds: impact.addedSecurityIds ?? [],
        removedSecurityIds: impact.removedSecurityIds ?? [],
      },
    };
  }

  const { rows: configs } = await tx.query<{ id: string }>(
    `select id from config_version where environment = $1 and status = 'active'`,
    [input.environment],
  );
  const configVersion = configs[0]?.id;
  if (configVersion === undefined) {
    throw new Error(`No active config_version in ${input.environment}`);
  }

  const { rows: activeVersions } = await tx.query<{ id: string }>(
    `select id from universe_version where environment = $1 and status = 'active'`,
    [input.environment],
  );
  const parentVersion = activeVersions[0]?.id ?? null;
  const { rows: activeMembers } =
    parentVersion === null
      ? { rows: [] as { security_id: string }[] }
      : await tx.query<{ security_id: string }>(
          `select security_id from universe_member
              where universe_version = $1 and enabled = true`,
          [parentVersion],
        );
  const priorIds = new Set(activeMembers.map(({ security_id }) => security_id));
  const nextIds = new Set(input.members.map(({ securityId }) => securityId));
  const addedSecurityIds = [...nextIds].filter((id) => !priorIds.has(id)).sort();
  const removedSecurityIds = [...priorIds].filter((id) => !nextIds.has(id)).sort();
  const impactPreview = { addedSecurityIds, removedSecurityIds };

  const { rows } = await tx.query(
    `insert into universe_version
         (environment, config_version, status, parent_version, selected_count, selection_query,
          impact_preview, source_provider, source_endpoint, source_retrieved_at,
          source_payload_hash, provider_call_id, created_by, change_reason)
       values ($1, $2, 'staged', $3, $4, $5, $6, 'fmp', '/stable/sp500-constituent',
               $7, $8, $9, $10, $11)
       returning ${UNIVERSE_COLUMNS}`,
    [
      input.environment,
      configVersion,
      parentVersion,
      input.members.length,
      JSON.stringify({ preset: 'sp500_fmp_current' }),
      JSON.stringify(impactPreview),
      input.sourceRetrievedAt,
      input.sourcePayloadHash,
      input.providerCallId,
      input.actorId,
      `Staged current S&P 500 membership from FMP (${input.sourceRetrievedAt})`,
    ],
  );
  const stagedRow = rows[0];
  if (stagedRow === undefined) throw new Error('universe_version stage insert returned no row');
  const version = universeVersion.parse(camelizeRow(stagedRow as Record<string, unknown>));

  for (const member of input.members) {
    await tx.query(
      `insert into universe_member
           (universe_version, security_id, added_by, selection_source, provider_symbol,
            provider_company_name, constituent_first_added_at)
         values ($1, $2, $3, 'fmp_sp500', $4, $5, $6)`,
      [
        version.id,
        member.securityId,
        input.actorId,
        member.providerSymbol,
        member.providerCompanyName,
        member.constituentFirstAddedAt,
      ],
    );
  }

  await tx.query(
    `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          after_value, result, request_id, correlation_id)
       values ($1, 'admin', 'stage', 'universe_version', $2, $3, $4, $5,
               'success', $6, $7)`,
    [
      input.actorId,
      version.id,
      input.environment,
      'Stage validated FMP S&P 500 candidate for human approval',
      JSON.stringify({ selectedCount: input.members.length, ...impactPreview }),
      input.requestId,
      input.correlationId,
    ],
  );

  return {
    version,
    memberCount: input.members.length,
    reused: false,
    impactPreview,
  };
}

/** Creates an immutable staged FMP snapshot. It never activates or mutates the current version. */
export async function stageFmpUniverseVersion(
  input: StageFmpUniverseInput,
): Promise<StageFmpUniverseOutcome> {
  return withTransaction(async (tx) => stageFmpUniverseVersionInTransaction(input, tx));
}

/** Stage/reuse the immutable candidate and terminalize its command in one transaction. */
export async function stageAndCompleteFmpUniverseCommand(input: {
  readonly command: UniverseSyncCommandInput;
  readonly stage: StageFmpUniverseInput;
}): Promise<StageFmpUniverseOutcome> {
  return withTransaction(async (tx) => {
    const staged = await stageFmpUniverseVersionInTransaction(input.stage, tx);
    await completeUniverseSyncCommandInTransaction(
      {
        command: input.command,
        result: { ok: true, staged },
        auditResult: 'success',
        providerCallId: input.stage.providerCallId,
        sourcePayloadHash: input.stage.sourcePayloadHash,
        universeVersionId: staged.version.id,
      },
      tx,
    );
    return staged;
  });
}

/** Record the human approval on a staged FMP snapshot without activating or altering it. */
export async function approveFmpUniverseVersion(
  environment: string,
  versionId: string,
  audit: ActivationAudit,
): Promise<UniverseVersion> {
  if (audit.actorRole !== 'admin') {
    throw new Error('FMP universe approval requires an admin actor');
  }
  return withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`universe:${environment}`]);
    const { rows } = await tx.query(
      `update universe_version
          set approved_by = $3
        where id = $1 and environment = $2 and status = 'staged'
          and source_provider = 'fmp' and approved_by is null
      returning ${UNIVERSE_COLUMNS}`,
      [versionId, environment, audit.actorId],
    );
    const approved = rows[0];
    if (approved === undefined) {
      const { rows: existing } = await tx.query(
        `select ${UNIVERSE_COLUMNS} from universe_version where id = $1 and environment = $2`,
        [versionId, environment],
      );
      const version = existing[0];
      if (version !== undefined) {
        const parsed = universeVersion.parse(camelizeRow(version as Record<string, unknown>));
        if (
          parsed.status === 'staged' &&
          parsed.sourceProvider === 'fmp' &&
          parsed.approvedBy === audit.actorId
        ) {
          return parsed;
        }
      }
      throw new Error(
        `universe_version ${versionId} is not an unapproved staged FMP version in ${environment}`,
      );
    }

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          after_value, result, request_id, correlation_id)
       values ($1, $2, 'approve', 'universe_version', $3, $4, $5, $6,
               'success', $7, $8)`,
      [
        audit.actorId,
        audit.actorRole,
        versionId,
        environment,
        audit.reason,
        JSON.stringify(approved),
        audit.requestId,
        audit.correlationId,
      ],
    );
    return universeVersion.parse(camelizeRow(approved as Record<string, unknown>));
  });
}

/**
 * Activate one immutable successor. Legacy draft membership is materialised here. FMP snapshots
 * are different: staging already materialises the reviewed membership, so activation verifies
 * the caller's IDs against that stored set and never inserts or rewrites them.
 */
export async function activateUniverseVersion(
  environment: string,
  versionId: string,
  members: readonly { securityId: string; addedBy: string; selectionSource: string }[],
  audit: ActivationAudit,
): Promise<UniverseVersion> {
  if (members.length > UNIVERSE_MAX_SYMBOLS) {
    throw new Error(
      `${members.length} members exceeds universe.max_symbols (${UNIVERSE_MAX_SYMBOLS}, D-RNI-06). The database constraint would reject this too; failing here names the limit.`,
    );
  }

  return withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`universe:${environment}`]);

    const { rows: targetRows } = await tx.query(
      `select ${UNIVERSE_COLUMNS} from universe_version
        where id = $1 and environment = $2
        for update`,
      [versionId, environment],
    );
    const targetRow = targetRows[0];
    if (targetRow === undefined) {
      throw new Error(`universe_version ${versionId} was not found in ${environment}`);
    }
    const target = universeVersion.parse(camelizeRow(targetRow as Record<string, unknown>));
    if (target.status !== 'draft' && target.status !== 'staged') {
      throw new Error(
        `universe_version ${versionId} is not a draft or staged version in ${environment}`,
      );
    }

    const previous = await tx.query(
      `select ${UNIVERSE_COLUMNS} from universe_version where environment = $1 and status = 'active'`,
      [environment],
    );
    const previousId = (previous.rows[0] as { id?: string } | undefined)?.id ?? null;
    const isFmp = target.sourceProvider === 'fmp';

    if (isFmp) {
      if (target.status !== 'staged' || target.approvedBy === null) {
        throw new Error(`FMP universe_version ${versionId} must be staged and approved first`);
      }
      if (audit.actorRole !== 'admin' || target.approvedBy !== audit.actorId) {
        throw new Error(
          `FMP universe_version ${versionId} must be activated by its recorded admin approver`,
        );
      }
      if (target.parentVersion !== previousId) {
        throw new Error(
          `FMP universe_version ${versionId} was reviewed against a stale active parent`,
        );
      }

      const { rows: storedMembers } = await tx.query<{ security_id: string }>(
        `select security_id from universe_member
          where universe_version = $1 and enabled = true
          order by security_id`,
        [versionId],
      );
      const storedIds = storedMembers.map(({ security_id }) => security_id);
      const suppliedIds = members.map(({ securityId }) => securityId).sort();
      if (
        storedIds.length !== target.selectedCount ||
        storedIds.length < 501 ||
        storedIds.length > UNIVERSE_MAX_SYMBOLS
      ) {
        throw new Error(
          `FMP universe_version ${versionId} stored membership does not match selected_count or completeness bounds`,
        );
      }
      if (
        suppliedIds.length !== storedIds.length ||
        suppliedIds.some((securityId, index) => securityId !== storedIds[index])
      ) {
        throw new Error(
          `FMP universe_version ${versionId} activation members must exactly match the reviewed staged membership`,
        );
      }
    } else {
      for (const member of members) {
        await tx.query(
          `insert into universe_member (universe_version, security_id, added_by, selection_source)
           values ($1, $2, $3, $4)
           on conflict (universe_version, security_id) do nothing`,
          [versionId, member.securityId, member.addedBy, member.selectionSource],
        );
      }
    }

    await tx.query(
      `update universe_version set status = 'superseded' where environment = $1 and status = 'active'`,
      [environment],
    );

    const { rows } = await tx.query(
      isFmp
        ? `update universe_version
              set status = 'active', activated_at = now()
            where id = $1 and environment = $2 and status = 'staged'
          returning ${UNIVERSE_COLUMNS}`
        : `update universe_version
              set status = 'active', activated_at = now(), selected_count = $3
            where id = $1 and environment = $2 and status in ('draft', 'staged')
      returning ${UNIVERSE_COLUMNS}`,
      isFmp ? [versionId, environment] : [versionId, environment, members.length],
    );

    const activated = rows[0];
    if (activated === undefined) {
      throw new Error(
        `universe_version ${versionId} is not a draft or staged version in ${environment}`,
      );
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
