/**
 * The scorer adapter — F20 §3, `provider: 'scorer'`.
 *
 * **The scorer is treated as a provider, deliberately.** `contracts/provider.ts` already names
 * it in `providerId`, with the reason spelled out there: it is out-of-process, it times out, it
 * returns malformed payloads, and *its outage must become an abstention rather than an
 * exception*. Routing it through `callProvider` is what makes that true by construction — every
 * failure mode arrives as a `ProviderResult` the worker can act on, and none of them throws
 * into the collector's loop.
 *
 * **What this module does not do.** It never persists, never queues and never decides which
 * model scores an item. `services/jobs/` owns all three. This file is the wire and nothing more.
 *
 * ## Where these types belong, and why they are here
 *
 * `ScoreResult` and `ScorerIdentity` are F20 §3 *contracts*, and `src/contracts/` is SPINE's
 * (`CLAUDE.md`). This lane may not add a file there, so the schemas live at the highest layer
 * this lane owns that everything downstream can still import: `adapters` is below `services` in
 * `02-ARCHITECTURE-CONTRACTS.md` §3, so `services/jobs/` reads them from here legally. When
 * SPINE lands `src/contracts/scoring.ts` these move there unchanged and this module imports
 * them instead — see the lane report's CONTRACTS field.
 *
 * ## Decimal strings, at the boundary
 *
 * `scores` are validated as `decimalString` at stage 8 of the wrapper, before any caller sees
 * them. A JSON *number* in the response therefore fails the contract rather than silently
 * becoming a float — which is the whole of Tier D2's guarantee at this end of the wire, and
 * mirrors `services/scorer/contract.py`'s `DECIMAL_STRING` check at the other end.
 */
import Decimal from 'decimal.js';
import { z } from 'zod';
import { decimalString, stanceLabel } from '@/contracts/primitives';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

/** The endpoint name as it appears in the call log, the cache key and the fixture path. */
export const SCORER_ENDPOINT = 'score';

/**
 * Scoring a batch of 32 texts on CPU is slower than any HTTP API call in the roster, so the
 * wrapper's 10 s default would report a timeout for a service that is working correctly.
 */
export const SCORER_TIMEOUT_MS = 30_000;

/**
 * The two pinned models, by the id `services/scorer/pinning.py` gives them.
 *
 * These are ids, not model references: the *revision* lives in `scorerVersion` and is fixed by
 * the service, never by this app. Nothing here is a model ID that could be hardcoded into
 * application logic — the app cannot choose a revision, it can only record the one it was told.
 */
export const SCORER_IDS = ['finbert', 'tweet-roberta'] as const;
export const scorerIdSchema = z.enum(SCORER_IDS);
export type ScorerId = z.infer<typeof scorerIdSchema>;

/**
 * `<hf-repo>@<40-hex-commit-sha>`. A tag or a branch can be moved after the fact, which makes
 * every score produced under it unreproducible (F20 §4.1, product invariant §6.7). This is the
 * client-side half of the service's own boot assertion: even if a mis-pinned service somehow
 * booted, its output would not be admitted here.
 */
export const SCORER_VERSION_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9a-f]{40}$/;

export const scorerIdentitySchema = z.object({
  scorerId: scorerIdSchema,
  scorerVersion: z
    .string()
    .regex(
      SCORER_VERSION_PATTERN,
      "scorerVersion must be '<hf-repo>@<40-hex-commit-sha>' — never a tag, never 'latest' (F20 §4.1)",
    ),
  runtimeVersion: z.string().min(1),
});
export type ScorerIdentity = z.infer<typeof scorerIdentitySchema>;

/**
 * A score, as a decimal string.
 *
 * The `invalid_type_error` is not decoration. A JSON *number* here is **the** defect this
 * contract exists to catch — `services/scorer/contract.py` says the same thing at the other end
 * of the wire, and for the same reason: a float round-trips differently on different platforms,
 * so Tier D2's byte-identical requirement is a statement about the *string*. `.pipe` keeps
 * `contracts/primitives.ts` as the single source of the decimal pattern rather than restating
 * it here.
 */
