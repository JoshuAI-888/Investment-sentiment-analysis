/**
 * `WrapperDeps` for the ApeWisdom call the F08 §4.1 collector makes.
 *
 * Same shape as `services/dashboard/provider-deps.ts` (F07) — that file's own doc comment
 * explains why an interim, feature-scoped implementation exists at all rather than a shared one:
 * the quota ledger's restart-survival table and the call-log/contract-violation persistence need
 * a migration and repository functions that are SPINE's to write (`docs/progress/collect.md`),
 * and neither this feature nor F07 owns that. This is a second, narrower copy rather than an
 * import of F07's — feature-scoped intentionally, so a change to the dashboard's cost-event
 * `feature` tag or quota shape cannot silently retag this collector's own cost events. **When
 * COLLECT/SPINE land the real, shared wiring, both copies should be replaced by it.**
 *
 * ApeWisdom is free and keyless (F04 §4.3's cost-shape table; `adapters/apewisdom.ts`'s own doc),
 * so `estimatedCostUsd` is always `null` and `deps.cost` is never actually invoked
 * (`wrapper.ts` only calls it when `meta.costUsd !== null`) — the cost sink below exists for
 * completeness and to match the shape `WrapperDeps` requires, not because it is expected to run.
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
 * F18 self-review correction (caught while running the full e2e gate, not by review — see the
 * PR report). The first draft of this file classified ApeWisdom as F18 §4.1's `'optional'` work
 * — reduce-tier-gated background enrichment — by reading D-12/D-30's "ApeWisdom demoted to
 * cross-check" ruling at face value. **That ruling describes a world where the Reddit Data API
 * is the primary attention source; D-39 (2026-09-05) discarded that source for the legacy
 * product entirely.** This module's own doc comment above and `collector.ts`'s own doc comment
 * ("the attention snapshot collector — F08 §4.1... persists an `attention_snapshot` per active
 * symbol per run") say plainly what this call actually is today: **the only running attention
 * collector this codebase has.** An `attention_snapshot` row this collector fails to write is
 * D-16 permanent, unrecoverable corpus loss — exactly the failure mode
 * `services/market/provider-deps.ts`'s own permissive gate exists to prevent for the price
 * trigger, and for the identical reason. Gating this call at the `'reduce'`/`'block'` tiers would
 * silently manufacture a coverage gap in the attention corpus on every month the ledger crosses
 * $320 — for a call that is free and keyless, so the gate would not even save any money in
 * exchange. **Always allows**, matching `market/provider-deps.ts`'s own reasoning verbatim.
 * `services/degradation/catalogue.ts`'s ApeWisdom row is corrected to `critical` to match.
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
        service: 'attention_collector',
        operationOrModel: entry.operation,
        feature: 'attention.collector',
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

/** Free and keyless — no shared allowance to protect (`adapters/apewisdom.ts`'s own doc). */
function generousQuota(): QuotaLedger {
  return {
    reserve: async () => ({ granted: true, remaining: null }),
    release: async () => {},
  };
}

export type ApeWisdomDepsOptions = { readonly db?: Queryable };

export function apewisdomWrapperDeps(options: ApeWisdomDepsOptions = {}): Omit<WrapperDeps, 'fetcher'> {
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
