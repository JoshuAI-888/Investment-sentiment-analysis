/**
 * `attention.mention_growth` — source §8.1: `mention_growth = mention_delta / max(mentions_prior, 1)`.
 *
 * §4.1's display rule, verbatim: *"If prior mentions < 5, hide `mention_growth` and display
 * absolute delta."* That is an abstention, not a display toggle a UI decides on its own — below
 * the floor, a ratio over a handful of mentions swings enormously for a change of one or two,
 * which reads as a trend it is not. The floor is the same `min_mentions` shape as
 * `attention.rank_change`'s, applied to the *prior* window rather than the current one.
 *
 * The `max(mentions_prior, 1)` denominator guard is transcribed exactly from source, but it
 * never actually fires here: `mentions_prior < 5` already aborts the computation before the
 * division, so the only remaining values of `mentions_prior` are `>= 5` — the guard is kept in
 * the trace anyway because the formula names it and an executable specification does not get to
 * drop a term it happens not to need today.
 */
import type { ComputeContext, ComputeResult } from '../artifact';

export const ATTENTION_MENTION_GROWTH_ID = 'attention.mention_growth';
export const ATTENTION_MENTION_GROWTH_VERSION = '1.0.0';

export function computeAttentionMentionGrowth(ctx: ComputeContext): ComputeResult {
  const mentionsNow = ctx.input('mentions_now');
  const mentionsPrior = ctx.input('mentions_prior');
  const minMentions = ctx.assumption('min_mentions');

  if (mentionsPrior.lessThan(minMentions)) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        `The prior window had ${mentionsPrior.toFixed()} mention(s). At least ` +
        `${minMentions.toFixed()} are required before growth is shown as a ratio, because a ` +
        'ratio over a handful of mentions swings enormously for a change of one or two. The ' +
        'absolute change (attention.mention_delta) is shown instead.',
    });
  }

  const delta = ctx.step({
    key: 'mention_delta',
    label: 'Change in mentions since the previous observation',
    expression: '{mentions_now} - {mentions_prior}',
    operands: { mentions_now: mentionsNow, mentions_prior: mentionsPrior },
    unit: 'mentions',
    evaluate: (operand) => operand('mentions_now').minus(operand('mentions_prior')),
  });

  const one = '1';
  const guardedPriorExceeds = mentionsPrior.greaterThan(one);
  const guardedPrior = ctx.step({
    key: 'guarded_prior',
    label: 'Prior mentions, floored at one to avoid dividing by zero',
    expression: 'max({mentions_prior}, {floor})',
    operands: { mentions_prior: mentionsPrior, floor: one },
    unit: 'mentions',
    status: guardedPriorExceeds ? 'applied' : 'clamped',
    evaluate: (operand) => {
      const prior = operand('mentions_prior');
      const floor = operand('floor');
      return prior.greaterThan(floor) ? prior : floor;
    },
  });

  const growth = ctx.step({
    key: 'mention_growth',
    label: 'Proportional change in mentions',
    expression: '{mention_delta} / {guarded_prior}',
    operands: { mention_delta: delta, guarded_prior: guardedPrior },
    unit: 'ratio',
    evaluate: (operand) => operand('mention_delta').div(operand('guarded_prior')),
  });

  return { value: growth };
}
