/**
 * `technical.rsi_14` — source §8.7: *"The PoV may compute RSI(14) ... It must not call an LLM
 * to compute them."* Source gives no formula, only the name; this is the standard Wilder RSI(14)
 * definition, using a **simple mean** of the 14 gains/losses rather than Wilder's exponential
 * smoothing — documented as a transcription choice in the registry's `limitations[]`, since
 * source names no smoothing method and a simple mean is the more auditable of the two common
 * readings of "RSI(14)".
 *
 * ```text
 * change_i = close_i - close_{i-1}, i = 1..14  (15 closes in, 14 changes)
 * avg_gain = mean(max(change_i, 0))
 * avg_loss = mean(max(-change_i, 0))
 * RSI = 100 - 100 / (1 + avg_gain/avg_loss)
 * ```
 *
 * `avg_loss = 0` (no losing session in the window) makes RSI = 100 rather than dividing by
 * zero. Both `avg_gain` and `avg_loss` zero (every close identical) is the one genuine
 * indeterminate case, and is reported as the conventional neutral reading, 50, rather than
 * abstaining — a flat 14-session run is a real, observable state, not missing data.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { D, type Dec } from '../decimal';
import { readSeries, seriesLength } from '../series';
import { meanDec } from '../stats';

export const TECHNICAL_RSI_14_ID = 'technical.rsi_14';
export const TECHNICAL_RSI_14_VERSION = '1.0.0';

const WINDOW = 15;
const ZERO = new D('0');
const HUNDRED = new D('100');
const NEUTRAL_RSI = new D('50');

export function computeTechnicalRsi14(ctx: ComputeContext): ComputeResult {
  const quoteKind = ctx.identity('quote_kind');
  if (quoteKind !== 'adjusted_close') {
    ctx.abstain({
      reason: 'not_applicable',
      message: `The price series is tagged '${quoteKind}', not 'adjusted_close'.`,
    });
  }

  // A short history has fewer than `WINDOW` closes declared. `readSeries` throws for an
  // undeclared key — right for a programmer error, wrong for this real, expected input shape.
  // Found by lane-review, same defect as `price.regime`.
  //
  // **Exactly `WINDOW`, not "at least"** — `readSeries` reads the *oldest* `WINDOW` of whatever
  // is declared, a different set of values entirely from the most recent `WINDOW`, so more
  // closes than `WINDOW` would silently compute RSI over a stale window rather than the current
  // one. Found by a second lane-review pass.
  const available = seriesLength(ctx, 'close');
  if (available !== WINDOW) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        `${String(available)} close(s) were found. Exactly ${String(WINDOW)} sessions of ` +
        'adjusted daily closes — the most recent window, no more and no fewer — are required ' +
        'for RSI(14).',
    });
  }

  const closes = readSeries(ctx, 'close', WINDOW);
  const prior = closes.slice(0, -1);
  const next = closes.slice(1);
  const changes: Dec[] = next.map((close, index) => close.minus(prior[index] as Dec));

  const gains = changes.map((change) => (change.greaterThan(ZERO) ? change : ZERO));
  const losses = changes.map((change) => (change.lessThan(ZERO) ? change.negated() : ZERO));

  const avgGain = meanDec(gains);
  const avgLoss = meanDec(losses);
  const isFlatWindow = avgLoss.isZero() && avgGain.isZero();
  const isNoLossWindow = avgLoss.isZero() && !avgGain.isZero();

  // Both substitutions below (RSI=50 for a flat window, RSI=100 for a no-loss window) stand in
  // for a division by zero that the real formula cannot perform — a genuine clamp, not an
  // ordinarily-computed value, and marked `status: 'clamped'` plus a warning so a reader sees the
  // substitution rather than mistaking either figure for a normal RSI(14) read. Found by a third
  // lane-review pass: the registry already documented this as a `clamp`, but the step itself
  // carried no such marking.
  if (isFlatWindow || isNoLossWindow) {
    ctx.warn(
      isFlatWindow
        ? 'Every close in the window is identical — no gains and no losses — so RSI(14) is ' +
            'reported as the conventional neutral reading, 50, rather than computed.'
        : 'No losing session in the window, so avg_loss is zero. RSI(14) is reported as 100 ' +
            '— the formula\'s ceiling — rather than dividing by zero.',
    );
  }

  const rsi = ctx.step({
    key: 'rsi_14',
    label: 'Relative strength index (14-session, simple mean)',
    expression: '100 - 100 / (1 + mean(gains) / mean(losses))',
    operands: { window: String(WINDOW) },
    unit: 'index_point',
    status: isFlatWindow || isNoLossWindow ? 'clamped' : 'applied',
    evaluate: () => {
      if (isFlatWindow) return NEUTRAL_RSI;
      if (isNoLossWindow) return HUNDRED;
      const rs = avgGain.div(avgLoss);
      return HUNDRED.minus(HUNDRED.div(rs.plus('1')));
    },
  });

  return { value: rsi };
}
