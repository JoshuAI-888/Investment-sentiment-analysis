/**
 * `technical.recent_high_20` / `technical.recent_low_20` — source §8.7: *"recent high/low"*.
 *
 * Computed over the same adjusted-close series as the rest of technical context and price
 * regime, not a separate intraday high/low series — §8.4's "do not mix intraday and
 * close-to-close returns in the same metric" is a prohibition on *mixing*, and holding every
 * technical-context figure to adjusted closes is the reading of it that cannot mix anything by
 * construction. Documented as a limitation: this is "highest/lowest closing price", not
 * "highest/lowest intraday print".
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { readSeries, seriesLength } from '../series';
import { maxDec, minDec } from '../stats';

export const TECHNICAL_RECENT_RANGE_VERSION = '1.0.0';
const WINDOW = 20;

export function makeRecentExtremumCompute(kind: 'high' | 'low') {
  return function computeRecentExtremum(ctx: ComputeContext): ComputeResult {
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
    // **Exactly `WINDOW`, not "at least"** — `readSeries` reads the *oldest* `WINDOW` of
    // whatever is declared, a different set of values entirely from the most recent `WINDOW`,
    // so more closes than `WINDOW` would silently report the high/low of a stale range rather
    // than the current one. Found by a second lane-review pass.
    const available = seriesLength(ctx, 'close');
    if (available !== WINDOW) {
      ctx.abstain({
        reason: 'below_sample_threshold',
        message:
          `${String(available)} close(s) were found. Exactly ${String(WINDOW)} sessions of ` +
          `adjusted daily closes — the most recent window, no more and no fewer — are required ` +
          `for the recent ${kind}.`,
      });
    }

    const closes = readSeries(ctx, 'close', WINDOW);
    const extremum = ctx.step({
      key: `recent_${kind}`,
      label: `${kind === 'high' ? 'Highest' : 'Lowest'} adjusted close over ${String(WINDOW)} sessions`,
      expression: kind === 'high' ? 'max(close_0 .. close_n)' : 'min(close_0 .. close_n)',
      operands: { window: String(WINDOW) },
      unit: 'price',
      evaluate: () => (kind === 'high' ? maxDec(closes) : minDec(closes)),
    });

    return { value: extremum };
  };
}

export const TECHNICAL_RECENT_HIGH_20_ID = 'technical.recent_high_20';
export const computeTechnicalRecentHigh20 = makeRecentExtremumCompute('high');

export const TECHNICAL_RECENT_LOW_20_ID = 'technical.recent_low_20';
export const computeTechnicalRecentLow20 = makeRecentExtremumCompute('low');
