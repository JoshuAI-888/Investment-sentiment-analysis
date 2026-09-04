/**
 * `price.volatility_20` — source §8.4's `vol_20`, and the same figure §8.7 lists under
 * "technical context". Registered once rather than twice: source does not give the technical
 * context reading a different formula, so a second registration of the identical arithmetic
 * would be two artifacts a reader could not tell apart, computed from the same inputs, that
 * happen to agree by construction rather than by fact (F06 decision, recorded in the PR).
 *
 * `vol_20 = stdev(daily_returns over 20 sessions) * sqrt(252)`, population convention — see
 * `calc/stats.ts`'s `populationStdev` doc comment for why.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { annualisedVolatility, dailyReturns } from '../price-returns';
import { readSeries, seriesLength } from '../series';

export const PRICE_VOLATILITY_20_ID = 'price.volatility_20';
export const PRICE_VOLATILITY_20_VERSION = '1.0.0';

const WINDOW = 21;

export function computePriceVolatility20(ctx: ComputeContext): ComputeResult {
  const quoteKind = ctx.identity('quote_kind');
  if (quoteKind !== 'adjusted_close') {
    ctx.abstain({
      reason: 'not_applicable',
      message:
        `The price series is tagged '${quoteKind}', not 'adjusted_close'. §8.4 forbids mixing ` +
        'intraday and close-to-close returns in the same metric.',
    });
  }

  // A short history (a newly-listed security, a collection gap) has fewer than `WINDOW` closes
  // declared. `readSeries` throws for an undeclared key — right for a programmer error, wrong
  // for this real, expected input shape. Found by lane-review, same defect as `price.regime`.
  //
  // **Exactly `WINDOW`, not "at least"** — same reasoning as `price.regime`: `readSeries` reads
  // the *oldest* `WINDOW` of whatever is declared, so more than `WINDOW` closes silently
  // computes volatility over a stale window, not the current one. Found by a second lane-review
  // pass.
  const available = seriesLength(ctx, 'close');
  if (available !== WINDOW) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        `${String(available)} close(s) were found. Exactly ${String(WINDOW)} sessions of ` +
        'adjusted daily closes — the most recent 20-session window, no more and no fewer — are ' +
        'required for a volatility read.',
    });
  }

  const closes = readSeries(ctx, 'close', WINDOW);
  for (const close of closes) {
    if (close.lessThanOrEqualTo('0')) {
      ctx.abstain({
        reason: 'not_applicable',
        message:
          'One of the closes in the window is zero or negative, which is not a real traded price.',
      });
    }
  }

  const returns = dailyReturns(closes);
  const vol20 = ctx.step({
    key: 'vol_20',
    label: '20-session annualised volatility',
    expression: 'stdev(daily_returns) * sqrt(252)',
    operands: { window: String(WINDOW) },
    unit: 'ratio',
    evaluate: () => annualisedVolatility(returns),
  });

  return { value: vol20 };
}
