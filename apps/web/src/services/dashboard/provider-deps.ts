/**
 * `WrapperDeps` for the two adapters `refresh.ts` calls (`fetchDailyBars`, `fetchMarketauxNews`).
 *
 * **No shared, repository-backed implementation of these ports exists anywhere in the tree
 * yet.** `docs/progress/collect.md` records why: the quota ledger's restart-survival table, the
 * call-log and contract-violation persistence all need a migration and repository functions
 * that are SPINE's to write, and F04 explicitly left that wiring "out of this lane's reach"
 * rather than guess at it. This file is a narrower, interim implementation scoped to this
 * feature's own refresh path — it consumes only what already exists
 * (`repositories/cost.ts#insertCostEvent`, already merged) and never touches `repositories/`
 * itself. **When COLLECT/SPINE land the real, shared wiring, this should be replaced by it
 * rather than kept alongside it** — flagged under this feature's `CONTRACTS`/`RISKS` report so
 * that move isn't lost.
 *
 * What is real here: cost accounting (`insertCostEvent`) and a Redis-backed daily quota count
 * for Marketaux's 100-request/day free tier, so a dashboard refresh cannot silently exhaust a
 * quota shared with production (`04-BUILD-LOOP.md` §2.3: "live calls burn quota shared with
 * production"). What is a deliberately inert stand-in: the cache (always a miss — never serves
 * a stale read, just never speeds one up either), the breaker and rate-limiter stores
 * (in-process only, acceptable because a single refresh's adapter calls all happen inside one
 * process lifetime), and the call log / contract-violation sinks (both already an accepted gap
 * elsewhere in this codebase for the identical reason).
 */
import { systemClock } from '@/adapters/ports';
import type {
  BreakerState,
  BudgetGate,
  CacheEntry,
  CallLogSink,
  ContractViolationSink,
  CostSink,
  QuotaLedger,
  RateLimiterState,
} from '@/adapters/ports';
import type { WrapperDeps } from '@/adapters/wrapper';
import type { ProviderId } from '@/contracts/provider';
import { insertCostEvent } from '@/repositories/cost';
import { getPool, type Queryable } from '@/repositories/client';
import type { RedisClient } from './redis';
import { KEYS } from './redis';

/** Marketaux's free-tier daily allowance (`docs/DEPLOY.md`'s provider table). */
export const MARKETAUX_DAILY_QUOTA = 100;

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function inMemoryCache() {
  const store = new Map<string, CacheEntry>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, entry: CacheEntry) => {
      store.set(key, entry);
    },
  };
}

function inMemoryBreaker() {
  const store = new Map<string, BreakerState>();
  return {
    read: async (provider: ProviderId) => store.get(provider) ?? null,
    write: async (provider: ProviderId, state: BreakerState) => {
      store.set(provider, state);
    },
  };
}

function inMemoryRateLimiter() {
  const store = new Map<string, RateLimiterState>();
  return {
    read: async (provider: ProviderId) => store.get(provider) ?? null,
    write: async (provider: ProviderId, state: RateLimiterState) => {
      store.set(provider, state);
    },
  };
}

/**
 * The finer-grained per-provider budget gate. Always allows: the coarse global-ceiling check
 * (`budget.ts`) already ran once, before the refresh's internal job was ever dispatched, and
 * per-provider budget *policy* (as opposed to the pre-dispatch hook) is F18's scope, not F07's —
 * `02-ARCHITECTURE-CONTRACTS.md` §4.1 documents the hook existing ahead of the policy that
 * governs it for exactly this reason.
 */
function permissiveBudgetGate(): BudgetGate {
  return { check: async () => ({ allowed: true }) };
}

function costSinkOverCostEvent(db: Queryable = getPool()): CostSink {
  return async (entry) => {
    await insertCostEvent(
      {
        occurredAt: entry.occurredAt,
        provider: entry.provider,
        service: 'dashboard',
        operationOrModel: entry.operation,
        feature: 'dashboard.refresh',
        jobRunId: null,
        researchRunId: null,
        userId: null,
        requestId: entry.requestId,
        unitType: entry.unitType,
        requestUnits: entry.requestUnits,
        billableUnits: entry.requestUnits,
        unitPrice: null,
        currency: 'USD',
        priceBookVersion: null,
        costUsd: entry.costUsd,
        costStatus: entry.costUsd === null ? 'unpriced' : 'actual',
        cacheStatus: 'miss',
        metadata: {},
      },
      db,
    );
  };
}

/** A no-op sink for both — an accepted gap, matching F04's own current state (`MEMORY.md` B-18 area). */
const noopCallLog: CallLogSink = async () => {};
const noopContractViolation: ContractViolationSink = () => {};

/**
 * A Redis-backed daily counter for Marketaux only — `market`/FMP's flat tier has no comparable
 * shared constraint to protect (`fetchDailyBars` is never priced and the FMP Starter tier is
 * "effectively unlimited calls", D-15's table).
 */
function marketauxQuota(redis: RedisClient | undefined): QuotaLedger {
  return {
    reserve: async ({ at }) => {
      if (redis === undefined) return { granted: true, remaining: null };
      const key = KEYS.marketauxQuotaDay(dayKey(at));
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 90_000);
      if (count > MARKETAUX_DAILY_QUOTA) return { granted: false, resetAt: null };
      return { granted: true, remaining: MARKETAUX_DAILY_QUOTA - count };
    },
    release: async () => {
      // A released reservation is not decremented back — Marketaux's own quota is shared with
      // production and F02's send-cap makes the identical call for the identical reason: an
      // exact release-then-reuse would let a caller retry into using more than the allowance
      // ever really permits inside one window.
    },
  };
}

function generousQuota(): QuotaLedger {
  return {
    reserve: async () => ({ granted: true, remaining: null }),
    release: async () => {},
  };
}

export type ProviderDepsOptions = {
  readonly redis?: RedisClient;
  readonly db?: Queryable;
};

export function marketWrapperDeps(options: ProviderDepsOptions): Omit<WrapperDeps, 'fetcher'> {
  return {
    clock: systemClock,
    cache: inMemoryCache(),
    quota: generousQuota(),
    budget: permissiveBudgetGate(),
    breaker: inMemoryBreaker(),
    rateLimiter: inMemoryRateLimiter(),
    callLog: noopCallLog,
    cost: costSinkOverCostEvent(options.db),
    onContractViolation: noopContractViolation,
  };
}

export function marketauxWrapperDeps(options: ProviderDepsOptions): Omit<WrapperDeps, 'fetcher'> {
  return {
    clock: systemClock,
    cache: inMemoryCache(),
    quota: marketauxQuota(options.redis),
    budget: permissiveBudgetGate(),
    breaker: inMemoryBreaker(),
    rateLimiter: inMemoryRateLimiter(),
    callLog: noopCallLog,
    cost: costSinkOverCostEvent(options.db),
    onContractViolation: noopContractViolation,
  };
}