const scoreValue = z
  .string({
    invalid_type_error:
      'is not a string. Scores are decimal strings, never JSON numbers ' +
      '(02-ARCHITECTURE-CONTRACTS.md §4.2) — a float round-trips differently on different ' +
      'platforms, and Tier D2 requires byte-identical output across runs and batch sizes',
  })
  .pipe(decimalString);

export const scoreDistributionSchema = z.object({
  bullish: scoreValue,
  bearish: scoreValue,
  neutral: scoreValue,
});
export type ScoreDistribution = z.infer<typeof scoreDistributionSchema>;

export const scoreResultSchema = z.object({
  itemId: z.string().min(1),
  label: stanceLabel,
  scores: scoreDistributionSchema,
  scorer: scorerIdentitySchema,
  /** ISO-8601 **UTC**. `z.string().datetime()` rejects an offset, which is what §3 asks for. */
  scoredAt: z.string().datetime(),
  /** sha256 of the **truncated** text, so a re-score of the same stored body reproduces it. */
  inputHash: z.string().regex(/^[0-9a-f]{64}$/, 'inputHash must be a sha256 hex digest'),
  truncated: z.boolean(),
});
export type ScoreResult = z.infer<typeof scoreResultSchema>;

export const scoreResponseSchema = z.array(scoreResultSchema);

/**
 * What the wrapper validates at stage 8: *an array*, and nothing more.
 *
 * **This is deliberately weaker than `scoreResponseSchema`, and the strictness is not lost — it
 * moves.** `callProvider` returns one verdict for a whole response, so validating every row
 * there made a single malformed row fail the entire batch. The worker then charged that failure
 * to all N leased entries and, after the attempt budget ran out, marked all N unscoreable —
 * permanent loss of up to 31 good items per bad one, in the feature whose entire purpose is
 * that nothing is lost (D-16, §4.2 rule 1). Found by lane-review.
 *
 * So the batch-level check is now only "is this a JSON array" — still a real contract check,
 * still catching an HTML error page or an object — and `scoreResultSchema` is applied to each
 * element individually below. Every rule that applied before still applies; what changed is the
 * blast radius of one row breaking one of them.
 */
const scoreEnvelopeSchema = z.array(z.unknown());

/**
 * Why one requested item could not be admitted. Per-item, so its neighbours are unaffected.
 */
export type RejectedScore = {
  itemId: string;
  issues: string[];
};

/**
 * A partial answer: the rows that were admissible, and the requested items that were not.
 *
 * `admitted` and `rejected` together always cover exactly the requested item ids, so the worker
 * can account for every entry it leased without inferring anything.
 */
export type ScoreBatchOutcome = {
  admitted: ScoreResult[];
  rejected: RejectedScore[];
};

/**
 * The tolerance on ∑scores = 1.
 *
 * Derived, not chosen: `services/scorer/scoring.py` formats each softmax probability to six
 * decimal places, so three half-up-rounded values can drift from an exact 1 by at most
 * 3 × 5e-7 = 1.5e-6. 1e-5 sits an order of magnitude above that and four orders below any
 * plausible defect. If the service ever changes its precision, this *should* fail — that is a
 * contract change and it should not pass silently.
 */
export const SCORE_SUM_TOLERANCE = '0.00001';

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/**
 * The checks the shape alone cannot make — F20 §7 step 5's neighbourhood, found missing by
 * lane-review.
 *
 * A response of `{"bullish":"12.34","bearish":"-0.5","neutral":"0"}` is three well-formed
 * decimal strings and passes every syntactic rule, and would have been persisted under a
 * correctly pinned SHA with `scorer_provenance: 'pinned'` — a number the corpus can never
 * explain. These three properties are not stylistic preferences: `models.py` produces `scores`
 * with `softmax`, so each value **is** in [0,1] and they **do** sum to 1, and it derives `label`
 * with `max(scores, key=scores.get)`, so the labelled value **is** a maximum. A response
 * violating any of them did not come from the pinned model this feature exists to guarantee.
 *
 * All arithmetic is decimal. A float sum of three probabilities is exactly the kind of value
 * that lands at 0.9999999999999999 and makes a tolerance test lie.
 */
