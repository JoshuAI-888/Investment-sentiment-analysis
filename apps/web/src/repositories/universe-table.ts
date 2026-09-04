/**
 * F15 §4.3 — the universe selector's table read. **Zero provider calls per row** (DoD item 4):
 * every column here comes from the local security master and cached snapshots already written
 * by F04's collectors, joined in **one query** — never one query per row, which is what would
 * actually happen if this were written as a map over `listActiveSecurities()` calling a
 * per-security lookup for each of price, growth and eligibility. `LEFT JOIN LATERAL ... LIMIT 1`
 * per snapshot table gets the latest row per security without a second round trip.
 *
 * Valuation (`model-implied valuation range/gap/confidence`) is always reported
 * `not_applicable` — `valuation_snapshot` is real schema (F03, ADR-018) but nothing writes it
 * under D-19's deferral of F13, so a real read here would silently return "no rows" forever.
 * Reporting the honest reason once, in this module, is what keeps every caller from having to
 * know that on its own.
 */
import { camelizeRow } from './rows';
import { getPool, type Queryable } from './client';

export type Trend5Session = 'up' | 'down' | 'flat' | 'insufficient_history';

export type UniverseTableRow = {
  readonly securityId: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly sector: string | null;
  readonly industry: string | null;
  readonly marketCap: string | null;
  readonly marketCapCurrency: string | null;
  readonly currentPrice: string | null;
  readonly session: string | null;
  readonly priceObservedAt: string | null;
  readonly growth7d: string | null;
  readonly growth30d: string | null;
  readonly growth90d: string | null;
  readonly growth180d: string | null;
  readonly trend5Session: Trend5Session;
  /** Always `not_applicable` — see module docstring. */
  readonly valuationStatus: 'not_applicable';
  readonly dataFreshness: string | null;
  readonly eligibilityState: string | null;
  readonly eligibilityReasons: readonly string[];
  readonly isMember: boolean;
};

export type UniverseTableQuery = {
  /** Symbol prefix or name substring. Empty/undefined returns everything (paginated). */
  readonly q?: string | undefined;
  readonly sector?: string | undefined;
  readonly eligibleOnly?: boolean | undefined;
  /** Membership of this universe_version id decides `isMember` — usually a draft being edited. */
  readonly membershipOfVersion?: string | undefined;
  readonly limit: number;
  readonly offset: number;
};

const MAX_LIMIT = 500;

