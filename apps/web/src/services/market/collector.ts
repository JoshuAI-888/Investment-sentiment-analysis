/**
 * The market-data collector — F04 §4.3.1 (D-15's price trigger's *input* half).
 *
 * > "Market data is polled continuously (flat-rate, so free at the margin)." — F04 §4.3.1 step 1.
 * > "The market-data poll is an ordinary clock job... It writes its observations and calls F06's
 * > registered spike method." — `../../../../docs/features/F16-scheduler-dispatcher.md` §4.1b
 * > step 2.
 *
 * This module is exactly the "writes its observations" half of that sentence, and nothing more.
 * **It does not evaluate D-15's move threshold and it does not fire a trigger.** F16's own §2
 * scope line is explicit that spike detection is "F06's registered method — this feature
 * dispatches on the verdict, it does not compute it," and the dispatch half (F16a) is a different,
 * currently-blocked feature (`docs/progress/collect.md`: blocked on MT-04). Both are out of scope
 * here — this collector only writes `market_snapshot` rows.
 *
 * **`price_return_snapshot` is also not populated here — post-review finding.** That table needs
 * baseline-price selection over a 7/30/90/180-day horizon, `adjustment_status`, `quality_status`
 * and a `method_version` (`repositories/market.ts`'s own doc) — a registered analytics method,
 * which is SPINE-owned (`calc`/`analytics`), not something this lane may build ad hoc. Trigger:
 * SPINE/F06 ships the registered method that computes it.
 *
 * Structurally this mirrors `services/attention/collector.ts`'s fetch-and-persist half as closely
 * as the domain allows, with one deliberate difference the domain forces: ApeWisdom's board is
 * **one shared provider call** covering every ticker at once, so a single provider failure aborts
 * the whole run. `fetchDailyBars` is called **once per active security** — there is no shared *call*
 * to fail — so an individual security's own bars failing to parse must never stop the loop or
 * affect any other security's result. **This is narrower than full provider-outage isolation,
 * though: `provider-deps.ts` builds one circuit breaker shared across the whole run, so enough
 * transient failures early in a run can still fail every security queued behind it — see the
 * `circuit_open` handling below, which gives that case its own honest message rather than the
 * per-security isolation claim.** Every outcome below is therefore per-security: this run either
 * wrote a snapshot for a given security, or it recorded exactly why it did not, and it always
 * finishes the full active-security list regardless of what happened to any one of them.
 *
 * **Only one bar per response is persisted, never the whole history.** `fetchDailyBars` returns
 * FMP's `historical-price-full` array, which is a genuine, multi-year back-history, not a single
 * observation the way ApeWisdom's board entry or a quote endpoint would be. Persisting every bar
 * in that array on every poll would mean re-writing years of prices on every five-minute run —
 * wasteful, and it would blur the collector's actual job (capturing what a *continuous poll*
 * observes *right now*) with a one-time backfill, which D-16 forbids attempting at all. Bars are
 * sorted by date defensively (`mostRecentBar`) rather than trusting the provider's own ordering,
 * since nothing in `adapters/market.ts`'s contract promises one — and that "one bar" is the newest
 * *already-closed* one, not always the literal newest entry; see the not-final handling below.
 */
import { D, exact } from '@/calc/decimal';
import { canonicalHash } from '@/calc/canonical';
import { env } from '@/env';
import { fetchDailyBars, type DailyBar } from '@/adapters/market';
import type { WrapperDeps } from '@/adapters/wrapper';
import type { ProviderError } from '@/contracts/provider';
import type { MarketSnapshot, Security } from '@/contracts/security';
import { getPool, type Queryable } from '@/repositories/client';
import { listActiveSecurities } from '@/repositories/security';
import { insertMarketSnapshot, type NewMarketSnapshot } from '@/repositories/market';
import { marketCollectorWrapperDeps } from './provider-deps';

