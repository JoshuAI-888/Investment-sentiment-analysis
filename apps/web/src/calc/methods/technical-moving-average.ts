/**
 * `technical.moving_average_20` / `technical.moving_average_50` — source §8.7: *"20/50-day
 * moving averages"*. One factory, two registrations — the window is a fact about which metric
 * this is (like `attention.rank_change`'s `board_size`), not a parameter a caller supplies, so
 * it is baked into the compute function at module load rather than read from an input or an
 * editable assumption.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { readSeries, seriesLength } from '../series';
import { meanDec } from '../stats';

export const TECHNICAL_MOVING_AVERAGE_VERSION = '1.0.0';

export function makeMovingAverageCompute(window: number) {
  return function computeMovingAverage(ctx: ComputeContext): ComputeResult {
    const quoteKind = ctx.identity('quote_kind');
    if (quoteKind !== 'adjusted_close') {
      ctx.abstain({
        reason: 'not_applicable',
        message: `The price series is tagged '${quoteKind}', not 'adjusted_close'.`,
      });
    }

    // A short history has fewer than `window` closes declared. `readSeries` throws for an
    // undeclared key — right for a programmer error, wrong for this real, expected input shape.
    // Found by lane-review, same defect as `price.regime`.
    //
    // **Exactly `window`, not "at least"** — `readSeries` reads the *oldest* `window` of
    // whatever is declared, so more than `window` closes silently averages a stale range, not
    // the current one. Found by a second lane-review pass.
    const available = seriesLength(ctx, 'close');
    if (available !== window) {
      ctx.abstain({
        reason: 'below_sample_threshold',
        message:
          `${String(available)} close(s) were found. Exactly ${String(window)} sessions of ` +
          'adjusted daily closes — the most recent window, no more and no fewer — are required ' +
          'for this moving average.',
      });
    }

    const closes = readSeries(ctx, 'close', window);
    const average = ctx.step({
      key: 'moving_average',
      label: `${String(window)}-session moving average`,
      expression: 'mean(close_0 .. close_n)',
      operands: { window: String(window) },
      unit: 'price',
      evaluate: () => meanDec(closes),
    });

    return { value: average };
  };
}

export const TECHNICAL_MOVING_AVERAGE_20_ID = 'technical.moving_average_20';
export const computeTechnicalMovingAverage20 = makeMovingAverageCompute(20);

export const TECHNICAL_MOVING_AVERAGE_50_ID = 'technical.moving_average_50';
export const computeTechnicalMovingAverage50 = makeMovingAverageCompute(50);
