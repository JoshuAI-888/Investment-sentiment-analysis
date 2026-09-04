/**
 * `attention.rank_change` — F05's one registered method, end to end (§2).
 *
 * The change in a security's position on an attention board over 24 hours, in ranks gained.
 * Positive means it moved toward rank 1.
 *
 * It is deliberately the simplest arithmetic in the product, because what is being demonstrated
 * here is not the formula. It is the shape every later method has to take: the value comes out
 * of `ctx.step()`, so the trace and the number are the same object, and there is no way to write
 * this function such that the Inspector shows a derivation the result did not follow.
 *
 * The declarative half — bounds, limitations, rounding, formula text — lives in
 * `analytics/registry.ts`. See the note at the top of `calc/registry.ts` for why they are apart.
 */
import type { ComputeContext, ComputeResult } from '../artifact';

export const ATTENTION_RANK_CHANGE_ID = 'attention.rank_change';
export const ATTENTION_RANK_CHANGE_VERSION = '1.0.0';

/**
 * The rank a board reports for a security it is not currently listing. ApeWisdom's boards are
 * top-N, so "absent" and "ranked 0" are the same observation, and neither is a rank.
 */
const ABSENT_FROM_BOARD = '0';

export function computeAttentionRankChange(ctx: ComputeContext): ComputeResult {
  const rankNow = ctx.input('rank_now');
  const rankPrior = ctx.input('rank_prior');
  const mentionsNow = ctx.input('mentions_now');
  const minMentions = ctx.assumption('min_mentions');
  const boardSize = ctx.assumption('board_size');

  // Product invariant §6.3: below the sample floor the answer is a stated abstention, not a
  // smaller number. A rank computed off three mentions is a rank computed off three people.
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

  // Not the same statement as "insufficient data". There is no earlier rank at all, so there is
  // nothing to subtract — which the Inspector renders as a reason rather than a blank (§7.5).
  if (rankPrior.equals(ABSENT_FROM_BOARD) || rankNow.equals(ABSENT_FROM_BOARD)) {
    ctx.abstain({
      reason: 'not_applicable',
      message:
        'This security was not on the attention board at one end of the comparison, so there is ' +
        'no earlier position to measure a change from. A board is a top-N list; being absent ' +
        'from it is not the same as being ranked last on it, and treating it as rank 0 would ' +
        'invent the largest possible move.',
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

  // A move larger than the board is arithmetically impossible on a fixed top-N list, so it
  // reports a board that changed size between the two observations rather than a real move.
  // Clamping keeps the artifact honest about which of the two it is: the step's status says
  // `clamped` and the warning says why.
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