/**
 * The value persisted to `market_snapshot.provider` — the vendor identity, matching the
 * repository's own integration-test convention (`tests/integration/market.test.ts`). Kept
 * distinct from `adapters/market.ts`'s internal wrapper tag `'market'`, which exists only to give
 * FMP's daily-bars poll its own rate-limit bucket, separate from FMP's scheduled fundamentals
 * calls (that file's own doc comment). The two names describe different things — a rate-limit
 * bucket and a data vendor — and collapsing them would make a future reader of `market_snapshot`
 * guess which one a stored row's `provider` column actually means.
 */
export const MARKET_DATA_PROVIDER = 'fmp';

const DAILY_BAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Post-review finding 1/2: the prior check (`DAILY_BAR_DATE.test`) validated only the *shape* of
 * the date, not its existence. `new Date("2026-13-45T00:00:00.000Z")` is `Invalid Date`, which
 * `insertMarketSnapshot` (via node-postgres's timestamp binding) throws on — uncaught, with no
 * try/catch around the per-security loop, aborting collection for every security alphabetically
 * after the offending one. `new Date("2026-02-30T00:00:00.000Z")` is worse: `Date.UTC` silently
 * *normalizes* an out-of-range day (rolling to `2026-03-02`), so it parses successfully and gets
 * persisted as a real, permanent observation on a trading day that never occurred. Round-tripping
 * the parsed components back through `getUTC*` and comparing catches both: a normalized date's
 * year/month/day disagree with what was actually asked for.
 */
function isValidCalendarDate(raw: string): boolean {
  const match = DAILY_BAR_DATE.exec(raw);
  if (match === null) return false;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return asUtc.getUTCFullYear() === year && asUtc.getUTCMonth() === month - 1 && asUtc.getUTCDate() === day;
}

/** Wall Street's own calendar, per D-31's daily-bars vendor. Trading-day boundaries fall here, not
 *  at UTC midnight — the two disagree for several hours around each UTC midnight. */
const MARKET_TIMEZONE = 'America/New_York';

/**
 * Post-review finding 3: `historical-price-full`'s newest bar, polled on a five-minute clock job
 * (F16 §4.1b) during market hours, is the **in-progress** trading day — not a completed one. This
 * collector previously persisted that partial print as `session: 'eod'` on every poll, once per
 * five minutes, which falsifies `repositories/market.ts`'s own documented guarantee that filtering
 * `session: 'eod'` yields "a genuine daily-bar series rather than a mix of intraday and end-of-day
 * prints," and churns one revision row per poll during market hours (§6.8's storage-budget
 * discipline). A bar dated `today` in the market's own calendar is therefore never persisted
 * *as today's bar*, on any poll, however late in the day — round-2 lane-review finding 2
 * corrected the rest of this note (round-3 finding 2 corrected round-2's own overstatement in
 * turn): `collectMarketSnapshots` below falls back to the newest already-fetched bar dated a
 * **prior** market day in the same response, rather than discarding the whole response, so a
 * day's close is capturable across the *entire following day* — any poll from midnight to
 * midnight, market-local — rather than only in the roughly 9.5-hour pre-market window that
 * remained before this fix. It is still captured **the day after it happens**, never the same
 * day; the trade-off that remains is narrower and different from what an earlier version of this
 * note claimed. A poll has nothing to persist only when *no* bar the provider returned is both a
 * real calendar date and dated before today — every bar dated today or later, every bar with a
 * malformed date, or some mix of the two. `en-CA` is the one built-in `Intl.DateTimeFormat` locale
 * that formats as
 * `YYYY-MM-DD` directly, matching FMP's own bar-date format with no reformatting.
 */
function marketDateString(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Picks the most recent bar by `date`, never by array position. `historical-price-full`'s real
 * response (`fixtures/market/historical_price_full/success.json`) happens to come back
 * newest-first, but nothing in `adapters/market.ts`'s contract promises an order, and trusting an
 * unstated one is exactly the kind of silent assumption this codebase's review process exists to
 * catch.
 */
export function mostRecentBar(bars: readonly DailyBar[]): DailyBar {
  const sorted = [...bars].sort((a, b) => {
    if (a.date < b.date) return 1;
    if (a.date > b.date) return -1;
    return 0;
  });
  const [first] = sorted;
  if (first === undefined) {
    throw new Error('mostRecentBar called with an empty array — callers must check length first');
  }
  return first;
}

/**
 * The exact bar values a snapshot is built from, so an unchanged poll hashes identically —
 * `repositories/market.ts#insertMarketSnapshot`'s no-op-on-repeat idempotency is keyed on this.
 * Every field is converted through the decimal layer before hashing (`calc/canonical.ts`'s
 * `canonicalizeValue` throws on a raw JS `number`, the same discipline `services/attention/
 * collector.ts`'s `snapshotRawHash` relies on for ApeWisdom's already-string fields).
 *
 * Only called after `buildMarketSnapshotInput` has confirmed every field is finite — a raw
 * `NaN`/`Infinity` reaching `exact()` would throw a `DecimalParseError` uncaught, aborting this
 * security's iteration with an unlabelled exception instead of the honest, per-security
 * `malformed_bar` outcome the caller is supposed to see.
 */
function dailyBarRawHash(bar: DailyBar): string {
  return canonicalHash({
    date: bar.date,
    open: exact(new D(bar.open)),
    high: exact(new D(bar.high)),
    low: exact(new D(bar.low)),
    close: exact(new D(bar.close)),
    volume: exact(new D(bar.volume)),
  });
}

export type MarketSnapshotInputResult =
  | { readonly ok: true; readonly input: NewMarketSnapshot }
  | { readonly ok: false; readonly reason: string };

/**
 * `session` is always `'eod'` — `adapters/market.ts`'s own doc records that D-31 runs this
 * collector on FMP Starter's **daily** bars, not an intraday tier, and `repositories/market.ts`'s
 * own doc names `'eod'` as "the Wave 1 session" for exactly this data. (Callers must not persist a
 * bar that has not actually closed yet — see `marketDateString`/the not-yet-final check in
 * `collectMarketSnapshots`, which runs before this function is called.)
 *
 * **`changePercent` is always `null` — post-review finding 5, corrected from an earlier version
 * that computed `(close - open) / open * 100` locally.** `adapters/market.ts`'s own `DailyBar`
 * schema deliberately `.strip()`s FMP's own `changePercent` field (documented there as load-bearing
 * — so a vendor field addition can't break parsing), which means the value this function used to
 * compute was never the vendor's own figure at all: it was a same-day intraday-open-to-close ratio
 * this collector invented, persisted at ~34 significant digits of spurious precision from 6-digit
 * inputs, permanently, in a table `contracts/security.ts` already makes `changePercent` nullable
 * for. Declining to compute a derived figure locally is the honest, available option — the same
 * reasoning already applied to deferring `price_return_snapshot` (a real day-over-day change is
 * SPINE's registered-method territory, not this lane's to invent ad hoc).
 */
export function buildMarketSnapshotInput(
  security: Pick<Security, 'id' | 'symbol'>,
  bar: DailyBar,
  provider: string,
): MarketSnapshotInputResult {
  if (!isValidCalendarDate(bar.date)) {
    return { ok: false, reason: `date is not a real calendar date: ${JSON.stringify(bar.date)}` };
  }

  const numericFields: ReadonlyArray<readonly [string, number]> = [
    ['open', bar.open],
    ['high', bar.high],
    ['low', bar.low],
    ['close', bar.close],
    ['volume', bar.volume],
  ];
  for (const [field, value] of numericFields) {
    if (!Number.isFinite(value)) {
      return { ok: false, reason: `${field} is not a finite number: ${JSON.stringify(value)}` };
    }
  }
  if (bar.close <= 0) {
    return { ok: false, reason: `close is not a positive number: ${JSON.stringify(bar.close)}` };
  }
  if (bar.open <= 0) {
    return { ok: false, reason: `open is not a positive number: ${JSON.stringify(bar.open)}` };
  }

  const closeDec = new D(bar.close);

  return {
    ok: true,
    input: {
      securityId: security.id,
      price: exact(closeDec),
      changePercent: null,
      session: 'eod',
      provider,
      observedAt: new Date(`${bar.date}T00:00:00.000Z`),
      rawHash: dailyBarRawHash(bar),
    },
  };
}

export type CollectedMarketSnapshotResult = {
  readonly securityId: string;
  readonly symbol: string;
  readonly snapshot: MarketSnapshot;
  /** `false` when this exact observation already existed. */
  readonly inserted: boolean;
};

export type FailedMarketSnapshotResult = {
  readonly securityId: string;
  readonly symbol: string;
  readonly reason: 'provider_error' | 'no_bars_returned' | 'malformed_bar' | 'bar_not_final' | 'unexpected_error';
  /** Present only for `reason: 'provider_error'`. */
  readonly error?: ProviderError;
  readonly message: string;
};

export type CollectMarketSnapshotsOptions = {
  readonly db?: Queryable;
  /** Injectable so a repeated test run is not at the mercy of the real clock. Stamps
   *  `ingestedAt` on every write and this outcome's own `collectedAt`; it never overrides a bar's
   *  own `observedAt`, which always comes from the bar's own `date`. */
  readonly now?: Date;
  readonly providerMode?: 'fixture' | 'live';
  readonly fixturesRoot?: string;
  /** Applied to every security's call, unless overridden per-symbol by `headersBySymbol`. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Per-symbol override of `headers`, keyed by the security's own `symbol`. Exists because a
   * fixture-mode `x-fixture-case` header would otherwise apply identically to every security this
   * run touches — `adapters/fixtures.ts`'s own doc: "case selection is out-of-band, not
   * URL-derived," so nothing about a fixture-mode request otherwise varies per security. Without
   * this, a test cannot construct a genuine partial-failure run (one security's provider call
   * succeeding while another's fails) at this level; a symbol not listed here falls back to
   * `headers`. Harmless, and unused, in `live` mode, where the fixture-case header is stripped
   * before any request is built (`adapters/fixtures.ts#createLiveFetcher`).
   */
  readonly headersBySymbol?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly deps?: Omit<WrapperDeps, 'fetcher'>;
};

export type CollectMarketSnapshotsOutcome = {
  /** When this run executed — not any individual security's `observed_at`, which is the bar's own
   *  trading date and can genuinely differ security to security or lag behind this instant. */
  readonly collectedAt: string;
  readonly results: readonly CollectedMarketSnapshotResult[];
  readonly failures: readonly FailedMarketSnapshotResult[];
};

/**
 * One collector run: for every active security, fetch its daily bars and persist the newest
 * genuinely usable one. A given security's provider failure, empty response, or response with no
 * bar dated before today produces no new snapshot **for that security only** — it neither stops
 * the loop nor touches any other security's result, and it never fabricates a value in that
 * security's place (`docs/04-BUILD-LOOP.md` §2.3's "the ugliest input" discipline, and F04's own
 * §2.1 collection boundary, applied per-security rather than per-run because that is the actual
 * failure unit here — see this module's own doc for why that differs from
 * `collectAttentionSnapshots`). `results` and `failures` are disjoint: a security appears in
 * exactly one, never both.
 *
 * **Round-4 lane-review findings 1/2/4, correcting a round-3 attempt at more than this.** Round 3
 * tried to *also* report a discarded newest bar as a `failures` entry even when an older bar was
 * found to persist in its place. Round 4 found that both incomplete (only the literal newest bar
 * was ever inspected, so an anomaly anywhere else in the same response stayed invisible) and
 * unsound (a fallback bar that later failed its own field validation could produce two
 * conflicting records for one security). Comprehensive anomaly detection across a whole response
 * is a monitoring concern this collector does not take on — its contract stays exactly "persist
 * the newest usable bar, or record honestly why none exists." A malformed or future-dated bar
 * that a valid fallback bar in the same response makes moot is therefore silently superseded, a
 * disclosed gap (`docs/progress/collect.md`'s cross-lane note), not a claim of full coverage.
 */
export async function collectMarketSnapshots(
  options: CollectMarketSnapshotsOptions = {},
): Promise<CollectMarketSnapshotsOutcome> {
  const db = options.db ?? getPool();
  const providerMode = options.providerMode ?? env.PROVIDER_MODE;
  const deps = options.deps ?? marketCollectorWrapperDeps({ db });
  const now = options.now ?? new Date();

  const securities = await listActiveSecurities(db);
  const results: CollectedMarketSnapshotResult[] = [];
  const failures: FailedMarketSnapshotResult[] = [];

  for (const security of securities) {
    // Post-review finding 1/2: every step below already returns an honest per-security failure
    // rather than throwing, but an uncaught exception anywhere in this iteration (an unparseable
    // date reaching `insertMarketSnapshot`'s timestamp binding was the concrete case that slipped
    // through before `isValidCalendarDate` closed it; a transient DB error is a second) would
    // still abort this `for` loop and silently skip every security alphabetically after it. This
    // `try`/`catch` makes the module's own doc comment ("always finishes the full active-security
    // list") a structural guarantee rather than one that happens to hold only while every step
    // inside it happens not to throw.
    try {
      const headersForSecurity = options.headersBySymbol?.[security.symbol] ?? options.headers;
      const bars = await fetchDailyBars(
        {
          symbol: security.symbol,
          ...(env.FMP_API_KEY === undefined ? {} : { apiKey: env.FMP_API_KEY }),
          ...(headersForSecurity === undefined ? {} : { headers: headersForSecurity }),
        },
        providerMode,
        {
          ...deps,
          ...(options.fixturesRoot === undefined ? {} : { fixturesRoot: options.fixturesRoot }),
        },
      );

      if (!bars.ok) {
        // Post-review finding 4: `provider-deps.ts` builds one circuit breaker per run, shared
        // across every security (it protects the run's ability to keep polling through a real
        // provider outage) — so a `circuit_open` failure here is never this security's own call
        // failing; it is every security queued behind an already-open breaker. The blanket "every
        // other security in this run is unaffected" claim is false for exactly this cause, so it
        // gets its own honest wording instead.
        const message =
          bars.error.kind === 'circuit_open'
            ? `${security.symbol}'s daily bars were not requested because the shared FMP provider ` +
              `circuit breaker is open (too many recent failures earlier in this run) — this is not ` +
              `an isolated failure of ${security.symbol}'s own call. No new market snapshot was ` +
              'persisted for this security this run.'
            : `${security.symbol}'s daily bars could not be read (${bars.error.kind}). No new ` +
              'market snapshot was persisted for this security this run; every other security in ' +
              'this run is unaffected.';
        failures.push({
          securityId: security.id,
          symbol: security.symbol,
          reason: 'provider_error',
          error: bars.error,
          message,
        });
        continue;
      }

      if (bars.data.length === 0) {
        failures.push({
          securityId: security.id,
          symbol: security.symbol,
          reason: 'no_bars_returned',
          message:
            `${security.symbol}'s provider call succeeded but returned no bars. No new market ` +
            'snapshot was persisted for this security this run.',
        });
        continue;
      }

      const latestBar = mostRecentBar(bars.data);
      const today = marketDateString(now);

      // Round-3 lane-review finding 3: the newest-by-string-date bar (`latestBar`) is used only
      // to decide *what to say* when nothing is usable — the bar actually persisted
      // (`priorFinalBar` below) is found by scanning every bar in the response, not just the
      // newest one. Applying the round-2 salvage only to a not-final newest bar and not to a
      // malformed one meant a single placeholder/garbage date sorting above a real one (e.g.
      // `"2026-13-01"` string-sorts above `"2026-08-27"`) still discarded an already-fetched,
      // genuinely final close — the exact loss round-2 finding 2 fixed for the not-final case,
      // left open here.
      //
      // **Round-4 lane-review findings 1, 2 and 4 — scope correction.** Round 3 tried to *also*
      // report the newest bar as an anomaly (`failures`) even when a `priorFinalBar` was found and
      // this run still succeeded for the security — round 4 found that design incomplete (it only
      // ever inspected the literal newest bar, never an anomalous bar buried elsewhere in the
      // response) and internally contradictory (a security could carry two conflicting
      // `malformed_bar` records, or a "success" record sitting beside a "nothing was persisted"
      // one, when the fallback bar itself later failed `buildMarketSnapshotInput`). Comprehensive
      // anomaly detection across every bar in a response is a monitoring concern, not this
      // collector's — its own contract is narrower: persist the newest genuinely usable bar, or
      // record honestly why none exists. Reverted to that narrower, coherent invariant: `results`
      // and `failures` are disjoint again, and a discarded anomalous bar with a usable fallback in
      // the same response is silently superseded, not reported. This is a real, disclosed gap
      // (see `docs/progress/collect.md`'s cross-lane note), not a fix.
      //
      // Round-5 lane-review finding 2: "the newest genuinely usable bar" above means date-usable
      // only — this filter checks `isValidCalendarDate` and the day boundary, not the field-level
      // validity `buildMarketSnapshotInput` enforces below (finite, positive open/close, etc.). A
      // response with a bad newest bar and an older bar with, say, a non-positive close will pick
      // that older bar as `priorFinalBar` and then fail it there, even if a still-older bar in the
      // same response would have parsed cleanly. Widening this filter to retry every date-valid
      // candidate in order would close that gap; not done here, since D-16's forward-only
      // guarantee means an older bar was already captured (or attempted) on a prior poll, and this
      // collector's job is the newest observation, not a backfill scan of everything in one
      // response. Disclosed, not silently assumed away.
      const priorFinalBar = [...bars.data]
        .filter((bar) => isValidCalendarDate(bar.date) && bar.date < today)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];

      if (priorFinalBar === undefined) {
        if (!isValidCalendarDate(latestBar.date)) {
          failures.push({
            securityId: security.id,
            symbol: security.symbol,
            reason: 'malformed_bar',
            message:
              `${security.symbol}'s most recent bar could not be honestly parsed: date is not a ` +
              `real calendar date: ${JSON.stringify(latestBar.date)}. No new market snapshot was ` +
              'persisted for this security this run.',
          });
        } else {
          failures.push({
            securityId: security.id,
            symbol: security.symbol,
            reason: 'bar_not_final',
            message:
              `${security.symbol}'s most recent bar (${latestBar.date}) is dated today or later ` +
              `in the market's own calendar (as of ${now.toISOString()}, market-local date ` +
              `${today}), and no earlier bar dated a prior market day was present in this ` +
              'response either — persisting it as end-of-day data would risk recording an ' +
              'in-progress session, or a date that was never a real trading day at all. No new ' +
              'market snapshot was persisted for this security this run; a bar dated a prior ' +
              'market day will be picked up on a later poll, once this provider returns one.',
          });
        }
        continue;
      }

      const built = buildMarketSnapshotInput(security, priorFinalBar, MARKET_DATA_PROVIDER);
      if (!built.ok) {
        // Round-5 lane-review finding 1: `priorFinalBar` is not always `latestBar` — when the
        // newest bar was discarded (malformed or future-dated) and this is the older fallback bar
        // found in its place, attributing the rejection to "the most recent bar" points an
        // operator at the wrong entry in the response. Naming `priorFinalBar.date` explicitly is
        // the only way to say which bar actually failed.
        failures.push({
          securityId: security.id,
          symbol: security.symbol,
          reason: 'malformed_bar',
          message:
            `${security.symbol}'s bar dated ${priorFinalBar.date} could not be honestly parsed: ` +
            `${built.reason}. No new market snapshot was persisted for this security this run.`,
        });
        continue;
      }

      const input: NewMarketSnapshot =
        options.now === undefined ? built.input : { ...built.input, ingestedAt: now };
      const write = await insertMarketSnapshot(input, db);
      results.push({
        securityId: security.id,
        symbol: security.symbol,
        snapshot: write.snapshot,
        inserted: write.inserted,
      });
    } catch (error) {
      failures.push({
        securityId: security.id,
        symbol: security.symbol,
        reason: 'unexpected_error',
        message:
          `${security.symbol}'s poll raised an unexpected error: ${error instanceof Error ? error.message : String(error)}. ` +
          'No new market snapshot was persisted for this security this run; every other security ' +
          'in this run is still processed.',
      });
    }
  }

  return { collectedAt: now.toISOString(), results, failures };
}
