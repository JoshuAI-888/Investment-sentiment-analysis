/**
 * `attention.mention_delta` — source §8.1: `mention_delta = mentions_current - mentions_prior`.
 *
 * The absolute change in mention count. Always computable — unlike `mention_growth`, a delta
 * needs no denominator and so has nothing to protect against dividing by. §4.1's display rule
 * ("prior mentions < 5 ⇒ hide growth, show absolute delta") depends on this method staying
 * available exactly when `mention_growth` abstains — that is the reason this exists as its own
 * registered method rather than as a step inside `mention_growth`.
 */
import type { ComputeContext, ComputeResult } from '../artifact';

export const ATTENTION_MENTION_DELTA_ID = 'attention.mention_delta';
export const ATTENTION_MENTION_DELTA_VERSION = '1.0.0';

export function computeAttentionMentionDelta(ctx: ComputeContext): ComputeResult {
  const mentionsNow = ctx.input('mentions_now');
  const mentionsPrior = ctx.input('mentions_prior');

  const delta = ctx.step({
    key: 'mention_delta',
    label: 'Change in mentions since the previous observation',
    expression: '{mentions_now} - {mentions_prior}',
    operands: { mentions_now: mentionsNow, mentions_prior: mentionsPrior },
    unit: 'mentions',
    evaluate: (operand) => operand('mentions_now').minus(operand('mentions_prior')),
  });

  return { value: delta };
}
