/**
 * Shared, non-registered helper for §8.4/§8.7's price formulas (`price.regime`,
 * `price.volatility_20`, and technical context's moving averages / RSI / recent high-low).
 *
 * Not a method in its own right — `calc/` methods are one artifact each, and a helper that
 * multiple artifacts call is exactly how two "separately computed" numbers quietly stop being
 * separate. This stays a plain function, used identically inside each method's own compute call
 * rather than shared through any registered artifact.
 */
import { D, type Dec } from './decimal';
import { populationStdev } from './stats';

const ONE = new D('1');

/**
 * `close_0 .. close_{n-1}` (oldest to newest) → `n - 1` daily returns, `close_i/close_{i-1} - 1`.
 * `.slice(0, -1)` / `.slice(1)` pair adjacent closes without index arithmetic (`no-float-in-
 * analytics` forbids `i - 1` / `i + 1` on a numeric literal in this directory).
 */
export function dailyReturns(closes: readonly Dec[]): Dec[] {
  const prior = closes.slice(0, -1);
  const next = closes.slice(1);
  return next.map((close, index) => close.div(prior[index] as Dec).minus(ONE));
}

/** `stdev(daily_returns) * sqrt(252)` — source §8.4's `vol_20`, over whatever window it is given. */
export function annualisedVolatility(returns: readonly Dec[]): Dec {
  return populationStdev(returns).times(new D('252').sqrt());
}