export function scoreDistributionIssues(
  label: ScoreResult['label'],
  scores: ScoreDistribution,
): string[] {
  const issues: string[] = [];
  const entries = Object.entries(scores) as Array<[keyof ScoreDistribution, string]>;

  for (const [key, raw] of entries) {
    const value = new Decimal(raw);
    if (value.lessThan(ZERO) || value.greaterThan(ONE)) {
      issues.push(`scores.${key} is ${raw}, which is outside [0, 1] — not a probability`);
    }
  }
  // A value outside [0,1] makes the sum meaningless too; reporting both would be noise.
  if (issues.length > 0) return issues;

  const sum = entries.reduce((total, [, raw]) => total.plus(raw), ZERO);
  if (sum.minus(ONE).abs().greaterThan(SCORE_SUM_TOLERANCE)) {
    issues.push(
      `scores sum to ${sum.toString()}, not 1 (tolerance ${SCORE_SUM_TOLERANCE}) — the three ` +
        'stances are a distribution over one item, so they are not independently scaled',
    );
  }

  const labelled = new Decimal(scores[label]);
  for (const [key, raw] of entries) {
    // `>=`, not `>`: `scoring.py` rounds to six places, so two genuinely different
    // probabilities can round to the same string, and `max()` broke that tie upstream on the
    // unrounded floats. Requiring a *strict* maximum here would reject a correct response.
    if (labelled.lessThan(raw)) {
      issues.push(
        `label is '${label}' (${scores[label]}) but scores.${key} is higher (${raw}) — the label ` +
          'must be a maximum of the distribution it is reported with',
      );
    }
  }

  return issues;
}

/**
 * One item on the wire. `kind` selects the pinned model.
 *
 * **`kind` carries a `ScorerId`, not a source kind.** F20 §4.1's prose calls this "kind" and
 * `services/scorer/scoring.py`'s docstring gives `'reddit_post'` as an example, but the service
 * that was actually built keys `backends` and `model_by_id` by `scorer_id` — `app.py` returns
 * 400 for any other value. This app therefore sends the routed scorer id, and
 * `services/jobs/routing.ts` is the single place that decides it. Flagged to the coordinator
 * rather than fixed here: `services/scorer/` is out of this slice's scope.
 */
export type ScoreRequestItem = {
  itemId: string;
  text: string;
  kind: ScorerId;
};

export type ScorerCallOptions = {
  items: readonly ScoreRequestItem[];
  /** The deployed service's origin. Required in live mode; unused in fixture mode. */
  baseUrl?: string;
  timeoutMs?: number;
  headers?: Readonly<Record<string, string>>;
};

/**
 * The request body, exactly as it goes on the wire — `{itemId, text, kind}` per F20 §4.1.
 *
 * Exported because it is the one part of the request a test can assert on without a live
 * `Fetcher`: `createFetcher` owns the transport, so in fixture mode there is no request object
 * to inspect. Keeping the body a pure function is what makes its shape checkable at all.
 */
export function scoreRequestBody(items: readonly ScoreRequestItem[]): string {
  return JSON.stringify(
    items.map((item) => ({ itemId: item.itemId, text: item.text, kind: item.kind })),
  );
}

/**
 * `POST /score`. Returns, per requested item, either an admissible `ScoreResult` or the reasons
 * it was refused — never one verdict for the whole batch.
 *
 * `ok: false` therefore means something that says nothing about the individual items: the
 * service was unreachable, timed out, or answered with something that is not a JSON array at
 * all. Those are outages. A row that is merely *wrong* appears in `rejected`, attributed to the
 * one item it belongs to.
 *
 * Never throws for an expected condition. An empty batch *is* a caller bug rather than an
 * expected condition — the worker leases before it calls, so it never has one — and throws.
 */
