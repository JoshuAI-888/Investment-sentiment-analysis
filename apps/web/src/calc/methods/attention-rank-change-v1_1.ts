/**
 * `attention.rank_change@1.1.0` — F06's amendment to F05's method (F06 §4.1):
 *
 * > *"If the `provider_methodology_version` differs between the current and prior snapshot,
 * > `rank_change` returns `not_applicable` with reason `methodology_changed`. Snapshots across a
 * > methodology boundary are not comparable, and computing a delta across one would be a
 * > fabricated number."*
 *
 * `1.0.0`'s file (`attention-rank-change.ts`) is untouched and stays registered — replaying an
 * artifact computed before this amendment must still reproduce it exactly, and `1.0.0`'s own
 * golden fixtures are the proof. This is a new version rather than an edit in place, per the PR
 * review's rule: *"A 'cleanup' of a formula is a numeric change and requires a version bump."*
 * Adding a new abstention branch changes which inputs produce a result at all, which is exactly
 * that kind of change.
 *
 * `contracts/primitives.ts`'s `insufficiencyReason` already carries `methodology_version_boundary`
 * (migration `0002`'s `provider_methodology_version` column anticipated this) — used here rather
 * than inventing the spec prose's `methodology_changed`, since the reason has to be one the
 * artifact's zod schema actually accepts.
 */
import type { ComputeContext, ComputeResult } from '../artifact';

export const ATTENTION_RANK_CHANGE_V1_1_ID = 'attention.rank_change';
export const ATTENTION_RANK_CHANGE_V1_1_VERSION = '1.1.0';

const ABSENT_FROM_BOARD = '0';

export function computeAttentionRankChangeV1_1(ctx: ComputeContext): ComputeResult {
  const methodologyNow = ctx.identity('methodology_version_now');
  const methodologyPrior = ctx.identity('methodology_version_prior');

  // Checked first, and deliberately without a step: a boundary crossing makes the comparison
  // meaningless regardless of sample size, so it pre-empts every other eligibility question
  // rather than competing with them.
  if (methodologyNow !== methodologyPrior) {
    ctx.abstain({
      reason: 'methodology_version_boundary',
      message:
        `The attention board's methodology changed between the two observations (${methodologyPrior} ` +
        `→ ${methodologyNow}), so a rank change cannot be computed across them. Snapshots on ` +
        'either side of a methodology boundary are not comparable, and a delta computed across ' +
        'one would be a fabricated number rather than a measured move.',
    });
  }

  const rankNow = ctx.input('rank_now');
  const rankPrior = ctx.input('rank_prior');
  const mentionsNow = ctx.input('mentions_now');
  const minMentions = ctx.assumption('min_mentions');
  const boardSize = ctx.assumption('board_size');

  if (mentionsNow.lessThan(minMentions)) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        `This security was mentioned ${mentionsNow.toFixed()} time(s) in the window. At least ` +
        `${minMentions.toFixed()} are required before a rank change is shown, because below ` +
        'that floor the rank moves on too few observations to describe anything. No number is ' +
        'shown rather than a smaller one.',
    });
  }

  // Distinguished rather than folded into one `not_applicable` reason (lane-review): a security
  // new to the board and one that just fell off it are different, useful facts, and a UI that
  // wants to render "New" needs a field to read it from rather than re-deriving the state by
  // reading `rank_prior` out of the artifact's raw inputs — exactly what a registered method
  // exists to prevent it from having to do. A board is a top-N list either way; being absent
  // from it is not the same as being ranked last on it, and treating it as rank 0 would invent
  // the largest possible move — which is why both cases abstain rather than compute a delta.
  // Checked before the two single-ended cases below: a security absent from the board at BOTH
  // observations is neither "new to the board" (it isn't on the board now either) nor "dropped
  // from the board" (it wasn't on the board before either) — both of those messages would be
  // false. It never held a tracked position at all, which is a plain not-applicable case, not a
  // change of any kind. Found by a third lane-review pass: the two checks below were written as
  // independent `if`s, so this case silently fell into the first one and got a wrong message.
  if (rankPrior.equals(ABSENT_FROM_BOARD) && rankNow.equals(ABSENT_FROM_BOARD)) {
    ctx.abstain({
      reason: 'not_applicable',
      message:
        'This security was not on the attention board at either observation. There is no ' +
        'tracked position at either end to measure a change from or to.',
    });
  }

  if (rankPrior.equals(ABSENT_FROM_BOARD)) {
    ctx.abstain({
      reason: 'new_to_board',
      message:
        'This security was not on the attention board at the prior observation — it is new to ' +
        'the board since then, not a security whose rank moved. There is no earlier position to ' +
        'measure a change from.',
    });
  }

  if (rankNow.equals(ABSENT_FROM_BOARD)) {
    ctx.abstain({
      reason: 'dropped_from_board',
      message:
        'This security is not on the attention board at the current observation — it fell off ' +
        'the board since the prior one, not a security whose rank moved. There is no current ' +
        'position to measure a change to.',
    });
  }

  const delta = ctx.step({
    key: 'rank_delta',
    label: 'Ranks gained since the previous observation',
    expression: '{rank_prior} - {rank_now}',
    operands: { rank_prior: rankPrior, rank_now: rankNow },
    unit: 'ranks',
    evaluate: (operand) => operand('rank_prior').minus(operand('rank_now')),
  });

  const exceedsBoard = delta.decimal.abs().greaterThan(boardSize);
  if (exceedsBoard) {
    ctx.warn(
      'The measured move is larger than the board itself, which happens when the board changed ' +
        'size between the two observations. The value shown is clamped to the board size and ' +
        'should be read as "moved as far as the board allows", not as a measured distance.',
    );
  }

  const bounded = ctx.step({
    key: 'bounded_rank_delta',
    label: 'Clamped to the size of the board',
    expression: 'clamp({rank_delta}, -{board_size}, {board_size})',
    operands: { rank_delta: delta, board_size: boardSize },
    unit: 'ranks',
    status: exceedsBoard ? 'clamped' : 'applied',
    evaluate: (operand) => {
      const value = operand('rank_delta');
      const limit = operand('board_size');
      return value.greaterThan(limit)
        ? limit
        : value.lessThan(limit.negated())
          ? limit.negated()
          : value;
    },
  });

  return { value: bounded };
}
