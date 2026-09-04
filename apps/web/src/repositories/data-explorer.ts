/**
 * F15 §4.5 — sanitized payload inspection for admins. Reads `raw_provider_payload` only; never
 * writes it (F04/F20 own that table's writers). Every function here enforces, in SQL, the three
 * hard rules the spec names: **rights-restricted rows are not returned at all** (not returned
 * and redacted — actually absent, so a caller cannot forget to check a flag), **retention-expired
 * rows are excluded**, and **results are size-limited** (a hard cap, not merely a default).
 */
import { rawProviderPayload, type RawProviderPayload } from '../contracts/operations';
import { camelizeRow } from './rows';
import { getPool, type Queryable } from './client';

const COLUMNS =
  'id, provider, operation, job_run_id, research_run_id, security_id, request_fingerprint, http_status, sanitized_payload, payload_hash, content_class, redaction_status, rights_status, parser_version, data_as_of, ingested_at, retention_until';

/**
 * `internal_only` and `blocked` payloads are excluded by the query itself (not filtered in
 * application code after the fact) — F15 §4.5: "rights-restricted payloads are not shown at
 * all, with the restriction named." The restriction is named separately by
 * `countRestrictedPayloads` below, for the explorer to render *that* a restriction applied
 * without ever fetching the row it applied to.
 */
const VIEWABLE_RIGHTS = ['display_permitted', 'not_established'] as const;

export type DataExplorerQuery = {
  readonly provider?: string | undefined;
  readonly securityId?: string | undefined;
  readonly contentClass?: string | undefined;
  readonly asOf: Date;
  readonly limit?: number | undefined;
};

/** Hard cap. Not a default — a caller cannot ask for more. */
const HARD_ROW_LIMIT = 200;

export async function searchRawProviderPayloads(
  query: DataExplorerQuery,
  db: Queryable = getPool(),
): Promise<RawProviderPayload[]> {
  const conditions: string[] = [
    `rights_status = any($1)`,
    // Retention-aware: an expired row is excluded, not merely flagged (F15 §4.5).
    `retention_until > $2`,
  ];
  const params: unknown[] = [VIEWABLE_RIGHTS as unknown as string[], query.asOf];

  function eq(column: string, value: string | undefined) {
    if (value === undefined) return;
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  }
  eq('provider', query.provider);
  eq('security_id', query.securityId);
  eq('content_class', query.contentClass);

  const limit = Math.min(Math.max(query.limit ?? 50, 1), HARD_ROW_LIMIT);
  params.push(limit);

  const { rows } = await db.query(
    `select ${COLUMNS} from raw_provider_payload
      where ${conditions.join(' and ')}
      order by ingested_at desc
      limit $${params.length}`,
    params,
  );
  return rows.map((row) => rawProviderPayload.parse(camelizeRow(row as Record<string, unknown>)));
}

export type RestrictedCount = {
  readonly rightsBlocked: number;
  readonly retentionExpired: number;
};

/**
 * How many rows the same filter excluded, and why — so the explorer can say "3 payloads
 * withheld: rights" rather than silently returning fewer rows than a reader would expect.
 */
export async function countRestrictedPayloads(
  query: Omit<DataExplorerQuery, 'limit'>,
  db: Queryable = getPool(),
): Promise<RestrictedCount> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  function eq(column: string, value: string | undefined) {
    if (value === undefined) return;
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  }
  eq('provider', query.provider);
  eq('security_id', query.securityId);
  eq('content_class', query.contentClass);
  const extra = conditions.length > 0 ? `and ${conditions.join(' and ')}` : '';

  params.push(query.asOf);
  const asOfIndex = params.length;

  const { rows } = await db.query<{ rights_blocked: string; retention_expired: string }>(
    `select
        count(*) filter (where rights_status not in ('display_permitted', 'not_established'))::text
          as rights_blocked,
        count(*) filter (where rights_status in ('display_permitted', 'not_established')
                            and retention_until <= $${asOfIndex})::text
          as retention_expired
       from raw_provider_payload
      where true ${extra}`,
    params,
  );
  const row = rows[0];
  return {
    rightsBlocked: Number(row?.rights_blocked ?? '0'),
    retentionExpired: Number(row?.retention_expired ?? '0'),
  };
}
