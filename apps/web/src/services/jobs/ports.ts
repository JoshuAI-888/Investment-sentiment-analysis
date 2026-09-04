/**
 * Everything the scoring queue and worker need from persistence, as **injected ports** rather
 * than imported modules — F20 §4.2/§4.3.
 *
 * ## Why ports, and not a repository call
 *
 * F20's persistence half needs a table that does not exist yet: no migration in
 * `apps/web/migrations/` carries `scorer_id`, `scorer_version`, `runtime_version`, `input_hash`,
 * `truncated` or `scorer_provenance`, and `apps/web/src/repositories/` has no module over them.
 * Both paths belong to **SPINE** (`CLAUDE.md`: "Never edit a path another lane owns"), so this
 * lane may consume a repository function but may not write one.
 *
 * That constraint is not a workaround here, it is the same decoupling `adapters/ports.ts`
 * already used successfully for `CallLogSink`/`CostSink`: the ordering, outage and re-score
 * logic below is fully exercised against fakes with **no database and no Redis**, and the
 * properties F20 §7 reviews — "no data loss while the scorer is down", "a re-score writes a
 * successor and does not mutate" — are assertions on the *sequence of port calls*, which is the
 * only way to observe them at all. An implementation that wrote a successor by updating the
 * predecessor would return identical values to one that appended.
 *
 * The exact migration and repository signatures SPINE needs to add are listed in the lane
 * report's CONTRACTS field; when they land, `services/jobs/` gains an adapter that implements
 * these interfaces over them and nothing in this directory changes.
 *
 * ## The one rule the shapes below encode
 *
 * D-16: collection is forward-only with no backfill, so a scorer outage must **grow the
 * backlog**, never lose an item. `release` is therefore a first-class operation, distinct from
 * `ack`, and it carries `countsAsAttempt` — an outage is not the item's fault and must not
 * count against the attempt budget that eventually gives up on it.
 */
import type { ProviderError } from '@/contracts/provider';
import type { SocialAxis, StanceLabel } from '@/contracts/primitives';
import type { ScoreDistribution, ScorerId } from '@/adapters/scorer';

// ── What is queued ────────────────────────────────────────────────────────────────────────────

/**
 * The structural form of a raw item, which is what routing keys on — never its length.
 *
 * A length threshold would make the choice of model depend on the body, so an edited or
 * re-truncated body could route the *same item* to a different scorer on a re-score. That
 * silently mixes scorers inside one series, which is the exact thing Tier D3 rejects.
 */
export const SOCIAL_ITEM_FORMS = ['article', 'post', 'comment'] as const;
export type SocialItemForm = (typeof SOCIAL_ITEM_FORMS)[number];

export type ScoringQueueEntry = {
  /** The raw item's surrogate id. Never a URL, never a ticker (F03 §5). */
  itemId: string;
  axis: SocialAxis;
  form: SocialItemForm;
  /** The routing decision, frozen at enqueue so a re-score routes identically. */
  scorerId: ScorerId;
  reason: 'initial' | 'rescore';
  /** The score row this entry's result will supersede. `null` for an initial scoring. */
  supersedesScoreId: string | null;
  /**
   * The revision the operator asked the successor to be produced under. `null` for an initial
   * scoring, where any current pin is by definition the right one.
   *
   * **It travels on the entry because the worker is the only place it can be checked.** The
   * app cannot ask the service for a revision — the deployed container decides its own — so the
   * only way to know a re-score actually ran under the new pin is to compare what came back. If
   * this is not carried here, a re-score against a service nobody redeployed writes successors
   * under the *old* revision, the window stays homogeneous, the operator believes the migration
   * happened, and `already_at_target` never fires so every later run appends another identical
   * successor forever. Found by lane-review.
   */
  targetScorerVersion: string | null;
  /** ISO-8601 UTC. Drives the operator-visible "oldest unscored age" counter (§4.2 rule 3). */
  enqueuedAt: string;
};

export type LeasedScoringEntry = ScoringQueueEntry & {
  /** Identifies this lease, not the item — the same item may be leased again after a release. */
  leaseId: string;
  /** How many times this entry has been released back for a reason that was its own fault. */
  attempts: number;
};

/** §4.2 rule 3: backlog depth and oldest-unscored age are operator-visible (F15, F18). */
export type ScoringQueueStats = {
  /** Entries waiting to be leased. */
  depth: number;
  /** Entries currently leased by a worker and not yet acked or released. */
  leased: number;
  /** ISO-8601 UTC of the oldest waiting-or-leased entry, or `null` when the queue is empty. */
  oldestEnqueuedAt: string | null;
};

