/**
 * `WrapperDeps` for the `fetchSubstackFeed` call the Substack collector makes.
 *
 * Same shape, and the same reasoning, as `services/market/provider-deps.ts` (F04 §4.3.1) and
 * `services/attention/provider-deps.ts` (F08): the quota ledger's restart-survival table and the
 * call-log/contract-violation persistence need a migration and repository functions that are
 * SPINE's to write (`docs/progress/collect.md`), and this feature does not own that path either.
 * This is a fourth, narrower copy rather than an import of any of the other three —
 * feature-scoped intentionally, so a change to another feature's cost-event `feature` tag or
 * quota shape cannot silently retag this collector's own cost events. **When COLLECT/SPINE land
 * the real, shared wiring, all copies should be replaced by it.**
 *
 * Substack RSS is never priced (`adapters/substack.ts`'s own doc: "RSS is a flat, free poll"), so
 * `estimatedCostUsd` is always `null` and `deps.cost` is never actually invoked (`wrapper.ts` only
 * calls it when `meta.costUsd !== null`) — the cost sink below exists for completeness and to
 * match the shape `WrapperDeps` requires, not because it is expected to run.
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

/** Substack RSS carries no per-provider budget policy of its own — F18's scope, not this one's. */
function permissiveBudgetGate(): BudgetGate {
  return { check: async () => ({ allowed: true }) };
}

function costSinkOverCostEvent(db: Queryable = getPool()): CostSink {
  return async (entry) => {
    await insertCostEvent(
      {
        occurredAt: entry.occurredAt,
        provider: entry.provider,
        service: 'substack_collector',
        operationOrModel: entry.operation,
        feature: 'substack.collector',
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

/** Free and keyless — no shared allowance to protect (`adapters/substack.ts`'s own doc). */
function generousQuota(): QuotaLedger {
  return {
    reserve: async () => ({ granted: true, remaining: null }),
    release: async () => {},
  };
}

export type SubstackCollectorDepsOptions = { readonly db?: Queryable };

export function substackCollectorWrapperDeps(
  options: SubstackCollectorDepsOptions = {},
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
