/**
 * Everything the wrapper needs from the outside world, as interfaces it receives rather than
 * modules it imports.
 *
 * **This is the layer rule made structural, not a preference.** `02-ARCHITECTURE-CONTRACTS.md`
 * §3 allows `adapters` to import `contracts` and nothing else, and `layer-direction` fails the
 * build on the edge — so the wrapper cannot reach a repository to write its call log, or Redis
 * to hold its quota counter. Ports are how it does both anyway: the interfaces live here, the
 * implementations live in `services/`, where repositories and adapters may both be imported.
 *
 * The side effect is the property that makes this slice testable at all. Every stage of the
 * pipeline can be driven by a fake with no database, no Redis and no network, which is why the
 * order-of-operations tests below can assert on things — like "budget was checked before the
 * fetch" — that are otherwise only observable by reading the code and trusting it.
 */
import type { ProviderId } from '@/contracts/provider';

/** Injected so every deadline, backoff and bucket refill in the pipeline is testable. */
export type Clock = {
  now(): Date;
  /** Resolves after `ms`. Injected for the same reason `now` is: tests must not wait. */
  sleep(ms: number): Promise<void>;
};

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/** What the wrapper hands the network. A minimal slice of `fetch`, so tests need no server. */
export type FetchRequest = {
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  signal: AbortSignal;
};

export type FetchResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  /** Parsed JSON, or the raw text where the provider is not JSON (Substack RSS). */
  body: unknown;
};

export type Fetcher = (request: FetchRequest) => Promise<FetchResponse>;

/**
 * F18 owns budget *policy*; F04 owns the hook and calls it before the request (F04 §2, §4.1
 * stage 1). Until F18 lands, a permissive implementation satisfies the interface — but the
 * call site is here from the start, because a hook added after the spending starts is a hook
 * that has never prevented anything.
 */
export type BudgetGate = {
  check(input: {
    provider: ProviderId;
    endpoint: string;
    estimatedCostUsd: string | null;
  }): Promise<{ allowed: true } | { allowed: false; scope: 'account' | 'global' }>;
};

/**
 * A server-side counter per provider per UTC day (F-08, F04 §4.1 stage 2).
 *
 * `reserve` is deliberately not `check` — it decrements as it authorises. A check followed by
 * a separate decrement is a race that ends in the 429 the ledger exists to prevent, and
 * Marketaux's 100 requests/day is small enough that losing a handful to a race is a real
 * fraction of the allowance.
 */
export type QuotaLedger = {
  reserve(input: {
    provider: ProviderId;
    units: number;
    at: Date;
  }): Promise<{ granted: true; remaining: number | null } | { granted: false; resetAt: string | null }>;
  /** Returns a reservation when the call never reached the provider (breaker open, cache hit). */
  release(input: { provider: ProviderId; units: number; at: Date }): Promise<void>;
};

export type CacheEntry = {
  value: unknown;
  /** When the entry was written. Freshness is decided by the wrapper, not the store. */
  storedAt: string;
};

/** Redis in production; a Map in tests. Stale-while-revalidate is the wrapper's logic, not the store's. */
export type CacheStore = {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry): Promise<void>;
};

/** Token-bucket state per provider, held wherever the implementation likes. */
export type RateLimiterState = { tokens: number; lastRefillMs: number };

export type RateLimiterStore = {
  read(provider: ProviderId): Promise<RateLimiterState | null>;
  write(provider: ProviderId, state: RateLimiterState): Promise<void>;
};

/** Circuit-breaker state per provider (source §9.4: five consecutive failures, 60 seconds). */
export type BreakerState = {
  consecutiveFailures: number;
  /** ISO-8601, or null when the circuit has never opened or has since closed. */
  openedAt: string | null;
  /** True while a half-open probe is in flight, so only one call is spent finding out. */
  probing: boolean;
};

export type BreakerStore = {
  read(provider: ProviderId): Promise<BreakerState | null>;
  write(provider: ProviderId, state: BreakerState): Promise<void>;
};

/** One row per attempt in `provider_call_log`, written by a services-layer implementation. */
export type CallLogEntry = {
  provider: ProviderId;
  operation: string;
  requestFingerprint: string;
  statusCode: number | null;
  latencyMs: number;
  cacheStatus: string;
  itemsReturned: number | null;
  estimatedCostUsd: string;
  startedAt: Date;
  errorClass: string | null;
};

export type CallLogSink = (entry: CallLogEntry) => Promise<void>;

/** A `cost_event` row. `costUsd: null` is unpriced and stays null all the way down. */
export type CostEntry = {
  provider: ProviderId;
  operation: string;
  unitType: 'call' | 'search' | 'post_read' | 'compute_second';
  requestUnits: string;
  costUsd: string | null;
  requestId: string;
  occurredAt: Date;
};

export type CostSink = (entry: CostEntry) => Promise<void>;

/**
 * A contract violation means the provider changed shape under us, so it is logged loudly
 * (F04 §4.1 stage 8) rather than counted as an ordinary failure. It is a port because "loudly"
 * means something different in a test, in CI and in production.
 */
export type ContractViolationSink = (violation: {
  provider: ProviderId;
  endpoint: string;
  issues: string[];
  payloadRef: string | null;
}) => void;
