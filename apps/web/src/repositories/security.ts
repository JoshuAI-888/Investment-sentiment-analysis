/** The security master. SQL lives here and nowhere else (F03 DoD item 9). */
import {
  security,
  securityProfileSnapshot,
  type Security,
  type SecurityProfileSnapshot,
} from '../contracts/security';
import { camelizeRow, insertClause, type Row } from './rows';
import { getPool, type Queryable } from './client';
import { asOf } from './as-of';

const COLUMNS =
  'id, symbol, name, exchange, asset_type, sector, industry, cik, currency, active, aliases, created_at, updated_at';

export type NewSecurity = Omit<Security, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export async function insertSecurity(input: NewSecurity, db: Queryable = getPool()): Promise<Security> {
  // `aliases` is a `jsonb` column, and `insertClause` (`rows.ts`) passes values straight through
  // as query parameters with no JSON serialization. node-postgres then renders a JS array as a
  // Postgres *array literal* — `{}` for an empty array, `{a,b}` for a non-empty one. Cast to
  // `jsonb`, `{}` parses as an empty *object* (so `security.parse` fails with "expected array,
  // received object") and `{a,b}` is not valid JSON at all (so Postgres rejects the insert).
  // Two different failures, one cause.
  //
  // Every other repository in this codebase already `JSON.stringify`s its jsonb columns before
  // calling `insertClause`; this function was the one that did not. It was found and documented
  // by F07 (`services/dashboard/ensure-securities.ts`) and worked around at six call sites with
  // `aliases: '[]' as unknown as string[]` casts, because `repositories/` was not those lanes' to
  // edit. Fixed here instead, and those casts removed.
  const { columns, placeholders, values } = insertClause({
    ...input,
    aliases: JSON.stringify(input.aliases ?? []),
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
      (eligibilityBySecurityId.get(match.id) as SecurityProfileSnapshot['eligibilityState'] | undefined) ??
      null,
  }));
}
