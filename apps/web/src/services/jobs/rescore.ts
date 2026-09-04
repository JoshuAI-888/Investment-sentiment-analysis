/**
 * F20 §4.4 — re-score a **bounded** set of items under a new pinned revision.
 *
 * ## The rule, and why this module cannot break it
 *
 * *"Re-scoring writes a successor artifact. Nothing is recomputed in place."*
 *
 * This module does not write a score at all. It reads the current chain, decides which items are
 * genuinely re-scoreable, and **enqueues** — the successor row is written later by
 * `scoring-worker.ts`, from a queue entry carrying `supersedesScoreId`. So there is no code path
 * anywhere in the re-score feature that holds both a predecessor row and a write handle, which
 * is a stronger guarantee than any amount of care at a call site. `ScoreStorePort` is passed
 * here read-only in practice and its `appendScores` is never called; the tests assert that.
 *
 * ## Bounded, and refusing rather than truncating
 *
 * §4.4 says "a bounded set". An over-large request is **refused**, not silently trimmed: a
 * re-score that quietly did 500 of the 5,000 items asked for would leave the corpus in exactly
 * the half-migrated state Tier D3 rejects, and the operator would have no way to tell from the
 * result that it had happened.
 *
 * ## Re-scoreability by source (D-17)
 *
 * | Source | Re-scoreable from | Note |
 * |---|---|---|
 * | Reddit | Full body | Indefinitely |
 * | Substack | Full body | Indefinitely |
 * | X | Bounded snippet | The snippet is X's canonical scoring unit |
 *
 * An item whose text is gone — deleted upstream and purged — is the one unrecoverable case, and
 * it is reported as skipped. It is never re-scored from an empty string, and it is not recorded
 * unscoreable here either: it already has a valid predecessor score, which stays readable.
 */
import type { SocialAxis } from '@/contracts/primitives';
import type { ScorerId } from '@/adapters/scorer';
import { routeToScorer } from './routing';
import { latestScoreByItem } from './scores';
import type {
  RawItemReaderPort,
  ScoreRow,
  ScoreStorePort,
  ScoringQueueEntry,
  ScoringQueuePort,
  SocialItemForm,
} from './ports';

/**
 * The ceiling on one re-score job. Deliberately small enough that a job is an operator decision
 * with a reviewable blast radius rather than a background migration nobody watched.
 */
export const MAX_RESCORE_BATCH = 500;

export type RescoreCandidate = {
  itemId: string;
  axis: SocialAxis;
  form: SocialItemForm;
};

export const RESCORE_SKIP_REASONS = [
  /** D-17's unrecoverable case: no re-scoreable text is retained. */
  'text_unavailable',
  /** The item has no score yet, so there is nothing to write a successor *to*. */
  'never_scored',
  /** Already scored under the target revision. Re-running would duplicate, not improve. */
  'already_at_target',
  /** The job named no target pin for the model this item routes to. */
  'no_target_for_scorer',
  /**
   * The candidate's own `axis`/`form` route to a different model than the predecessor was
   * actually scored under. A caller-supplied `axis`/`form` disagreeing with the item's real
   * history is exactly what would write a successor scored by a different model than its
   * predecessor — a scorer change disguised as a revision bump. Found by lane-review.
   */
  'scorer_mismatch',
] as const;
export type RescoreSkipReason = (typeof RESCORE_SKIP_REASONS)[number];

export type RescoreSkip = { itemId: string; reason: RescoreSkipReason };

export type RescoreOutcome =
  | {
      ok: false;
      reason: 'batch_too_large';
      requested: number;
      limit: number;
    }
  | {
      ok: true;
      enqueued: readonly ScoringQueueEntry[];
      skipped: readonly RescoreSkip[];
      /** The predecessor rows, exactly as read. Returned so a caller can log what it is about
       *  to supersede — never so it can modify them. */
      predecessors: readonly ScoreRow[];
    };

