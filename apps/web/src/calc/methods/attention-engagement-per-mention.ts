/**
 * `attention.engagement_per_mention` — source §8.1:
 * `engagement_per_mention = engagement / max(mentions_current, 1)`.
 *
 * Always computable. The `max(..., 1)` guard is the whole eligibility story here — there is no
 * sample floor named for this metric in §4.1, only the divide-by-zero guard the formula itself
 * carries, transcribed exactly.
 */
import type { ComputeContext, ComputeResult } from '../artifact';

export const ATTENTION_ENGAGEMENT_PER_MENTION_ID = 'attention.engagement_per_mention';
export const ATTENTION_ENGAGEMENT_PER_MENTION_VERSION = '1.0.0';

export function computeAttentionEngagementPerMention(ctx: ComputeContext): ComputeResult {
  const engagement = ctx.input('engagement');
  const mentionsNow = ctx.input('mentions_now');

  const floor = '1';
  const exceedsFloor = mentionsNow.greaterThan(floor);
  const guardedMentions = ctx.step({
    key: 'guarded_mentions',
    label: 'Current mentions, floored at one to avoid dividing by zero',
    expression: 'max({mentions_now}, {floor})',
    operands: { mentions_now: mentionsNow, floor },
    unit: 'mentions',
    status: exceedsFloor ? 'applied' : 'clamped',
    evaluate: (operand) => {
      const mentions = operand('mentions_now');
      const guard = operand('floor');
      return mentions.greaterThan(guard) ? mentions : guard;
    },
  });

  const perMention = ctx.step({
    key: 'engagement_per_mention',
    label: 'Engagement divided by mentions',
    expression: '{engagement} / {guarded_mentions}',
    operands: { engagement, guarded_mentions: guardedMentions },
    unit: 'ratio',
    evaluate: (operand) => operand('engagement').div(operand('guarded_mentions')),
  });

  return { value: perMention };
}