function trendFromPrices(prices: readonly string[]): Trend5Session {
  if (prices.length < 5) return 'insufficient_history';
  const first = Number(prices[prices.length - 1]);
  const last = Number(prices[0]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return 'insufficient_history';
  const changePercent = ((last - first) / first) * 100;
  if (changePercent > 0.01) return 'up';
  if (changePercent < -0.01) return 'down';
  return 'flat';
}

/**
 * One query. `sector`/`q` filter in SQL (indexable, server-side); `LATERAL` subqueries fetch
 * the latest row per (security, source) without a second round trip per security. Ordered by
 * symbol for deterministic pagination.
 *
 * `asOf` (D-09, F22 §4.2): every snapshot join below is bounded `observed_at <= asOf and
 * ingested_at <= asOf` (or `computed_at <= asOf` for `price_return_snapshot`, which has no
 * `ingested_at`), so this table never renders a fact that would not have been knowable at
 * `asOf` — defaults to "now" for the live admin view; the parameter exists so a future
 * PIT-correct replay of the selector has somewhere to bind.
 */
export async function queryUniverseTable(
  query: UniverseTableQuery,
  asOf: Date = new Date(),
  db: Queryable = getPool(),
): Promise<{ readonly rows: UniverseTableRow[]; readonly totalCount: number }> {
  const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT);
  const offset = Math.max(query.offset, 0);

  const conditions: string[] = ['sec.active = true'];
  const params: unknown[] = [];

  if (query.q !== undefined && query.q.trim() !== '') {
    const escaped = query.q.trim().replace(/[\\%_]/g, (char) => `\\${char}`);
    params.push(`${escaped}%`, `%${escaped}%`);
    conditions.push(`(sec.symbol ilike $${params.length - 1} or sec.name ilike $${params.length})`);
  }
  if (query.sector !== undefined && query.sector.trim() !== '') {
    params.push(query.sector);
    conditions.push(`sec.sector = $${params.length}`);
  }

  const where = conditions.join(' and ');

  const countResult = await db.query<{ count: string }>(
    `select count(*)::text as count from security sec where ${where}`,
    params,
  );
  const totalCount = Number(countResult.rows[0]?.count ?? '0');

  params.push(query.membershipOfVersion ?? null);
  const membershipParamIndex = params.length;
  params.push(asOf);
  const asOfParamIndex = params.length;
  params.push(limit, offset);

  const eligibleFilter = query.eligibleOnly === true ? "and prof.eligibility_state = 'ready'" : '';

  const { rows } = await db.query(
    `select
        sec.id as security_id, sec.symbol, sec.name, sec.exchange, sec.sector, sec.industry,
        prof.market_cap, prof.market_cap_currency, prof.eligibility_state, prof.eligibility_reasons,
        prof.ingested_at as profile_ingested_at,
        mkt.price as current_price, mkt.session, mkt.observed_at as price_observed_at,
        mkt.ingested_at as market_ingested_at,
        r7.total_return as growth_7d, r30.total_return as growth_30d,
        r90.total_return as growth_90d, r180.total_return as growth_180d,
        trend.prices as trend_prices,
        (member.security_id is not null) as is_member
       from security sec
       left join lateral (
         select market_cap, market_cap_currency, eligibility_state, eligibility_reasons, ingested_at
           from security_profile_snapshot p
          where p.security_id = sec.id
            and p.observed_at <= $${asOfParamIndex} and p.ingested_at <= $${asOfParamIndex}
          order by p.observed_at desc, p.ingested_at desc
          limit 1
       ) prof on true
       left join lateral (
         select price, session, observed_at, ingested_at
           from market_snapshot m
          where m.security_id = sec.id
            and m.observed_at <= $${asOfParamIndex} and m.ingested_at <= $${asOfParamIndex}
          order by m.observed_at desc, m.ingested_at desc
          limit 1
       ) mkt on true
       left join lateral (
         select total_return from price_return_snapshot pr
          where pr.security_id = sec.id and pr.horizon_calendar_days = 7
            and pr.computed_at <= $${asOfParamIndex}
          order by pr.as_of_date desc, pr.computed_at desc limit 1
       ) r7 on true
       left join lateral (
         select total_return from price_return_snapshot pr
          where pr.security_id = sec.id and pr.horizon_calendar_days = 30
            and pr.computed_at <= $${asOfParamIndex}
          order by pr.as_of_date desc, pr.computed_at desc limit 1
       ) r30 on true
       left join lateral (
         select total_return from price_return_snapshot pr
          where pr.security_id = sec.id and pr.horizon_calendar_days = 90
            and pr.computed_at <= $${asOfParamIndex}
          order by pr.as_of_date desc, pr.computed_at desc limit 1
       ) r90 on true
       left join lateral (
         select total_return from price_return_snapshot pr
          where pr.security_id = sec.id and pr.horizon_calendar_days = 180
            and pr.computed_at <= $${asOfParamIndex}
          order by pr.as_of_date desc, pr.computed_at desc limit 1
       ) r180 on true
       left join lateral (
         select coalesce(array_agg(x.price order by x.observed_at desc), '{}') as prices
           from (
             select price, observed_at from market_snapshot m2
              where m2.security_id = sec.id and m2.session = 'eod'
                and m2.observed_at <= $${asOfParamIndex} and m2.ingested_at <= $${asOfParamIndex}
              order by m2.observed_at desc
              limit 5
           ) x
       ) trend on true
       left join universe_member member
         on member.security_id = sec.id and member.universe_version = $${membershipParamIndex}
        and member.enabled = true
      where ${where} ${eligibleFilter}
      order by sec.symbol
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  const mapped = rows.map((raw) => {
    const row = camelizeRow(raw as Record<string, unknown>);
    const profileIngestedAt = row['profileIngestedAt'] as Date | null;
    const marketIngestedAt = row['marketIngestedAt'] as Date | null;
    const freshnessCandidates = [profileIngestedAt, marketIngestedAt].filter(
      (d): d is Date => d !== null && d !== undefined,
    );
    const dataFreshness =
      freshnessCandidates.length === 0
        ? null
        : new Date(Math.max(...freshnessCandidates.map((d) => d.getTime()))).toISOString();

    const trendPrices = (row['trendPrices'] as string[] | null) ?? [];

    return {
      securityId: row['securityId'] as string,
      symbol: row['symbol'] as string,
      name: row['name'] as string,
      exchange: row['exchange'] as string,
      sector: (row['sector'] as string | null) ?? null,
      industry: (row['industry'] as string | null) ?? null,
      marketCap: (row['marketCap'] as string | null) ?? null,
      marketCapCurrency: (row['marketCapCurrency'] as string | null) ?? null,
      currentPrice: (row['currentPrice'] as string | null) ?? null,
      session: (row['session'] as string | null) ?? null,
      priceObservedAt: row['priceObservedAt'] === null || row['priceObservedAt'] === undefined
        ? null
        : new Date(row['priceObservedAt'] as Date).toISOString(),
      growth7d: (row['growth7d'] as string | null) ?? null,
      growth30d: (row['growth30d'] as string | null) ?? null,
      growth90d: (row['growth90d'] as string | null) ?? null,
      growth180d: (row['growth180d'] as string | null) ?? null,
      trend5Session: trendFromPrices(trendPrices),
      valuationStatus: 'not_applicable' as const,
      dataFreshness,
      eligibilityState: (row['eligibilityState'] as string | null) ?? null,
      eligibilityReasons: (row['eligibilityReasons'] as string[] | null) ?? [],
      isMember: Boolean(row['isMember']),
    };
  });

  return { rows: mapped, totalCount };
}
