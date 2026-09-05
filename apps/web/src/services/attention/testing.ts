/**
 * Test-only F08 leaderboard state seeding, over the *real* pipeline. **Never reachable outside
 * `PROVIDER_MODE=fixture`** — the route calling this (`app/api/social/reddit/e2e-seed/route.ts`)
 * 404s in every other mode, the same guard F02/F07 already established.
 *
 * **Unlike F07's own `testing.ts`, this one does not bypass the registry arithmetic.** F07 had
 * to: its committed provider fixtures (2 daily bars, 2 articles) cannot reach `price.regime`'s
 * 21-bar floor, and this lane may not edit COLLECT's fixtures to make them. F08's collector has
 * no such ceiling — its inputs are `attention_snapshot` rows this module inserts directly via
 * the same repository the real collector writes through
 * (`repositories/attention.ts#insertAttentionSnapshot`) — so every seeded state here is computed
 * by the real `attention.*` methods against real, controlled history, via
 * `materializeAttentionMetricsForSecurity` (`pipeline.ts`), the identical function a real
 * collector run calls.
 *
 * **Idempotent by construction, with no SQL of its own beyond the repository calls above.**
 * `no-sql-outside-repositories` (F01) forbids a raw query in `services/` outright — correctly,
 * since a bitemporal read here would be invisible to `no-unbounded-pit-read` — so this module
 * cannot `DELETE` a prior seed's rows to reset state between calls, the way an ordinary test
 * fixture might.
 *
 * **Anchored to the real clock, and seeded at most once per underlying dataset — lane-review
 * finding 5's own consequence, corrected by round 3 finding 2.** An earlier version of this
 * module anchored every observation at a fixed 2020 date so a repeat call would be a safe no-op.
 * That collided with finding 5's read-time staleness check (`leaderboard.ts`): every row would
 * read as hours-old-by-years the moment it was fixed, which is honest but not what an *e2e
 * fixture* needs. Anchoring to `new Date()` instead keeps every seeded row genuinely fresh for as
 * long as one test run lasts (well under `attention.rank_change`'s six-hour floor) — but a
 * *second* `POST .../e2e-seed { state: 'fresh' }` against the same still-populated
 * `attention_snapshot` rows must not insert a brand-new "today" row for a security that already
 * has one, or a security seeded to have no local predecessor at all (`BBBY`, the `NEW` case)
 * would gain one purely from the first call's own leftover row.
 *
 * The check for that is against **Postgres directly** (`attentionSnapshotHistory`, in the seeding
 * loop below) — never against whether the `security` row itself was just created, and never
 * against whether Redis already has a pointer. An earlier version used both as proxies, on the
 * reasoning that a pre-existing `security` row implied pre-existing `attention_snapshot` rows and
 * a pre-existing Redis pointer implied nothing had changed underneath it. `tests/e2e/global-
 * setup.ts`'s one-time truncate of `attention_snapshot` (round 3 finding 2) breaks exactly that
 * assumption: it leaves `security` rows (and, when the same server process survives across
 * separate local invocations, Redis's in-memory pointers) untouched while removing the
 * observations they were standing in for — so a security whose row pre-dates this call, or whose
 * pointer is already set, is no longer reliably a security whose `attention_snapshot` rows still
 * exist. Checking Postgres directly is correct regardless of which of those two things happened
 * to survive, and materializing unconditionally (see the loop's own comment) is what keeps a
 * stale pointer from ever describing an observation that no longer exists.
 */
import { activateConfigVersion, findActiveConfigVersion, insertConfigVersion } from '@/repositories/versions';
import { findSecurityBySymbol, insertSecurity, type NewSecurity } from '@/repositories/security';
import { attentionSnapshotHistory, insertAttentionSnapshot, type NewAttentionSnapshot } from '@/repositories/attention';
import { getPool } from '@/repositories/client';
import { APEWISDOM_METHODOLOGY_VERSION, APEWISDOM_WINDOW_HOURS } from './collector';
import { ATTENTION_CONFIG_ENVIRONMENT, materializeAttentionMetricsForSecurity } from './pipeline';
import { KEYS, type RedisClient } from './redis';

export type AttentionSeedState =
  | 'fresh'
  | 'unavailable'
  | 'degraded'
  | 'stale'
  | 'degraded_no_new_data'
  | 'never_collected_malformed';

