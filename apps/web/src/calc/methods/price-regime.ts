/**
 * `price.regime` — source §8.4:
 *
 * ```text
 * r_5 = close_t / close_t-5 - 1
 * r_20 = close_t / close_t-20 - 1
 * vol_20 = stdev(daily_returns over 20 sessions) * sqrt(252)
 * trend_strength = clamp((0.6 * r_5 + 0.4 * r_20) / max(vol_20 / sqrt(252), 0.005), -3, 3) / 3
 * ```
 *
 * *"Use adjusted daily closes for regime calculations. Do not mix intraday and close-to-close
 * returns in the same metric."* Enforced here, not just documented: every computation declares
 * a `quote_kind` identity input, and the method abstains rather than compute if it is not
 * `adjusted_close` — a registry-level prohibition with a test, per the build spec.
 *
 * Takes 21 closes (`close_0` oldest .. `close_20` = `close_t`) — `close_15` is `close_t-5`,
 * `close_0` is `close_t-20`. `vol_20/sqrt(252)` in the denominator is algebraically
 * `populationStdev(daily returns)` (that is what `vol_20` was multiplied by `sqrt(252)` to
 * become) — reused directly as the same `Dec` rather than re-derived by dividing `vol_20` back
 * out, which would just reintroduce the rounding this avoids for no change in what is computed.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { annualisedVolatility, dailyReturns } from '../price-returns';
import { D } from '../decimal';
import { readSeries, seriesLength } from '../series';

export const PRICE_REGIME_ID = 'price.regime';
export const PRICE_REGIME_VERSION = '1.0.0';

const WINDOW = 21;
const THREE = new D('3');
const VOL_FLOOR = '0.005';
const R5_WEIGHT = '0.6';
const R20_WEIGHT = '0.4';

export function computePriceRegime(ctx: ComputeContext): ComputeResult {
  const quoteKind = ctx.identity('quote_kind');
  if (quoteKind !== 'adjusted_close') {
    ctx.abstain({
      reason: 'not_applicable',
      message:
        `The price series is tagged '${quoteKind}', not 'adjusted_close'. Source §8.4 requires ` +
        'adjusted daily closes for regime calculations and forbids mixing intraday and ' +
        'close-to-close returns in the same metric — this is a registry-level prohibition, not ' +
        'a preference, so the computation stops rather than mix quote kinds.',
    });
  }

  // A newly-listed security, a name with fewer than 21 sessions of history, or a collection gap
  // (D-16 guarantees these exist; §6.8 forbids interpolating across one) all have fewer than
  // `WINDOW` closes declared. `readSeries` reads a fixed count and throws `ArtifactBuildError`
  // for a key that was never declared — appropriate for a programmer error, wrong for a real,
  // expected input shape this method must instead abstain on. Found by lane-review: this was an
  // uncaught throw, not an artifact, for the single most likely real-world short-history input.
  //
  // **Exactly `WINDOW`, not "at least".** `readSeries` reads `close_0..close_{WINDOW-1}` — the
  // oldest `WINDOW` of whatever is declared, not the most recent. A caller handing in *more*
  // than `WINDOW` closes (a full price history, say, on the assumption "the method takes what
  // it needs") would silently compute over a stale window ending days or weeks in the past,
  // `close_t` would not be today's close, and nothing here would notice or warn — a wrong
  // number rendered as a current one. Found by a second lane-review pass. The contract this
  // method holds callers to is therefore "declare precisely the most recent `WINDOW` sessions",
  // and a mismatch in either direction abstains rather than guessing which end to trim.
  const available = seriesLength(ctx, 'close');
  if (available !== WINDOW) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        `${String(available)} close(s) were found. Exactly ${String(WINDOW)} sessions of ` +
        'adjusted daily closes — the most recent 20-session window, no more and no fewer — are ' +
        'required for a regime read; a shorter history has no window to compute the 5- and ' +
        '20-session returns over, and a longer one would silently compute over a stale window ' +
        'rather than the current one.',
    });
  }

  const closes = readSeries(ctx, 'close', WINDOW);
  for (const close of closes) {
    if (close.lessThanOrEqualTo('0')) {
      ctx.abstain({
        reason: 'not_applicable',
        message:
          'One of the closes in the window is zero or negative, which is not a real traded ' +
          'price. A regime computed across a bad price would be a fabricated number.',
      });
    }
  }

  const closeNow = closes.at(-1) as (typeof closes)[number];
  const closeT5 = closes.at(-6) as (typeof closes)[number];
  const closeT20 = closes.at(0) as (typeof closes)[number];

  const r5 = ctx.step({
    key: 'r_5',
    label: '5-session return',
    expression: '{close_t} / {close_t_minus_5} - 1',
    operands: { close_t: closeNow, close_t_minus_5: closeT5 },
    unit: 'ratio',
    evaluate: (operand) => operand('close_t').div(operand('close_t_minus_5')).minus('1'),
  });

  const r20 = ctx.step({
    key: 'r_20',
    label: '20-session return',
    expression: '{close_t} / {close_t_minus_20} - 1',
    operands: { close_t: closeNow, close_t_minus_20: closeT20 },
    unit: 'ratio',
    evaluate: (operand) => operand('close_t').div(operand('close_t_minus_20')).minus('1'),
  });

  const returns = dailyReturns(closes);
  const rawStdev = annualisedVolatility(returns).div(new D('252').sqrt());

  const vol20 = ctx.step({
    key: 'vol_20',
    label: '20-session annualised volatility',
    expression: 'stdev(daily_returns) * sqrt(252)',
    operands: { window: String(WINDOW) },
    unit: 'ratio',
    evaluate: () => annualisedVolatility(returns),
  });

  const denominatorExceedsFloor = rawStdev.greaterThan(VOL_FLOOR);
  const denominator = ctx.step({
    key: 'trend_denominator',
    label: 'Volatility scale, floored so a near-zero-volatility security cannot blow up the trend',
    expression: 'max({vol_20} / sqrt(252), {vol_floor})',
    operands: { vol_20: vol20, vol_floor: VOL_FLOOR },
    unit: 'ratio',
    status: denominatorExceedsFloor ? 'applied' : 'clamped',
    evaluate: () => (rawStdev.greaterThan(VOL_FLOOR) ? rawStdev : new D(VOL_FLOOR)),
  });

  const numerator = ctx.step({
    key: 'trend_numerator',
    label: 'Weighted blend of the 5- and 20-session returns',
    expression: '{r5_weight} * {r_5} + {r20_weight} * {r_20}',
    operands: { r5_weight: R5_WEIGHT, r_5: r5, r20_weight: R20_WEIGHT, r_20: r20 },
    unit: 'ratio',
    evaluate: (operand) =>
      operand('r5_weight').times(operand('r_5')).plus(operand('r20_weight').times(operand('r_20'))),
  });

  const rawTrend = numerator.decimal.div(denominator.decimal);
  const exceedsUpper = rawTrend.greaterThan(THREE);
  const exceedsLower = rawTrend.lessThan(THREE.negated());
  const clamped = ctx.step({
    key: 'trend_clamped',
    label: 'Trend ratio, clamped to ±3',
    expression: 'clamp({trend_numerator} / {trend_denominator}, -3, 3)',
    operands: { trend_numerator: numerator, trend_denominator: denominator },
    unit: 'ratio',
    status: exceedsUpper || exceedsLower ? 'clamped' : 'applied',
    evaluate: (operand) => {
      const raw = operand('trend_numerator').div(operand('trend_denominator'));
      if (raw.greaterThan(THREE)) return THREE;
      if (raw.lessThan(THREE.negated())) return THREE.negated();
      return raw;
    },
  });

  const trendStrength = ctx.step({
    key: 'trend_strength',
    label: 'Trend strength, scaled to [-1, 1]',
    expression: '{trend_clamped} / 3',
    operands: { trend_clamped: clamped, three: '3' },
    unit: 'trend_unit',
    evaluate: (operand) => operand('trend_clamped').div(operand('three')),
  });

  return { value: trendStrength };
}
