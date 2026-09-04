/**
 * Fakes for the wrapper's ports, all of which record what they were asked.
 *
 * The recording is the point. Several of F04's Definition-of-Done items are statements about
 * *order* — "the budget pre-check is called before every priced request", "the quota ledger
 * refuses before dispatch" — and an implementation that checked the budget last would return
 * exactly the same values as one that checked it first. Only the call sequence separates them,
 * so `trace` is what the assertions are written against.
 */
import type {
  BreakerState,
  BreakerStore,
  BudgetGate,
  CacheEntry,
  CacheStore,
  CallLogEntry,
  CallLogSink,
  Clock,
  CostEntry,
  CostSink,
  FetchRequest,
  FetchResponse,
  Fetcher,
  QuotaLedger,
  RateLimiterState,
  RateLimiterStore,
} from '@/adapters/ports';
import type { ProviderId } from '@/contracts/provider';
import type { WrapperDeps } from '@/adapters/wrapper';

export type Trace = string[];

export function fakeClock(startIso = '2026-08-30T12:00:00.000Z') {
  let current = new Date(startIso);
  const slept: number[] = [];
  const clock: Clock = {
    now: () => new Date(current),
    sleep: async (ms) => {
      slept.push(ms);
      current = new Date(current.getTime() + ms);
    },
  };
  return {
    clock,
    slept,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

export function fakeCache(trace: Trace) {
  const entries = new Map<string, CacheEntry>();
  const store: CacheStore = {
    get: async (key) => {
      trace.push('cache.get');
      return entries.get(key) ?? null;
    },
    set: async (key, entry) => {
      trace.push('cache.set');
      entries.set(key, entry);
    },
  };
  return { store, entries };
}

export function fakeQuota(trace: Trace, options: { granted?: boolean; remaining?: number | null } = {}) {
  const released: number[] = [];
  const ledger: QuotaLedger = {
    reserve: async ({ units }) => {
      trace.push(`quota.reserve:${units}`);
      if (options.granted === false) return { granted: false, resetAt: '2026-08-31T00:00:00.000Z' };
      return { granted: true, remaining: options.remaining ?? 99 };
    },
    release: async ({ units }) => {
      trace.push(`quota.release:${units}`);
      released.push(units);
    },
  };
  return { ledger, released };
}

export function fakeBudget(trace: Trace, options: { allowed?: boolean } = {}) {
  const gate: BudgetGate = {
    check: async () => {
      trace.push('budget.check');
      if (options.allowed === false) return { allowed: false, scope: 'global' };
      return { allowed: true };
    },
  };
  return gate;
}

export function fakeBreaker(trace: Trace, initial?: BreakerState) {
  const states = new Map<ProviderId, BreakerState>();
  if (initial !== undefined) states.set('fmp', initial);
  const store: BreakerStore = {
    read: async (provider) => states.get(provider) ?? null,
    write: async (provider, state) => {
      trace.push(`breaker.write:${state.openedAt === null ? 'closed' : 'open'}:${state.consecutiveFailures}`);
      states.set(provider, state);
    },
  };
  return { store, states };
}

export function fakeRateLimiter() {
  const states = new Map<ProviderId, RateLimiterState>();
  const store: RateLimiterStore = {
    read: async (provider) => states.get(provider) ?? null,
    write: async (provider, state) => {
      states.set(provider, state);
    },
  };
  return store;
}

/** Returns each queued response in turn, then repeats the last one. */
export function fakeFetcher(trace: Trace, responses: (FetchResponse | Error)[]) {
  const requests: FetchRequest[] = [];
  let index = 0;
  const fetcher: Fetcher = async (request) => {
    trace.push('fetch');
    requests.push(request);
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('fakeFetcher was given no responses');
    return next;
  };
  return { fetcher, requests, get calls() { return requests.length; } };
}

export function ok(body: unknown, headers: Record<string, string> = {}): FetchResponse {
  return { status: 200, headers, body };
}

export function status(code: number, headers: Record<string, string> = {}): FetchResponse {
  return { status: code, headers, body: { error: `status ${code}` } };
}

export type Harness = {
  deps: WrapperDeps;
  trace: Trace;
  calls: () => number;
  logs: CallLogEntry[];
  costs: CostEntry[];
  violations: { issues: string[] }[];
  released: number[];
  cacheEntries: Map<string, CacheEntry>;
  advance: (ms: number) => void;
  slept: number[];
};

export function harness(options: {
  responses?: (FetchResponse | Error)[];
  budgetAllowed?: boolean;
  quotaGranted?: boolean;
  breaker?: BreakerState;
  now?: string;
} = {}): Harness {
  const trace: Trace = [];
  const { clock, advance, slept } = fakeClock(options.now);
  const cache = fakeCache(trace);
  const quota = fakeQuota(trace, { granted: options.quotaGranted ?? true });
  const budget = fakeBudget(trace, { allowed: options.budgetAllowed ?? true });
  const breaker = fakeBreaker(trace, options.breaker);
  const fetcher = fakeFetcher(trace, options.responses ?? [ok({ value: 1 })]);

  const logs: CallLogEntry[] = [];
  const costs: CostEntry[] = [];
  const violations: { issues: string[] }[] = [];

  const callLog: CallLogSink = async (entry) => {
    trace.push('callLog');
    logs.push(entry);
  };
  const cost: CostSink = async (entry) => {
    trace.push('cost');
    costs.push(entry);
  };

  return {
    trace,
    calls: () => fetcher.calls,
    logs,
    costs,
    violations,
    released: quota.released,
    cacheEntries: cache.entries,
    advance,
    slept,
    deps: {
      fetcher: fetcher.fetcher,
      clock,
      cache: cache.store,
      quota: quota.ledger,
      budget,
      breaker: breaker.store,
      rateLimiter: fakeRateLimiter(),
      callLog,
      cost,
      onContractViolation: (violation) => {
        trace.push('contractViolation');
        violations.push({ issues: violation.issues });
      },
      // Deterministic jitter: `random` is injected precisely so a backoff test asserts an
      // exact delay instead of a range that passes by luck.
      backoff: { baseMs: 500, factor: 2, capMs: 8_000, random: () => 0.5 },
    },
  };
}