const AUDIT = {
  actorId: 'e2e-seed',
  actorRole: 'system',
  reason: 'F08 e2e seed',
  requestId: 'e2e-seed',
  correlationId: 'e2e-seed',
};

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * DAY_MS);
}

async function ensureConfigVersion(): Promise<string> {
  const existing = await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT);
  if (existing !== null) return existing.id;
  const draft = await insertConfigVersion({
    environment: ATTENTION_CONFIG_ENVIRONMENT,
    createdBy: 'e2e-seed',
    changeReason: 'F08 e2e seed',
    checksum: 'e2e-seed',
  });
  const activated = await activateConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, draft.id, AUDIT);
  return activated.id;
}

type EnsuredSecurity = { readonly id: string };

/**
 * Whether this security's row is new or pre-existing is no longer this function's concern —
 * lane-review round 3 finding 2 moved that question to the only place it can be answered
 * correctly (whether Postgres has an `attention_snapshot` row, checked directly in the seeding
 * loop below), since a `security` row surviving across separate e2e invocations is no longer a
 * reliable proxy for its `attention_snapshot` rows having survived too.
 */
async function ensureSecurity(symbol: string, name: string): Promise<EnsuredSecurity> {
  const existing = await findSecurityBySymbol(symbol, 'NASDAQ');
  if (existing !== null) return { id: existing.id };
  const input: NewSecurity = {
    symbol,
    name,
    exchange: 'NASDAQ',
    assetType: 'equity',
    sector: null,
    industry: null,
    cik: null,
    currency: 'USD',
    active: true,
    // **A real bug in `insertSecurity` (`repositories/security.ts`), already reported under
    // F07's `CONTRACTS`** (`services/dashboard/ensure-securities.ts`'s own doc has the full
    // mechanism): `insertClause` passes a JS array straight through as a query parameter with no
    // JSON serialization, so node-postgres encodes it as a Postgres array literal rather than
    // JSON — which happens to parse back as `{}` (an empty *object*) for `[]` and fails outright
    // for a non-empty array. Passing the JSON text directly, exactly as F07's workaround does,
    // is the narrowest fix reachable from this lane — `insertSecurity` itself is SPINE's to fix.
    aliases: [],
  };
  try {
    const inserted = await insertSecurity(input);
    return { id: inserted.id };
  } catch (error) {
    // Lane-review round 4 finding 4. `security_symbol_exchange_unique`
    // (`migrations/0002_security_and_market.sql`) correctly rejects a second concurrent insert
    // for the same `(symbol, exchange)` — that is Postgres doing its job, not a bug. The bug was
    // this function not catching that rejection: two concurrent `e2e-seed` callers racing past
    // the `findSecurityBySymbol` check above would previously 500 instead of both resolving to
    // the one row that actually exists, exactly the race `ensure-securities.ts`'s own
    // `ensureSectorProxySecurities` already documents and avoids by staying sequential — this
    // path can't avoid the race the same way (two independent HTTP requests, not one loop), so it
    // catches the constraint violation and re-reads instead.
    const isUniqueViolation = typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
    if (!isUniqueViolation) throw error;
    const retried = await findSecurityBySymbol(symbol, 'NASDAQ');
    if (retried === null) throw error;
    return { id: retried.id };
  }
}

type SnapshotSpec = {
  readonly rank: number | null;
  readonly rankPrior: number | null;
  readonly mentions: number;
  readonly mentionsPrior: number | null;
  readonly engagement: number | null;
  readonly observedAt: Date;
  readonly rawHash: string;
  readonly providerMethodologyVersion?: string;
};

/** Returns whether this exact observation was newly written — see this module's own doc. */
async function seedSnapshot(securityId: string, spec: SnapshotSpec): Promise<boolean> {
  const input: NewAttentionSnapshot = {
    securityId,
    source: 'apewisdom',
    rank: spec.rank,
    rankPrior: spec.rankPrior,
    mentions: spec.mentions,
    mentionsPrior: spec.mentionsPrior,
    engagement: spec.engagement,
    windowHours: APEWISDOM_WINDOW_HOURS,
    coverageClass: 'pov_index',
    providerMethodologyVersion: spec.providerMethodologyVersion ?? APEWISDOM_METHODOLOGY_VERSION,
    observedAt: spec.observedAt,
    ingestedAt: spec.observedAt,
    rawHash: spec.rawHash,
  };
  const result = await insertAttentionSnapshot(input);
  return result.inserted;
}

