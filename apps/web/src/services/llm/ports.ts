/**
 * `ModelClient` — the provider-neutral LLM boundary named in `02-ARCHITECTURE-CONTRACTS.md`
 * §4.6 and D-21. F10 is the first (and, in v1, the only) consumer: relevance filtering and
 * ticker-collision disambiguation are the two LLM methods v1 permits — never a stance number
 * (D-13). Stance stays F20's, produced by a pinned, reproducible classifier off the request
 * path; nothing in this module classifies stance and nothing in it may be called from `calc/` or
 * `analytics/` (both forbid I/O — `docs/04-BUILD-LOOP.md` §5's "Any LLM import in an analytics
 * module?" question).
 *
 * **Why this lives under `services/llm/`, not `adapters/`.** `adapters/` speaks HTTP-JSON
 * provider semantics — quota ledgers, response caching, a circuit breaker keyed on consecutive
 * upstream failures. An LLM classify call needs none of that shape (there is no per-provider
 * daily quota to ledger, no cacheable GET, no meaningful "breaker" distinct from an ordinary
 * retry).
 *
 * **Why this does not reuse `adapters/ports.ts`'s `BudgetGate`/`CostSink`/`CallLogSink`.** Those
 * three are keyed on `contracts/provider.ts`'s `ProviderId`, and a first attempt at adding an
 * `'llm'` member there broke `adapters/rate-limit.ts`'s exhaustive
 * `Record<ProviderId, BucketConfig>` (COLLECT-owned) — that enum is not append-only from every
 * consumer's point of view. Rather than edit a path this lane does not own to accommodate a
 * cross-cutting union, this module defines its own budget/cost/call-log port shapes below,
 * structurally identical in spirit to ARCH §4.6's requirement — *"every call ... subject to the
 * pre-dispatch budget check"* and *"recorded to `cost_event` with `costUsd` or `null`"* — but
 * keyed on `ModelTask` instead of `ProviderId`. Reported as a contract request in this feature's
 * build report: if F04/SPINE later want these flowing through the same tables as every other
 * provider, that is a `contracts/provider.ts` change made by whoever owns the downstream
 * exhaustive consumers too.
 *
 * **The retry-once-then-drop discipline lives one layer up, in the caller.** `ModelClient.
 * classify` makes exactly one model call and reports a schema-invalid response as an ordinary
 * error variant, never throws and never coerces. `services/evidence/relevance.ts` and
 * `entity-collision.ts` are the ones that retry once with a repair instruction and then drop the
 * item to `unclear`/`not_confirmed` — the discipline F10 §4.4 keeps from the superseded design.
 */
import type { z } from 'zod';

/** The only two tasks v1 permits (D-21). Deliberately not `'stance'` — see the module docstring. */
export const MODEL_TASKS = ['relevance', 'entity_collision'] as const;
export type ModelTask = (typeof MODEL_TASKS)[number];

export type ModelClassifyInput = {
  readonly task: ModelTask;
  /** `MethodDescriptor.version`-shaped (semver) — see `services/evidence/method-registry.ts`. */
  readonly promptVersion: string;
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  /**
   * Fixture-mode case selection, mirroring `adapters/fixtures.ts`'s `x-fixture-case` — the
   * channel a caller uses to choose a canned response deliberately rather than the client
   * guessing from the prompt text. Ignored by the live implementation. Defaults to `'success'`.
   */
  readonly fixtureCase?: string;
};

/** Every field D-21 (superseded section) asks be recorded with an LLM call, kept. */
export type ModelCallMeta = {
  readonly modelId: string;
  /** e.g. `'vercel_gateway'` — `Env['MODEL_TRANSPORT_DEFAULT']`, never hardcoded (ARCH §4.6). */
  readonly route: string;
  readonly promptVersion: string;
  /** Decimal string. v1 always dispatches at `'0'` (D-21 superseded section; kept). */
  readonly temperature: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  /** `null` is UNPRICED, never `'0'` — same discipline as `ProviderMeta.costUsd`. */
  readonly costUsd: string | null;
  readonly requestId: string;
  readonly latencyMs: number;
  readonly requestedAt: string;
};

export type ModelClientError =
  | { readonly kind: 'schema_invalid'; readonly issues: readonly string[]; readonly raw: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'upstream'; readonly status: number }
  | { readonly kind: 'budget_denied'; readonly scope: 'account' | 'global' };

export type ModelClientResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: ModelCallMeta }
  | { readonly ok: false; readonly error: ModelClientError; readonly meta: ModelCallMeta };

export type ModelClient = {
  classify<T>(input: ModelClassifyInput, schema: z.ZodType<T>): Promise<ModelClientResult<T>>;
};

// ── Budget, cost and call-log ports — this module's own, see the docstring above ───────────────

export type ModelBudgetGate = {
  check(input: {
    task: ModelTask;
    estimatedCostUsd: string | null;
  }): Promise<{ allowed: true } | { allowed: false; scope: 'account' | 'global' }>;
};

export type ModelCostEntry = {
  readonly task: ModelTask;
  readonly unitType: 'call';
  readonly requestUnits: string;
  readonly costUsd: string | null;
  readonly requestId: string;
  readonly occurredAt: Date;
};
export type ModelCostSink = (entry: ModelCostEntry) => Promise<void>;

export type ModelCallLogEntry = {
  readonly task: ModelTask;
  readonly requestFingerprint: string;
  readonly statusCode: number | null;
  readonly latencyMs: number;
  readonly itemsReturned: number | null;
  readonly estimatedCostUsd: string;
  readonly startedAt: Date;
  readonly errorClass: string | null;
};
export type ModelCallLogSink = (entry: ModelCallLogEntry) => Promise<void>;
