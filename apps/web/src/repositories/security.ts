/** The security master. SQL lives here and nowhere else (F03 DoD item 9). */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import {
  security,
  securityProfileSnapshot,
  type Security,
  type SecurityProfileSnapshot,
} from '../contracts/security';
import { camelizeRow, insertClause, type Row } from './rows';
import { getPool, withTransaction, type Queryable } from './client';
import { asOf } from './as-of';

const COLUMNS =
  'id, symbol, name, exchange, asset_type, sector, industry, cik, currency, active, aliases, created_at, updated_at';

export type NewSecurity = Omit<Security, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export async function insertSecurity(
  input: NewSecurity,
  db: Queryable = getPool(),
): Promise<Security> {
  // node-postgres serialises JavaScript arrays as PostgreSQL arrays (`{...}`), which JSONB
  // accepts as an object-shaped value. Bind the canonical JSON text explicitly so aliases
  // round-trip as the array required by the frozen security contract. Older internal fixtures
  // passed pre-encoded JSON around the historical bug; decode that compatibility form once.
  const aliases = z
    .array(z.string())
    .parse(typeof input.aliases === 'string' ? JSON.parse(input.aliases) : input.aliases);
  const { columns, placeholders, values } = insertClause({
    ...input,
    aliases: JSON.stringify(aliases),
  });
  const { rows } = await db.query(
    `insert into security (${columns}) values (${placeholders}) returning ${COLUMNS}`,
    values,
  );
  return security.parse(camelizeRow(rows[0] as Record<string, unknown>));
}

/**
 * Resolution is by `(symbol, exchange)` and returns the surrogate key. Callers hold the uuid
 * from then on: a ticker is an attribute with validity, and resolving it once at the boundary
 * is what stops it leaking into a foreign key.
 */
export async function findSecurityBySymbol(
  symbol: string,
  exchange: string,
  db: Queryable = getPool(),
): Promise<Security | null> {
  const { rows } = await db.query(
    `select ${COLUMNS} from security where symbol = $1 and exchange = $2`,
    [symbol, exchange],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return security.parse(camelizeRow(row as Record<string, unknown>));
}

export async function findSecurityById(
  id: string,
  db: Queryable = getPool(),
): Promise<Security | null> {
  const { rows } = await db.query(`select ${COLUMNS} from security where id = $1`, [id]);
  const row = rows[0];
  if (row === undefined) return null;
  return security.parse(camelizeRow(row as Record<string, unknown>));
}

export async function listActiveSecurities(db: Queryable = getPool()): Promise<Security[]> {
  const { rows } = await db.query(
    `select ${COLUMNS} from security where active = true order by symbol`,
  );
  return rows.map((row) => security.parse(camelizeRow(row as Record<string, unknown>)));
}

export const fmpSecurityMasterSnapshot = z
  .object({
    source: z.literal('fmp_profile_export'),
    sourceEndpoint: z.literal('/stable/profile'),
    retrievedAt: z.string().datetime({ offset: true }),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    securities: z
      .array(
        z
          .object({
            symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/u),
            name: z.string().min(1),
            exchange: z.string().min(1),
            sector: z.string().min(1).nullable(),
            industry: z.string().min(1).nullable(),
            cik: z.string().min(1).nullable(),
            currency: z.string().length(3),
          })
          .strict(),
      )
      .min(501)
      .max(600),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const symbols = snapshot.securities.map(({ symbol }) => symbol);
    if (new Set(symbols).size !== symbols.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['securities'],
        message: 'FMP security-master import symbols must be unique',
      });
    }
    if (!symbols.includes('NVDA')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['securities'],
        message: 'FMP security-master import must contain NVDA',
      });
    }
    const computedHash = createHash('sha256')
      .update(JSON.stringify(snapshot.securities), 'utf8')
      .digest('hex');
    if (computedHash !== snapshot.payloadSha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payloadSha256'],
        message: 'payloadSha256 must match the exact ordered securities export',
      });
    }
  });
export type FmpSecurityMasterSnapshot = z.infer<typeof fmpSecurityMasterSnapshot>;

export type FmpSecurityMasterImportResult = {
  readonly importId: string;
  readonly importedCount: number;
  readonly reusedCount: number;
  readonly replayed: boolean;
};

/**
 * Import a human-reviewed, hash-bound FMP profile export into the one canonical security master.
 * Existing identities are reused only when symbol/exchange/CIK are compatible; conflicts abort
 * the whole transaction instead of creating an ambiguous second catalogue.
 */