type SeedSecurity = {
  readonly id: string;
  readonly symbol: string;
  readonly specs: readonly SnapshotSpec[];
};

/**
 * Every scenario F08's DoD names, seeded at once: a security with ≥14 days of comparable
 * history (the z-score becomes visible), one with only two prior days — still a real local
 * predecessor, so the delta is genuinely `'own_history'` and captioned "this deployment's own
 * comparison — warm-up window", never "provider-defined" (`tests/e2e/attention.spec.ts`'s own
 * assertion pins this; round-41 lane-review finding 1 corrected this comment, which previously
 * claimed the opposite) — only below the depth-14 floor, so the z-score itself stays hidden, one
 * genuinely new to the board (no prior anywhere — `NEW`), one below the thin-sample floor
 * (excluded from notable), and one whose newest observation crosses a
 * `provider_methodology_version` boundary (`not_applicable`).
 */
export async function seedAttentionFresh(redis: RedisClient): Promise<void> {
  const now = new Date();
  const configVersion = await ensureConfigVersion();
  const db = getPool();

  const gme = await ensureSecurity('GME', 'GameStop Corp.');
  const amc = await ensureSecurity('AMC', 'AMC Entertainment Holdings');
  const bbby = await ensureSecurity('BBBY', 'Bed Bath & Beyond Inc.');
  const thnq = await ensureSecurity('THNQ', 'Thinly Traded Co.');
  const mvbd = await ensureSecurity('MVBD', 'Moved Boundary Corp.');

  const deepHistorySpecs: SnapshotSpec[] = [];
  for (let day = 14; day >= 1; day -= 1) {
    deepHistorySpecs.push({
      rank: 20 + day,
      rankPrior: 21 + day,
      mentions: 400 + day * 10,
      mentionsPrior: 390 + day * 10,
      engagement: 5000,
      observedAt: daysAgo(now, day),
      rawHash: `gme-${String(day)}`,
    });
  }
  deepHistorySpecs.push({
    rank: 3,
    rankPrior: 5,
    mentions: 1200,
    mentionsPrior: 900,
    engagement: 8000,
    observedAt: now,
    rawHash: 'gme-today',
  });

  const securities: SeedSecurity[] = [
    { id: gme.id, symbol: 'GME', specs: deepHistorySpecs },
    {
      id: amc.id,
      symbol: 'AMC',
      // Only two comparable days before today — below the depth-14 floor.
      specs: [
        {
          rank: 40,
          rankPrior: 42,
          mentions: 200,
          mentionsPrior: 180,
          engagement: 1200,
          observedAt: daysAgo(now, 2),
          rawHash: 'amc-2',
        },
        {
          rank: 35,
          rankPrior: 40,
          mentions: 260,
          mentionsPrior: 200,
          engagement: 1500,
          observedAt: daysAgo(now, 1),
          rawHash: 'amc-1',
        },
        {
          rank: 30,
          rankPrior: 35,
          mentions: 300,
          mentionsPrior: 260,
          engagement: 1800,
          observedAt: now,
          rawHash: 'amc-today',
        },
      ],
    },
    {
      id: bbby.id,
      symbol: 'BBBY',
      // The only observation this deployment has ever recorded for it — genuinely new.
      specs: [
        {
          rank: 88,
          rankPrior: null,
          mentions: 60,
          mentionsPrior: null,
          engagement: 300,
          observedAt: now,
          rawHash: 'bbby-today',
        },
      ],
    },
    {
      id: thnq.id,
      symbol: 'THNQ',
      // Below F08 §4.4's thin-sample floor (current mentions < 5).
      specs: [
        {
          rank: 97,
          rankPrior: 96,
          mentions: 3,
          mentionsPrior: 4,
          engagement: 10,
          observedAt: daysAgo(now, 1),
          rawHash: 'thnq-1',
        },
        {
          rank: 98,
          rankPrior: 97,
          mentions: 2,
          mentionsPrior: 3,
          engagement: 5,
          observedAt: now,
          rawHash: 'thnq-today',
        },
      ],
    },
    {
      id: mvbd.id,
      symbol: 'MVBD',
      // The newest observation carries a different methodology version than its predecessor.
      specs: [
        {
          rank: 55,
          rankPrior: 60,
          mentions: 150,
          mentionsPrior: 140,
          engagement: 900,
          observedAt: daysAgo(now, 1),
          rawHash: 'mvbd-1',
          providerMethodologyVersion: 'apewisdom-2026-08',
        },
        {
          rank: 50,
          rankPrior: 55,
          mentions: 170,
          mentionsPrior: 150,
          engagement: 950,
          observedAt: now,
          rawHash: 'mvbd-today',
          providerMethodologyVersion: 'apewisdom-2026-09',
        },
      ],
    },
  ];

  await redis.del(KEYS.notableMovers());

  for (const security of securities) {
    // Whether Postgres genuinely has any observation for this security at all — never `isNew`
    // (whether the *security row* was just created) as a stand-in for it. Lane-review round 3
    // finding 2's own consequence: `tests/e2e/global-setup.ts` truncates `attention_snapshot`
    // once before the whole e2e suite runs, but `security` rows (and, when the same server
    // process survives across separate local invocations, Redis's in-memory pointers) are not
    // touched by that truncate — so a security whose `security` row pre-dates this call is not
    // reliably a security whose `attention_snapshot` rows still exist. Checking Postgres directly
    // is the only way this module's own "seed once per underlying dataset" rule (this module's
    // top doc — a *second* "today" row would change what a fixture like `BBBY`'s `NEW` case
    // means) survives that truncate rather than silently reading `ok` as `unavailable`.
    const hasAnyRow = (await attentionSnapshotHistory({ securityId: security.id, source: 'apewisdom', asOfInstant: now, limit: 1 }, db)).length > 0;
    if (!hasAnyRow) {
      for (const spec of security.specs) {
        await seedSnapshot(security.id, spec);
      }
    }

    // Always materialized, never gated on whether Redis already has a pointer. An earlier version
    // of this loop skipped materializing whenever *this* Redis already had a pointer for this
    // security, reasoning that recomputing unchanged data was merely redundant work. That
    // reasoning stops holding the moment the underlying `attention_snapshot` rows can change out
    // from under an unchanged Redis pointer (exactly what the truncate above does to a pointer
    // left over from an earlier process lifetime): a stale pointer would keep resolving — to a
    // `calculation_snapshot` row this module never truncates — while describing an observation
    // that no longer exists, rendering real but *wrong* numbers rather than failing loudly.
    // Recomputing is cheap, storage-only and safe to repeat (`compute.ts`'s deterministic
    // `calculationId`, lane-review round-1 finding 3 and round-3 finding 1), so there is no
    // remaining reason to skip it.
    await materializeAttentionMetricsForSecurity({
      securityId: security.id,
      symbol: security.symbol,
      configVersion,
      db,
      redis,
      now,
    });
  }

  await redis.set(KEYS.lastCollectedAt(), now.toISOString());
  await redis.set(KEYS.degraded(), JSON.stringify(false));
  // Round-13 lane-review finding 4's own reproduction, discovered via the e2e stress suite
  // (`--repeat-each=2`): `seedAttentionDegraded` (below) reuses this function and never itself
  // touched `degradedReason`, so a stale `'no_new_data'`/`'provider_contract_changed'` value left
  // over from an earlier test's seed in the same server process (Redis's in-memory fallback is
  // one singleton per process, not per-test — this file's own long-standing doc on
  // `seedAttentionUnavailable`) silently survived into the *next* run's "classic outage" scenario,
  // making the page suppress `DegradedPanel` for a test that specifically asserts it renders.
  // Cleared here, the one seed every other degraded-flavoured seed in this module builds on.
  await redis.del(KEYS.degradedReason());
  // Round-38 lane-review finding 3, widened by round-39 lane-review finding 2 (this seed alone
  // does not cover `seedAttentionUnavailable`/`seedAttentionStale`, which do not build on it —
  // both carry their own identical clear). `seedAttentionNeverCollectedMalformed` (below) sets
  // this key and nothing in this module ever cleared it, so it would otherwise leak into every
  // later seed sharing the same server process's in-memory Redis fallback (one singleton per
  // process, not per-test) — a subsequent test in this file's serial run, or on CI's `retries: 1`
  // an earlier one, would render a banner for a security their own assertions never account for.
  await redis.del(KEYS.malformedTickers());
}