export async function postScoreBatch(
  options: ScorerCallOptions,
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<ScoreBatchOutcome>> {
  if (options.items.length === 0) {
    throw new Error('postScoreBatch: refusing to call the scorer with an empty batch');
  }
  if (providerMode === 'live' && (options.baseUrl === undefined || options.baseUrl === '')) {
    throw new Error('postScoreBatch: baseUrl is required when providerMode is "live"');
  }

  const fetcher = createFetcher(providerMode, {
    provider: 'scorer',
    endpoint: SCORER_ENDPOINT,
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const body = scoreRequestBody(options.items);

  const result = await callProvider(
    {
      provider: 'scorer',
      operation: SCORER_ENDPOINT,
      // The batch's item ids, so the call log's fingerprint identifies *which* batch was sent.
      segments: options.items.map((item) => item.itemId),
      schema: scoreEnvelopeSchema,
      request: {
        url: `${(options.baseUrl ?? 'http://scorer.invalid').replace(/\/$/, '')}/score`,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
        body,
      },
      timeoutMs: options.timeoutMs ?? SCORER_TIMEOUT_MS,
      // Self-hosted, flat-cost, and no per-call allowance to spend: `null` is UNPRICED and
      // never becomes '0' (`contracts/provider.ts`). Scoring is also never cached — every
      // batch is a distinct set of items, so a cache hit would be a bug, not a saving.
      quotaUnits: 0,
      estimatedCostUsd: null,
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;

  const outcome = admitPerItem(options.items, result.data);

  // Still loud (§4.1 stage 8), and now precise about which item broke what. A violation is
  // reported once per call rather than once per bad row, so a wholly-broken deploy does not
  // write one log line per item in the batch.
  if (outcome.violations.length > 0) {
    deps.onContractViolation({
      provider: 'scorer',
      endpoint: SCORER_ENDPOINT,
      issues: outcome.violations,
      payloadRef: null,
    });
  }

  return {
    ok: true,
    data: { admitted: outcome.admitted, rejected: outcome.rejected },
    meta: result.meta,
  };
}

/**
 * Decides, per requested item, whether the response holds an admissible score for it.
 *
 * Every rule the old whole-batch correspondence check made is still made here; each is now
 * attributed to the single item it concerns. The one rule that genuinely has no item to attach
 * to — a row answering for something nobody asked about — is reported as a violation and
 * otherwise **ignored**, because there is no leased entry it could poison and inventing one
 * would be worse than dropping it.
 */
function admitPerItem(
  requested: readonly ScoreRequestItem[],
  rows: readonly unknown[],
): { admitted: ScoreResult[]; rejected: RejectedScore[]; violations: string[] } {
  const admitted: ScoreResult[] = [];
  const rejected: RejectedScore[] = [];
  const violations: string[] = [];

  const requestedIds = new Set(requested.map((item) => item.itemId));
  const rowsById = new Map<string, unknown[]>();

  for (const row of rows) {
    const itemId =
      typeof row === 'object' && row !== null && typeof (row as { itemId?: unknown }).itemId === 'string'
        ? (row as { itemId: string }).itemId
        : null;

    if (itemId === null) {
      violations.push('response contains a row with no usable itemId; it was discarded');
      continue;
    }
    if (!requestedIds.has(itemId)) {
      violations.push(`response contains itemId ${itemId}, which was not requested; it was discarded`);
      continue;
    }
    const existing = rowsById.get(itemId);
    if (existing === undefined) rowsById.set(itemId, [row]);
    else existing.push(row);
  }

  for (const item of requested) {
    const matches = rowsById.get(item.itemId) ?? [];

    if (matches.length === 0) {
      rejected.push({ itemId: item.itemId, issues: ['the scorer returned no result for this item'] });
      continue;
    }
    if (matches.length > 1) {
      // Two answers for one item is not a tie to break: we cannot know which the model meant,
      // and picking either would be the substitution §4.2 rule 2 forbids.
      rejected.push({
        itemId: item.itemId,
        issues: [`the scorer returned ${matches.length} results for this item; none was admitted`],
      });
      continue;
    }

    const parsed = scoreResultSchema.safeParse(matches[0]);
    if (!parsed.success) {
      rejected.push({
        itemId: item.itemId,
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
      continue;
    }

    const issues: string[] = [];
    if (parsed.data.scorer.scorerId !== item.kind) {
      issues.push(
        `was routed to ${item.kind} but was scored by ${parsed.data.scorer.scorerId}`,
      );
    }
    issues.push(...scoreDistributionIssues(parsed.data.label, parsed.data.scores));

    if (issues.length > 0) rejected.push({ itemId: item.itemId, issues });
    else admitted.push(parsed.data);
  }

  for (const row of rejected) {
    violations.push(`itemId ${row.itemId}: ${row.issues.join('; ')}`);
  }

  return { admitted, rejected, violations };
}
