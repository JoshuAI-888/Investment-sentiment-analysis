/**
 * The outage → abstention gate — F20 §4.2 rule 2 and `02-ARCHITECTURE-CONTRACTS.md` §2.1.
 *
 * *"No silent substitution. When the queue is not draining, dependent metrics render §6.3
 * abstention and F18's degraded mode — 'no stance — scorer unavailable since {ts}'. A number
 * from another method is never written in place of a missing one."*
 *
 * ## Why this is a gate and not a flag
 *
 * A boolean that callers are trusted to check is a rule that holds until the first caller
 * forgets. `stanceGate` returns a **discriminated union**: on the abstaining branch there is no
 * `scores` field to read at all, so a consumer that ignores the outage cannot compile. That is
 * the same structural move `ProviderResult` makes, for the same reason.
 *
 * The gate is also one-directional by construction. It can turn a set of scores into an
 * abstention; it has no way to turn an abstention into a number, because it imports no other
 * scoring method, no default and no cache. There is nothing here that *could* be substituted.
 *
 * ## A known imprecision in `InsufficiencyReason`, stated rather than papered over
 *
 * `contracts/primitives.ts` offers `scorer_unavailable` and `no_coverage_in_window`. Neither
 * exactly names the third real state: *the scorer is up, and the backlog has not reached these
 * items yet.* That is not an outage, and it is not an absence of coverage — the items exist and
 * will be scored. This module uses `no_coverage_in_window` for it and puts the precision in the
 * `message`, which is what `docs/04-BUILD-LOOP.md` §7.5 asks a reviewer to read. A
 * `scoring_backlog` member has been requested from SPINE; when it lands, only the constant
 * below changes.
 *
 * ## A consequence of the Tier D3 rule, flagged rather than quietly relaxed
 *
 * F20 §5 words the check as *"a series containing two `scorer_version` values is rejected"*, and
 * §4.1 routes Reddit **posts** to FinBERT and Reddit **comments** to Twitter-RoBERTa. So a
 * Reddit window holding both carries two revisions and is refused here — a Reddit window is
 * post-only or comment-only under the spec as written.
 *
 * That may be intended (they are different sampling units as well as different models) or it
 * may be an over-reading of a rule aimed at *revision drift within one model*. Deciding it is
 * F06's and F10's, not this slice's: the aggregate's definition is theirs. The check therefore
 * implements §5 literally, and this note is the flag.
 */
import type { InsufficiencyReason } from '@/contracts/primitives';
import type { Abstention } from '@/calc/artifact';
import { distinctScorerVersions, latestScoreByItem } from './scores';
import type { ScoreRow, ScorerHealth, UnscoreableRow } from './ports';

/** See the module note. Swap for `'scoring_backlog'` the day SPINE adds it. */
const PENDING_BACKLOG_REASON: InsufficiencyReason = 'no_coverage_in_window';

export type StanceGateInput = {
  /** Every raw item in the window the caller is about to render. */
  itemIds: readonly string[];
  /** Every score row held for those items, superseded ones included. */
  scores: readonly ScoreRow[];
  /** Items known to have no score and no prospect of one (purged bodies, D-17). */
  unscoreable: readonly UnscoreableRow[];
  health: ScorerHealth;
};

export type StanceGateOutcome =
  | {
      kind: 'ok';
      /** The live row per item, in `itemIds` order. */
      scores: readonly ScoreRow[];
      /** The single revision the whole window was scored under (Tier D3). */
      scorerVersion: string;
      /** Items excluded because no score can ever exist for them. Rendered as a coverage note. */
      excluded: readonly UnscoreableRow[];
    }
  | { kind: 'abstain'; abstention: Abstention };

/**
 * Decides whether a window of items may back a stance number at all.
 *
 * The order of the checks is the order of how much the operator needs to know: an outage is a
 * live incident, a backlog is a delay, and a mixed-scorer window is a methodology defect that
 * would otherwise render a number nobody could defend.
 */
export function stanceGate(input: StanceGateInput): StanceGateOutcome {
  const live = latestScoreByItem(input.scores);

  /**
   * An unscoreable row only excludes an item that has **no live score**.
   *
   * The two are not mutually exclusive in practice: a re-score entry whose body is purged
   * between enqueue and lease can leave an item holding both a good predecessor score and a
   * `text_unavailable` row. Filtering on the unscoreable row alone dropped that item from `n`
   * and reported it under `excluded` — whose own contract says "no score can ever exist for
   * them", which is false when one demonstrably does. Found by lane-review; `scoring-worker.ts`
   * now avoids writing that row at all, and this is the second line of defence, because a row
   * written by an earlier build would still be sitting in the table.
   */
  const excluded = input.unscoreable.filter(
    (row) => input.itemIds.includes(row.itemId) && !live.has(row.itemId),
  );
  const excludedIds = new Set(excluded.map((row) => row.itemId));
  const expected = input.itemIds.filter((id) => !excludedIds.has(id));

  if (expected.length === 0) {
    return {
      kind: 'abstain',
      abstention: {
        reason: 'no_coverage_in_window',
        message:
          input.itemIds.length === 0
            ? 'No stance — there are no items in this window.'
            : `No stance — all ${input.itemIds.length} item(s) in this window are unscoreable, so there is nothing to score.`,
      },
    };
  }

  const pending = expected.filter((id) => !live.has(id));

  if (pending.length > 0) {
    if (input.health.state === 'outage') {
      return {
        kind: 'abstain',
        abstention: {
          reason: 'scorer_unavailable',
          // The exact wording §4.2 rule 2 asks for, so F18's degraded banner and the Inspector
          // say the same sentence.
          message: `No stance — scorer unavailable since ${input.health.since}. ${pending.length} of ${expected.length} item(s) in this window are not yet scored, and no other method's number is substituted for them.`,
        },
      };
    }
    return {
      kind: 'abstain',
      abstention: {
        reason: PENDING_BACKLOG_REASON,
        message: `No stance — ${pending.length} of ${expected.length} item(s) in this window have not been scored yet. The scorer is reachable and the backlog is draining; no number is shown until it has.`,
      },
    };
  }

  const rows = expected.map((id) => live.get(id) as ScoreRow);
  const versions = distinctScorerVersions(rows);
  if (versions.length > 1) {
    // ARCH §2.1 rule 3 / Tier D3: no series admitted to a metric mixes scorers. Two revisions
    // in one window is not a small inconsistency — the numbers are not comparable, so the
    // aggregate of them means nothing, and rendering it would be the substitution rule 2
    // forbids wearing a different hat.
    return {
      kind: 'abstain',
      abstention: {
        reason: 'methodology_version_boundary',
        message: `No stance — this window mixes ${versions.length} scorer revisions (${versions.join(', ')}). Scores from different revisions are not comparable, so no aggregate is shown until the window is re-scored under one revision.`,
      },
    };
  }

  return {
    kind: 'ok',
    scores: rows,
    // Present: `versions.length === 1` on this branch, and `rows` is non-empty.
    scorerVersion: versions[0] as string,
    excluded,
  };
}