/**
 * Clears this feature's own Redis bookkeeping keys and ensures a genuine cold start — nothing
 * more. **This alone does not, and cannot, make the leaderboard read `unavailable` — lane-review
 * round 3 finding 2, correcting an implication left over from round 2.** Since round 2's fix,
 * `assembleAttentionLeaderboard` decides `unavailable` from Postgres
 * (`listActiveSecurities`/`latestAttentionSnapshot`), not from whether `KEYS.lastCollectedAt()`
 * happens to be set — and this module, like every other `services/` module, has no repository
 * function to delete an `attention_snapshot` row (there genuinely is none: D-16's forward-only
 * collection gives the application layer no legitimate reason to remove a real observation) and
 * could not make Postgres empty even if it tried.
 *
 * What actually makes the e2e cold-start test's "nothing has ever been collected" premise true is
 * external to this function: `tests/e2e/global-setup.ts` truncates `attention_snapshot` once
 * before the whole e2e suite runs, and `tests/e2e/attention.spec.ts` runs file-wide in serial,
 * declaration order, so the cold-start test always executes before either seeded state ever
 * writes a row. This function's own job is narrower and still real: clearing `degraded`/
 * `notableMovers`/`lastCollectedAt` so a *different* test's earlier seed in the same server
 * process (Redis's in-memory fallback is one singleton per process, not per-test) cannot leak
 * those specific fields into this read, even once Postgres emptiness is what decides the overall
 * page state.
 *
 * **`ensureConfigVersion()` — round-46 lane-review finding, surfaced by giving each
 * `unavailableReason` its own heading.** This function never activated one, and — being declared
 * and run first in the suite's serial order, before any other seed's own `ensureConfigVersion()`
 * call — that meant `activeConfig` was genuinely `null` for the whole "cold start" test, every
 * time it ran: `unavailableReason` read `'no_active_config_version'`, not the `'never_collected'`
 * this test's own name and assertions have always assumed. Both branches used to render identical
 * copy, which is exactly why nothing caught the mismatch until round 44/45/46 gave the config-gap
 * branch its own compound message and heading. A *genuine* cold start — the calc kernel
 * configured, the collector simply never having run — has an active config version; the
 * config-gap branch is a distinct, later fault (a version superseded with none to replace it) that
 * still has no e2e coverage of its own — reaching it needs a `deactivateConfigVersion` repository
 * function this module cannot add (`src/repositories/` is SPINE-owned; a needed repository change
 * is reported to the coordinator, not built here). **Round-47 lane-review finding 3: this request
 * was in fact recorded** — `docs/progress/spine.md`'s "Requested by another lane" table, on the
 * coordinator's own state branch, which per this build's lane-ownership practice
 * (`docs/06-PARALLEL-LANES.md`) is never edited from a feature branch and so is not visible from
 * a review of this branch alone. Naming the specific file from inside a feature branch reads as a
 * coverage claim this branch cannot itself verify; stated only as what it is here instead.
 */