/**
 * Redis list, Postgres mirror (§4.2). Neither appears here: the durability property belongs to
 * the implementation, and every ordering property below is testable without either.
 */
export type ScoringQueuePort = {
  /**
   * Appends entries. **Must be idempotent per `(itemId, reason, supersedesScoreId)`** — the
   * collector may re-enqueue an item it has already written when a poll overlaps, and a
   * duplicate would produce two score rows for one item from one revision.
   */
  enqueue(entries: readonly ScoringQueueEntry[]): Promise<void>;
  /** Takes up to `max` entries in enqueue order and marks them leased. */
  lease(input: { max: number; at: Date }): Promise<readonly LeasedScoringEntry[]>;
  /** The work is durably recorded. Drop the entries. */
  ack(input: { leaseIds: readonly string[]; at: Date }): Promise<void>;
  /**
   * Returns leased entries to the queue, **preserving their original enqueue order** so an
   * outage does not reshuffle the backlog. `countsAsAttempt: false` for an outage.
   */
  release(input: {
    leaseIds: readonly string[];
    at: Date;
    countsAsAttempt: boolean;
  }): Promise<void>;
  stats(input: { at: Date }): Promise<ScoringQueueStats>;
};

// ── Reading the item back ─────────────────────────────────────────────────────────────────────

/**
 * The re-scoreable unit for one item (D-17): the **full body** for Reddit and Substack, the
 * **bounded snippet** for X — the snippet is X's canonical scoring unit, so the X series stays
 * self-consistent under a re-score.
 */
export type ScoreableText = {
  itemId: string;
  text: string;
};

export type RawItemReaderPort = {
  /**
   * Returns the re-scoreable text for the ids it can. **An id whose text is gone is simply
   * absent from the result** — a post deleted upstream and purged is D-17's one unrecoverable
   * case, and the honest answer is "no text", never an empty string that would be scored as if
   * it were the post.
   */
  readScoreableText(input: { itemIds: readonly string[] }): Promise<readonly ScoreableText[]>;
};

// ── Persistence ───────────────────────────────────────────────────────────────────────────────

/**
 * §4.3. `'capacity_fallback'` is provisioned, never written in v1 — the column exists so that
 * if D-13's fallback is ever built, the rows it produces are distinguishable from the first day
 * rather than retrofitted, and so Tier D3's "no series mixes scorers" check has something to
 * read.
 */
export const SCORER_PROVENANCES = ['pinned', 'capacity_fallback'] as const;
export type ScorerProvenance = (typeof SCORER_PROVENANCES)[number];

/** The only value v1 ever writes. Asserted in `scoring-worker.ts` and in its tests. */
export const V1_SCORER_PROVENANCE: ScorerProvenance = 'pinned';

/**
 * One persisted score. Every field F20 §4.3 requires is non-nullable here, so a row that omits
 * one cannot be constructed rather than merely failing review.
 */
export type ScoreRow = {
  scoreId: string;
  itemId: string;
  label: StanceLabel;
  /** Decimal strings, all three. Never a JS number, anywhere in this path (ARCH §4.2). */
  scores: ScoreDistribution;
  scorerId: ScorerId;
  scorerVersion: string;
  runtimeVersion: string;
  inputHash: string;
  truncated: boolean;
  scorerProvenance: ScorerProvenance;
  /** Set on a successor written by a re-score. The predecessor is never touched (§4.4). */
  supersedesScoreId: string | null;
  /** As reported by the scorer. */
  scoredAt: string;
  /** When this app persisted it — `ingested_at` to `scoredAt`'s `observed_at` (ARCH §5). */
  recordedAt: string;
};

/** Why an item has no score and never will, absent a change upstream. */
export const UNSCOREABLE_REASONS = [
  /** D-17's one unrecoverable case: deleted upstream and purged, so there is no text left. */
  'text_unavailable',
  /** The scorer answered, repeatedly, with something that violated its own contract. */
  'scorer_contract_violation',
] as const;
export type UnscoreableReason = (typeof UNSCOREABLE_REASONS)[number];

export type UnscoreableRow = {
  itemId: string;
  reason: UnscoreableReason;
  detail: string;
  recordedAt: string;
};