/**
 * Enqueues successors for `candidates` under `targetScorerVersions`.
 *
 * A target is not sent to the scorer — the deployed service decides its own
 * revision, and the app has no way to ask for a different one without redeploying it. It does
 * two things, in two places:
 *
 * 1. **Here:** skips items already scored under it, so a re-score run twice is not a re-score
 *    run twice.
 * 2. **On the queue entry, checked by `scoring-worker.ts`:** refuses to write a successor whose
 *    actual `scorerVersion` is not the target. Without that second check the first one is
 *    worthless — a re-score against a service nobody redeployed writes successors under the old
 *    pin, `already_at_target` never fires because the version never moves, and every subsequent
 *    run appends another identical successor forever while the operator believes the migration
 *    succeeded. Found by lane-review.
 */
export async function enqueueRescore(
  input: {
    candidates: readonly RescoreCandidate[];
    /**
     * The target pin **per model**, not one string for the job.
     *
     * §4.1 runs two pinned models, so "re-score onto the new revision" is two revisions. A
     * single string cannot describe it: applied to a batch spanning both models it would
     * declare every Twitter-RoBERTa successor stale against a FinBERT pin, and the re-score
     * would silently do nothing for one whole axis. A model with no entry here is not
     * re-scored, and says so (`no_target_for_scorer`) rather than being skipped invisibly.
     */
    targetScorerVersions: Partial<Record<ScorerId, string>>;
    at: Date;
  },
  deps: {
    queue: ScoringQueuePort;
    items: RawItemReaderPort;
    store: ScoreStorePort;
  },
): Promise<RescoreOutcome> {
  if (input.candidates.length > MAX_RESCORE_BATCH) {
    return {
      ok: false,
      reason: 'batch_too_large',
      requested: input.candidates.length,
      limit: MAX_RESCORE_BATCH,
    };
  }

  const itemIds = input.candidates.map((candidate) => candidate.itemId);
  const predecessors = await deps.store.readScores({ itemIds });
  const current = latestScoreByItem(predecessors);

  const texts = await deps.items.readScoreableText({ itemIds });
  const available = new Set(texts.filter((text) => text.text !== '').map((text) => text.itemId));

  const enqueuedAt = input.at.toISOString();
  const skipped: RescoreSkip[] = [];
  const entries: ScoringQueueEntry[] = [];

  for (const candidate of input.candidates) {
    const predecessor = current.get(candidate.itemId);
    if (predecessor === undefined) {
      skipped.push({ itemId: candidate.itemId, reason: 'never_scored' });
      continue;
    }

    // Re-derived from structure, which is why `routeToScorer` keys on nothing that can drift:
    // a successor scored by a different *model* than its predecessor would be a scorer change
    // disguised as a revision bump.
    const scorerId = routeToScorer(candidate);

    // `RescoreCandidate` is an operator-facing input, not a row read from the store — its
    // `axis`/`form` could disagree with what the item was actually collected and scored as.
    // `predecessor.scorerId` is the ground truth; checking it here is what makes the structural
    // guarantee above real rather than merely re-asserted. Found by lane-review: without this,
    // a candidate list built with the wrong `form` routes to the wrong model, and the
    // `targetScorerVersion` check in `scoring-worker.ts` cannot catch it — that check only
    // verifies the *service* answered under the *requested* pin, not that the requested pin was
    // for the right model in the first place.
    if (predecessor.scorerId !== scorerId) {
      skipped.push({ itemId: candidate.itemId, reason: 'scorer_mismatch' });
      continue;
    }

    const target = input.targetScorerVersions[scorerId];

    if (target === undefined) {
      skipped.push({ itemId: candidate.itemId, reason: 'no_target_for_scorer' });
      continue;
    }
    if (predecessor.scorerVersion === target) {
      skipped.push({ itemId: candidate.itemId, reason: 'already_at_target' });
      continue;
    }
    if (!available.has(candidate.itemId)) {
      skipped.push({ itemId: candidate.itemId, reason: 'text_unavailable' });
      continue;
    }

    entries.push({
      itemId: candidate.itemId,
      axis: candidate.axis,
      form: candidate.form,
      scorerId,
      reason: 'rescore',
      supersedesScoreId: predecessor.scoreId,
      // Carried so the worker can refuse a successor that came back under the *old* pin. Used
      // here only to skip `already_at_target`; the check that the migration actually happened
      // is the worker's, because only it sees what the service answered.
      targetScorerVersion: target,
      enqueuedAt,
    });
  }

  if (entries.length > 0) await deps.queue.enqueue(entries);

  return { ok: true, enqueued: entries, skipped, predecessors };
}
