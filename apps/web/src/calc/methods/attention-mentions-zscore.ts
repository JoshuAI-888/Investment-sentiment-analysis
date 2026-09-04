/**
 * `attention.mentions_zscore` — source §8.1's `robust_z`:
 *
 * ```text
 * x_t = log(1 + mentions_t)
 * robust_z = (x_t - median(x_history)) / max(1.4826 * MAD(x_history), epsilon)
 * ```
 *
 * *"Require at least 14 comparable snapshots before displaying the z-score."* `history_N` are
 * declared as individually-hashed, indexed inputs (`calc/series.ts`) — a mention count at each
 * prior snapshot, not yet log-transformed, so the same `x = ln(1+mentions)` transform the
 * formula names is applied identically to the current point and to history inside this method,
 * once, rather than expected of whatever assembles the inputs.
 *
 * Only the aggregate quantities (`x_t`, the median, the MAD, the scaled denominator, the ratio)
 * are recorded as steps. The per-history-point log transform is not: with a 14–30-element
 * window, one step per element would make the Inspector's trace unreadable and the golden
 * fixture unreviewable, for no auditability gain — every `history_N` value is still an
 * individually-hashed, individually-provenanced input regardless, which is what the trust story
 * in `02-ARCHITECTURE-CONTRACTS.md` §4.2 actually depends on.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { D, type Dec } from '../decimal';
import { readSeries, seriesLength } from '../series';
import { mad, median } from '../stats';

export const ATTENTION_MENTIONS_ZSCORE_ID = 'attention.mentions_zscore';
export const ATTENTION_MENTIONS_ZSCORE_VERSION = '1.0.0';

const ONE = new D('1');
/** `1.4826`: the constant that makes MAD a consistent estimator of the standard deviation
 *  under a normal distribution, transcribed exactly from source. */
const MAD_CONSISTENCY_CONSTANT = '1.4826';

function logOnePlus(value: Dec): Dec {
  return value.plus(ONE).ln();
}

export function computeAttentionMentionsZscore(ctx: ComputeContext): ComputeResult {
  const mentionsNow = ctx.input('mentions_now');
  const minHistory = ctx.assumption('min_history');
  const epsilon = ctx.assumption('epsilon');

  const historyCount = seriesLength(ctx, 'history');
  if (new D(String(historyCount)).lessThan(minHistory)) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        `${String(historyCount)} comparable snapshot(s) are available. At least ` +
        `${minHistory.toFixed()} are required before an anomaly z-score is shown, because a ` +
        'median and a spread estimated from fewer observations describe the sample more than ' +
        'they describe the security.',
    });
  }

  const history = readSeries(ctx, 'history', historyCount);
  const loggedHistory = history.map(logOnePlus);

  const xNow = ctx.step({
    key: 'x_t',
    label: 'Log-transformed current mentions',
    expression: 'ln(1 + {mentions_now})',
    operands: { mentions_now: mentionsNow },
    unit: 'log_mentions',
    evaluate: (operand) => logOnePlus(operand('mentions_now')),
  });

  const historyMedian = ctx.step({
    key: 'history_log_median',
    label: 'Median of log-transformed mentions over the comparison window',
    expression: 'median(ln(1 + history_i), i = 0..{history_count})',
    operands: { history_count: String(historyCount) },
    unit: 'log_mentions',
    evaluate: () => median(loggedHistory),
  });

  const historyMad = ctx.step({
    key: 'history_log_mad',
    label: 'Median absolute deviation of the same window',
    expression: 'MAD(ln(1 + history_i), i = 0..{history_count})',
    operands: { history_count: String(historyCount) },
    unit: 'log_mentions',
    evaluate: () => mad(loggedHistory),
  });

  const scaleExceedsEpsilon = historyMad.decimal
    .times(new D(MAD_CONSISTENCY_CONSTANT))
    .greaterThan(epsilon);
  const scale = ctx.step({
    key: 'scaled_mad',
    label: 'MAD scaled to a normal-consistent spread estimate, floored at epsilon',
    expression: 'max({mad_constant} * {history_log_mad}, {epsilon})',
    operands: { mad_constant: MAD_CONSISTENCY_CONSTANT, history_log_mad: historyMad, epsilon },
    unit: 'log_mentions',
    status: scaleExceedsEpsilon ? 'applied' : 'clamped',
    evaluate: (operand) => {
      const scaled = operand('history_log_mad').times(operand('mad_constant'));
      const floor = operand('epsilon');
      return scaled.greaterThan(floor) ? scaled : floor;
    },
  });

  const z = ctx.step({
    key: 'robust_z',
    label: 'Robust anomaly z-score',
    expression: '({x_t} - {history_log_median}) / {scaled_mad}',
    operands: { x_t: xNow, history_log_median: historyMedian, scaled_mad: scale },
    unit: 'z_score',
    evaluate: (operand) =>
      operand('x_t').minus(operand('history_log_median')).div(operand('scaled_mad')),
  });

  return { value: z };
}