export async function seedAttentionUnavailable(redis: RedisClient): Promise<void> {
  await ensureConfigVersion();
  await redis.del(KEYS.lastCollectedAt());
  await redis.del(KEYS.degraded());
  await redis.del(KEYS.degradedReason());
  await redis.del(KEYS.notableMovers());
  // Round-39 lane-review finding 2: this seed does not build on `seedAttentionFresh`, so round
  // 38's own `KEYS.malformedTickers()` clear there does not cover it — a leaked
  // `never_collected_malformed` seed earlier in the same server process's serial run (Redis's
  // in-memory fallback is one singleton per process, not per-test) would otherwise render the
  // never-collected-malformed banner over what this state's own tests assert is a genuine cold
  // start with nothing collected.
  await redis.del(KEYS.malformedTickers());
}

/**
 * Round-10 lane-review finding 3's own reproduction: the collector was healthy and *did* run —
 * unlike `seedAttentionDegraded`, this is not a provider outage — it just has not run recently.
 * Every row's own `observedAt` is pinned ten hours in the past (past `attention.rank_change`'s
 * six-hour staleness floor), so by the time an e2e test reads the page, `pageState` reads
 * `'stale'` (round 9 lane-review finding 3's own state, distinct from `'degraded'`) and every row
 * is individually stale too — which round 9 finding 2 correctly excludes from
 * `selectNotableMovers`, leaving `notableMovers: []` for a reason `NotableMovers` must now state
 * accurately rather than blaming §4.4's ordinary bar. A genuine comparable prior is seeded
 * alongside the stale "current" reading so `rank_change` computes as `eligibility: 'ok'` with a
 * real, large magnitude — proving the row would have qualified as a notable mover *but for*
 * staleness, not that it was excluded for an unrelated reason that happens to produce the same
 * empty list.
 */
