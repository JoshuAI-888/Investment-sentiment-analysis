/**
 * Generic `audit_event` writer and reader (F15 §4.1 step 8, §4.5).
 *
 * Every other writer in `repositories/` (`artifacts.ts#insertReplayAuditEvent`, `retention.ts`,
 * `versions.ts`) hand-writes its own tailored `insert into audit_event` for its own action —
 * correct for those call sites, which each know exactly what they are auditing, but F15's
 * uniform mutation contract (`services/admin/mutation.ts`) is the opposite case: one code path
 * that must audit an object type it does not know ahead of time. This is the generic function
 * `services/dashboard/refresh.ts`'s F07-era comment named as missing (`MEMORY.md`, reported
 * under F07's `CONTRACTS`). It is additive — every hand-written insert above is untouched.
 */
import { auditEvent, type AuditEvent } from '../contracts/cost';
import { camelizeRow } from './rows';
import { getPool, type Queryable } from './client';

const COLUMNS =
  'id, occurred_at, actor_id, actor_role, action, object_type, object_id, environment, reason, before_value, after_value, result, request_id, correlation_id, ip_hash, user_agent, approval, rollback_of';

export type NewAuditEvent = {
  readonly actorId: string;
  readonly actorRole: string;
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly environment: string;
  readonly reason: string;
  readonly beforeValue: unknown;
  readonly afterValue: unknown;
  readonly result: 'success' | 'failure' | 'rejected';
  readonly requestId: string;
  readonly correlationId: string;
  readonly ipHash?: string | null;
  readonly userAgent?: string | null;
  readonly approval?: unknown;
  readonly rollbackOf?: string | null;
};

export async function insertAuditEvent(
  event: NewAuditEvent,
  db: Queryable = getPool(),
): Promise<AuditEvent> {
  const { rows } = await db.query(
    `insert into audit_event
       (actor_id, actor_role, action, object_type, object_id, environment, reason,
        before_value, after_value, result, request_id, correlation_id, ip_hash, user_agent,
        approval, rollback_of)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     returning ${COLUMNS}`,
    [
      event.actorId,
      event.actorRole,
      event.action,
      event.objectType,
      event.objectId,
      event.environment,
      event.reason,
      event.beforeValue === undefined || event.beforeValue === null ? null : JSON.stringify(event.beforeValue),
      event.afterValue === undefined || event.afterValue === null ? null : JSON.stringify(event.afterValue),
      event.result,
      event.requestId,
      event.correlationId,
      event.ipHash ?? null,
      event.userAgent ?? null,
      event.approval === undefined || event.approval === null ? null : JSON.stringify(event.approval),
      event.rollbackOf ?? null,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insert into audit_event returned no row');
  return auditEvent.parse(camelizeRow(row as Record<string, unknown>));
}

export type AuditEventQuery = {
  readonly objectType?: string | undefined;
  readonly objectId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly action?: string | undefined;
  readonly environment?: string | undefined;
  readonly result?: 'success' | 'failure' | 'rejected' | undefined;
  /** Cursor: strictly-before this instant, for reverse-chronological paging. */
  readonly before?: Date | undefined;
  readonly limit?: number | undefined;
};

const AUDIT_LIST_MAX = 200;

/** F15 §4.6/§4.8's audit tab. Reverse-chronological, server-side filtered and paginated. */
export async function listAuditEvents(
  query: AuditEventQuery,
  db: Queryable = getPool(),
): Promise<AuditEvent[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  function eq(column: string, value: string | undefined) {
    if (value === undefined) return;
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  }

  eq('object_type', query.objectType);
  eq('object_id', query.objectId);
  eq('actor_id', query.actorId);
  eq('action', query.action);
  eq('environment', query.environment);
  eq('result', query.result);
  if (query.before !== undefined) {
    params.push(query.before);
    conditions.push(`occurred_at < $${params.length}`);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
  const limit = Math.min(Math.max(query.limit ?? 50, 1), AUDIT_LIST_MAX);
  params.push(limit);

  const { rows } = await db.query(
    `select ${COLUMNS} from audit_event ${where} order by occurred_at desc, id desc limit $${params.length}`,
    params,
  );
  return rows.map((row) => auditEvent.parse(camelizeRow(row as Record<string, unknown>)));
}
