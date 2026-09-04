/**
 * `WrapperDeps` for the `fetchDailyBars` call the F04 §4.3.1 market-data collector makes.
 *
 * Same shape, and the same reasoning, as `services/attention/provider-deps.ts` (F08) and
 * `services/dashboard/provider-deps.ts` (F07): the quota ledger's restart-survival table and the
 * call-log/contract-violation persistence need a migration and repository functions that are
 * SPINE's to write (`docs/progress/collect.md`), and this feature does not own that path either.
 * This is a third, narrower copy rather than an import of either of the other two — feature-scoped
 * intentionally, so a change to another feature's cost-event `feature` tag or quota shape cannot
 * silently retag this collector's own cost events. **When COLLECT/SPINE land the real, shared
 * wiring, all three copies should be replaced by it.**
 *
 * FMP's daily-bars endpoint is a flat-tier subscription (`adapters/market.ts`'s own doc:
 * "Flat-tier subscription... free at the margin per call"), so `estimatedCostUsd` is always
 * `null` and `deps.cost` is never actually invoked (`wrapper.ts` only calls it when
 * `meta.costUsd !== null`) — the cost sink below exists for completeness and to match the shape
 * `WrapperDeps` requires, not because it is expected to run.
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
 * D-15's market-data poll carries no per-provider budget *policy* of its own (F18's scope), and
 * F16a's own spec is explicit that the poll must never be gated by the budget check at all
 * ("Market-data polling is never gated by the budget check... it is the only thing that can
 * detect the next spike"). A permissive gate here is therefore not a placeholder for a future
 * policy the way the other collectors' gates are — it is the documented, permanent behaviour for
 * this one call.
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
        service: 'market_collector',
        operationOrModel: entry.operation,
        feature: 'market.collector',
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

const noopCallLog: CallLogSink = async () => {};
const noopContractViolation: ContractViolationSink = () => {};

/** Flat-tier and effectively unlimited (D-15's table) — no shared allowance to protect. */
function generousQuota(): QuotaLedger {
  return {
    reserve: async () => ({ granted: true, remaining: null }),
    release: async () => {},
  };
}

export type MarketCollectorDepsOptions = { readonly db?: Queryable };

export function marketCollectorWrapperDeps(
  options: MarketCollectorDepsOptions = {},
): Omit<WrapperDeps, 'fetcher'> {
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