/**
 * **Append-only.** ARCH §5: never overwrite, insert a successor. An implementation that
 * updated in place would break §4.4 and Tier D3 simultaneously, so the interface offers no way
 * to do it — there is no `update`.
 *
 * **`appendScores` MUST be idempotent on a row's natural key —
 * `(itemId, scorerVersion, inputHash, supersedesScoreId)` — not on `scoreId`.** `scoreId` is a
 * fresh surrogate minted per call (`ScoreIdFactory`); the worker's own at-least-once queue can
 * redeliver a leased-but-unacked entry after a crash between `appendScores` and `ack`
 * (`scoring-worker.ts`), and a redelivered pass mints a *different* `scoreId` for what is
 * otherwise the identical row. Rejecting only a repeated `scoreId` catches nothing — the id
 * never repeats — and silently accepting the repeat writes two live rows for one item, which is
 * exactly the double-count Tier D3 exists to prevent. A row whose natural key already exists
 * is a no-op: the redelivery is absorbed, not treated as an error and not written twice. Found
 * by lane-review, which also found the doc comment that used to describe this as `scoreId`
 * uniqueness — it was never true.
 *
 * **A trap for whoever implements this over SQL, found by a second lane-review pass on the fake
 * above:** `supersedesScoreId` is `null` for every *initial* scoring — the common case, not the
 * rare one — and standard SQL treats every `NULL` in a `UNIQUE` constraint as distinct from every
 * other `NULL`. A plain `UNIQUE (item_id, scorer_version, input_hash, supersedes_score_id)`
 * therefore enforces nothing at all for initial scores, which is exactly the redelivery case this
 * rule exists to catch. `supersedes_score_id` needs a non-null stand-in for "no predecessor" in
 * the uniqueness check itself — a `COALESCE(supersedes_score_id, '')` expression index, a
 * generated column, or two partial unique indexes split on `IS NULL` all work; a bare multi-column
 * `UNIQUE` does not. The in-memory fake's `===` comparison treats `null === null` as equal and
 * does not have this problem, which is why its own tests cannot surface it — this note exists so
 * the real implementation does not inherit a bug the fake was never capable of having.
 */
export type ScoreStorePort = {
  appendScores(input: { rows: readonly ScoreRow[] }): Promise<void>;
  /** Every row for these items, superseded ones included. Supersession is a read-time concern. */
  readScores(input: { itemIds: readonly string[] }): Promise<readonly ScoreRow[]>;
  appendUnscoreable(input: { rows: readonly UnscoreableRow[] }): Promise<void>;
  readUnscoreable(input: { itemIds: readonly string[] }): Promise<readonly UnscoreableRow[]>;
};

// ── Outage state ──────────────────────────────────────────────────────────────────────────────

/**
 * §4.2 rule 2 needs a *timestamp*, not a boolean: F18's degraded mode reads
 * "no stance — scorer unavailable since {ts}".
 */
export type ScorerHealth =
  | { state: 'ok'; since: string }
  | { state: 'outage'; since: string; lastError: ProviderError };

/**
 * ## Implementations MUST preserve the first failure's timestamp
 *
 * `markOutage` is called on **every** failed worker pass, not once per outage. An
 * implementation that writes `since = at` each time is not obviously wrong on inspection and
 * passes any test that only checks `state`, but it makes a two-hour outage render as
 * *"scorer unavailable since 4 seconds ago"* forever — the operator sees a fresh blip instead
 * of a long incident, and the one number F18's degraded banner exists to show is the one that
 * is wrong.
 *
 * The binding rule, for whoever implements this over Postgres/Redis:
 *
 * > **`markOutage` MUST keep the `since` of the first failure in the current outage, across
 * > any number of repeated calls, until `markHealthy` ends it. `lastError` MAY be updated on
 * > every call; `since` MUST NOT.**
 * > **`markHealthy` MUST be idempotent** — calling it while already `ok` must not move `since`,
 * > or every drained pass would restart the uptime clock.
 *
 * `tests/unit/jobs/port-conformance.ts` exports `assertScorerHealthPortContract`, an executable
 * form of both rules. It is not a test of the in-memory fake; it is the suite the real
 * implementation is expected to be run against, and the fake is merely its first subject.
 * Raised by lane-review, which found the rule was enforced only by the fake it was written
 * alongside.
 */
export type ScorerHealthPort = {
  markOutage(input: { at: Date; error: ProviderError }): Promise<void>;
  markHealthy(input: { at: Date }): Promise<void>;
  read(): Promise<ScorerHealth>;
};

// ── Injected, so nothing here reads a clock or a random source directly ────────────────────────

/** A fresh `scoreId`. Injected so a test asserts an exact successor chain (F20 §7 step 7). */
export type ScoreIdFactory = () => string;