export async function importFmpSecurityMasterSnapshot(
  input: {
    readonly environment: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly snapshot: FmpSecurityMasterSnapshot;
  },
  poolOverride?: pg.Pool,
): Promise<FmpSecurityMasterImportResult> {
  const snapshot = fmpSecurityMasterSnapshot.parse(input.snapshot);
  return withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', ['rni-security-master-import']);
    const { rows: prior } = await tx.query<{
      id: string;
      imported_count: number;
      reused_count: number;
    }>(
      `select id, imported_count, reused_count
         from rni_security_master_import
        where environment = $1 and source_payload_hash = $2`,
      [input.environment, snapshot.payloadSha256],
    );
    const replay = prior[0];
    if (replay !== undefined) {
      await tx.query(
        `insert into audit_event
           (actor_id, actor_role, action, object_type, object_id, environment, reason,
            result, request_id, correlation_id, after_value)
         values ($1, 'admin', 'replay', 'rni_security_master_import', $2, $3,
                 'Replay reviewed FMP security-master import by payload hash',
                 'success', $4, $5, $6)`,
        [
          input.actorId,
          replay.id,
          input.environment,
          input.idempotencyKey,
          input.correlationId,
          JSON.stringify({
            importedCount: replay.imported_count,
            reusedCount: replay.reused_count,
            payloadSha256: snapshot.payloadSha256,
          }),
        ],
      );
      return {
        importId: replay.id,
        importedCount: replay.imported_count,
        reusedCount: replay.reused_count,
        replayed: true,
      };
    }

    let importedCount = 0;
    let reusedCount = 0;
    const members: Array<{
      readonly securityId: string;
      readonly sourceOrdinal: number;
      readonly candidate: FmpSecurityMasterSnapshot['securities'][number];
    }> = [];
    for (const [sourceOrdinal, candidate] of snapshot.securities.entries()) {
      const { rows } = await tx.query(
        `select ${COLUMNS} from security where symbol = $1 order by exchange`,
        [candidate.symbol],
      );
      const matches = rows.map((row) => security.parse(camelizeRow(row as Row)));
      const exact = matches.find(({ exchange }) => exchange === candidate.exchange);
      if (exact !== undefined) {
        if (!exact.active || exact.assetType !== 'equity') {
          throw new Error(
            `Security ${candidate.symbol}@${candidate.exchange} is not an active equity`,
          );
        }
        if (exact.cik !== null && candidate.cik !== null && exact.cik !== candidate.cik) {
          throw new Error(
            `Security ${candidate.symbol}@${candidate.exchange} has conflicting CIK identity`,
          );
        }
        reusedCount += 1;
        members.push({ securityId: exact.id, sourceOrdinal, candidate });
        continue;
      }
      if (matches.length > 0) {
        throw new Error(
          `Security ${candidate.symbol} already exists on a different exchange; import requires human resolution`,
        );
      }
      const inserted = await insertSecurity(
        {
          symbol: candidate.symbol,
          name: candidate.name,
          exchange: candidate.exchange,
          assetType: 'equity',
          sector: candidate.sector,
          industry: candidate.industry,
          cik: candidate.cik,
          currency: candidate.currency,
          active: true,
          aliases: [],
        },
        tx,
      );
      importedCount += 1;
      members.push({ securityId: inserted.id, sourceOrdinal, candidate });
    }

    const { rows: imports } = await tx.query<{ id: string }>(
      `insert into rni_security_master_import
         (environment, source_endpoint, source_retrieved_at, source_payload_hash,
          imported_count, reused_count, imported_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        input.environment,
        snapshot.sourceEndpoint,
        snapshot.retrievedAt,
        snapshot.payloadSha256,
        importedCount,
        reusedCount,
        input.actorId,
      ],
    );
    const importId = imports[0]?.id;
    if (importId === undefined) throw new Error('Security-master import returned no identity');
    for (const member of members) {
      await tx.query(
        `insert into rni_security_master_import_member
           (import_id, security_id, source_ordinal, provider_symbol,
            provider_company_name, provider_exchange, provider_cik)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          importId,
          member.securityId,
          member.sourceOrdinal,
          member.candidate.symbol,
          member.candidate.name,
          member.candidate.exchange,
          member.candidate.cik,
        ],
      );
    }
    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          result, request_id, correlation_id, after_value)
       values ($1, 'admin', 'import', 'rni_security_master_import', $2, $3,
               'Import reviewed FMP profile export into canonical security master',
               'success', $4, $5, $6)`,
      [
        input.actorId,
        importId,
        input.environment,
        input.idempotencyKey,
        input.correlationId,
        JSON.stringify({ importedCount, reusedCount, payloadSha256: snapshot.payloadSha256 }),
      ],
    );
    return { importId, importedCount, reusedCount, replayed: false };
  }, poolOverride);
}

const PROFILE_COLUMNS =
  'security_id, provider, market_cap, market_cap_currency, sector_raw, industry_raw, sector_canonical, industry_canonical, eligibility_state, eligibility_reasons, observed_at, ingested_at, raw_hash';

export async function insertSecurityProfileSnapshot(
  input: Record<string, unknown>,
  db: Queryable = getPool(),
) {
  const { columns, placeholders, values } = insertClause(input);
  const { rows } = await db.query(
    `insert into security_profile_snapshot (${columns}) values (${placeholders}) returning ${PROFILE_COLUMNS}`,
    values,
  );
  return securityProfileSnapshot.parse(camelizeRow(rows[0] as Record<string, unknown>));
}

// ── search (F09 §4.5) ────────────────────────────────────────────────────────────────────────

export type SecuritySearchResult = {
  readonly id: Security['id'];
  readonly symbol: Security['symbol'];
  readonly name: Security['name'];
  readonly exchange: Security['exchange'];
  readonly assetType: Security['assetType'];
  /** `null` when no `security_profile_snapshot` has been observed yet as of `asOfInstant`. */
  readonly eligibilityState: SecurityProfileSnapshot['eligibilityState'] | null;
};

const SEARCH_LIMIT_DEFAULT = 20;

/**
 * Escapes Postgres `LIKE`/`ILIKE` metacharacters (`%`, `_`, and the escape character itself,
 * `\`) in user input before it is wrapped into a pattern and interpolated as a bound parameter.
 *
 * Parameterization alone stops SQL injection, but a bound parameter is still interpreted *as a
 * pattern* once it reaches `ilike` — it does not stop **pattern** injection. Per-keystroke input
 * from F09 §4.5's search box is exactly the case this matters for: typing a bare `%` would
 * otherwise build the pattern `ilike '%%'`, matching every active security in the table, and
 * typing `_` would match every symbol of a given length — both presented to the user as if they
 * were real matches for what they typed (lane-review finding 5). Escaping first, then wrapping in
 * the caller's own `%…%`/`…%`, keeps a literal `%` or `_` typed by a user meaning exactly that.
 */
function escapeLikeMetacharacters(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * F09 §4.5: `GET /api/search?q=` over the local security master — "no provider call per
 * keystroke". Everything here is a plain read of already-stored rows; nothing in this function
 * reaches an adapter.
 *
 * A prefix match on `symbol` (how a ticker is actually typed) and a substring match on `name`
 * (how a company is actually typed), restricted to `active` securities — F09 §4.1 already
 * refuses an *inactive* symbol resolution with a stated reason, and search should not surface a
 * result that resolution would then refuse.
 *
 * Eligibility is read separately, through `security_profile_snapshot` — a bitemporal table — via
 * `asOf`, one batched call rather than N, and merged in application code rather than joined in
 * SQL. This is deliberate: `asOf` only knows how to bound a single table, and building the join
 * by hand here would mean writing the bitemporal bound (`observed_at <= $x and ingested_at <=
 * $x`) a second time outside the one module that owns it (F22 §4.2) — exactly the duplication
 * `no-unbounded-pit-read` (armed on `repositories/`) exists to catch, so this function stays
 * inside the pattern rather than routing around it.
 */
export async function searchSecurities(
  query: { readonly q: string; readonly asOfInstant: Date; readonly limit?: number },
  db: Queryable = getPool(),
): Promise<SecuritySearchResult[]> {
  const trimmed = query.q.trim();
  if (trimmed === '') return [];
  const escaped = escapeLikeMetacharacters(trimmed);

  const limit = query.limit ?? SEARCH_LIMIT_DEFAULT;
  const { rows } = await db.query(
    `select ${COLUMNS} from security
     where active = true and (symbol ilike $1 or name ilike $2)
     order by (case when symbol ilike $1 then 0 else 1 end), symbol
     limit $3`,
    [`${escaped}%`, `%${escaped}%`, limit],
  );
  const matches = rows.map((row) => security.parse(camelizeRow(row as Row)));
  if (matches.length === 0) return [];

  const securityIds = matches.map((match) => match.id);
  const profileRows = await asOf<Row>(
    {
      table: 'security_profile_snapshot',
      asOfInstant: query.asOfInstant,
      columns: 'distinct on (security_id) security_id, eligibility_state, observed_at, ingested_at',
      where: 'security_id = any($2)',
      params: [securityIds],
      orderBy: 'security_id, observed_at desc, ingested_at desc',
      limit: securityIds.length,
    },
    db,
  );
  const eligibilityBySecurityId = new Map(
    profileRows.map((row) => [row['security_id'] as string, row['eligibility_state'] as string]),
  );

  return matches.map((match) => ({
    id: match.id,
    symbol: match.symbol,
    name: match.name,
    exchange: match.exchange,
    assetType: match.assetType,
    eligibilityState:
      (eligibilityBySecurityId.get(match.id) as
        | SecurityProfileSnapshot['eligibilityState']
        | undefined) ?? null,
  }));
}