export async function seedAttentionStale(redis: RedisClient): Promise<void> {
  const configVersion = await ensureConfigVersion();
  const db = getPool();
  const stal = await ensureSecurity('STAL', 'Stale Board Corp.');

  const staleAt = new Date(Date.now() - 10 * 60 * 60 * 1000);
  const priorAt = daysAgo(staleAt, 1);

  const hasAnyRow = (await attentionSnapshotHistory({ securityId: stal.id, source: 'apewisdom', asOfInstant: staleAt, limit: 1 }, db)).length > 0;
  if (!hasAnyRow) {
    await seedSnapshot(stal.id, {
      rank: 50,
      rankPrior: 55,
      mentions: 300,
      mentionsPrior: 280,
      engagement: 2000,
      observedAt: priorAt,
      rawHash: 'stal-prior',
    });
    await seedSnapshot(stal.id, {
      rank: 10,
      rankPrior: 50,
      mentions: 400,
      mentionsPrior: 300,
      engagement: 3000,
      observedAt: staleAt,
      rawHash: 'stal-current',
    });
  }

  await materializeAttentionMetricsForSecurity({ securityId: stal.id, symbol: 'STAL', configVersion, db, redis, now: staleAt });

  await redis.set(KEYS.lastCollectedAt(), staleAt.toISOString());
  await redis.set(KEYS.degraded(), JSON.stringify(false));
  await redis.del(KEYS.degradedReason());
  await redis.del(KEYS.notableMovers());
  // Round-39 lane-review finding 2 — see `seedAttentionUnavailable`'s identical fix above for why
  // this seed, which also does not build on `seedAttentionFresh`, needs its own clear.
  await redis.del(KEYS.malformedTickers());
}

/** Reuses the fresh seed's rows, then marks the last run as failed — F08 §4.5's degraded mode. */
export async function seedAttentionDegraded(redis: RedisClient): Promise<void> {
  await seedAttentionFresh(redis);
  await redis.set(KEYS.degraded(), JSON.stringify(true));
}

/**
 * Round-13 lane-review finding 4's own reproduction: `degraded` for a reached-but-unusable
 * provider response (round 11/12's `'no_new_data'`/`'provider_contract_changed'` causes), not a
 * fetch failure. Proves the page suppresses `DegradedPanel`'s "a provider is currently
 * unavailable" claim for this cause — false here — while still stating the accurate reason.
 */
export async function seedAttentionDegradedNoNewData(redis: RedisClient): Promise<void> {
  await seedAttentionFresh(redis);
  await redis.set(KEYS.degraded(), JSON.stringify(true));
  await redis.set(KEYS.degradedReason(), 'no_new_data');
}

/**
 * Round-37 lane-review finding 3's own reproduction: `neverCollectedMalformedSymbols`
 * (round-36 lane-review finding 1) had no test at any level that actually rendered the page-level
 * banner it drives — every prose fragment in it is bounded by a `{…}` interpolation, so
 * `check:copy`'s JSX-text extraction never reaches it either. `MLFD` is `ensureSecurity`d with no
 * `attention_snapshot` row at all — a security whose board entries have never once parsed — and
 * `KEYS.malformedTickers()` is set by hand to the same durable record `pipeline.ts` writes on a
 * real partially-malformed run, so this seed proves the banner *and* an otherwise-ordinary board
 * (`state: 'ok'`, from the reused fresh seed) render correctly on the same page.
 */
export async function seedAttentionNeverCollectedMalformed(redis: RedisClient): Promise<void> {
  await seedAttentionFresh(redis);
  await ensureSecurity('MLFD', 'Never Parsed Corp.');
  await redis.set(KEYS.malformedTickers(), JSON.stringify(['MLFD']));
}
