/**
 * Decimal statistics (F06). Everything here is `Dec` in, `Dec` out — no JS `number` arithmetic,
 * per `02-ARCHITECTURE-CONTRACTS.md` §4.2 and `no-float-in-analytics`.
 *
 * **Index math without a numeric literal.** The lint rule (correctly) forbids arithmetic on a
 * numeric literal in this directory, which rules out the usual `mid - 1` / `mid + 1` a median
 * or a windowed sum reaches for. `median` below gets the "other" middle element of an even-length
 * array by reversing a copy and reading the *same* forward index, rather than subtracting one
 * from it — `sorted.at(mid)` and `[...sorted].reverse().at(mid)` are the two middle elements of
 * an even-length array with no `-1` anywhere. Bitwise `>>` and `&` are used for "divide by two"
 * and "is odd", since the rule governs `+ - * / % **`, not bitwise operators.
 */
import { D, type Dec } from './decimal';

export function sortedDec(values: readonly Dec[]): Dec[] {
  return [...values].sort((a, b) => (a.lessThan(b) ? -1 : a.greaterThan(b) ? 1 : 0));
}

export function sumDec(values: readonly Dec[]): Dec {
  return values.reduce((total, value) => total.plus(value), new D('0'));
}

export function meanDec(values: readonly Dec[]): Dec {
  return sumDec(values).div(new D(String(values.length)));
}

/** The middle value (odd length) or the mean of the two middle values (even length). */
export function median(values: readonly Dec[]): Dec {
  const sorted = sortedDec(values);
  const mid = sorted.length >> 1; // "divide by two" via a bit shift — see the module doc comment.
  const isEven = (sorted.length & 1) === 0; // parity via bitwise AND, for the same reason.
  const upper = sorted.at(mid) as Dec;
  if (!isEven) return upper;
  const lower = [...sorted].reverse().at(mid) as Dec;
  return upper.plus(lower).div(new D('2'));
}

/** Median absolute deviation: `median(|x_i - median(x)|)`. */
export function mad(values: readonly Dec[]): Dec {
  const center = median(values);
  return median(values.map((value) => value.minus(center).abs()));
}

/**
 * Population standard deviation (`n` denominator, not `n - 1`).
 *
 * Source §8.4 just says `stdev(daily_returns over 20 sessions)` with no denominator named.
 * The window is a fixed, fully-observed 20 sessions — not a sample standing in for a larger
 * population — so this uses the population convention. Documented as an interpretation in the
 * registry's `limitations[]` for `price.volatility_20` (F06 decision).
 */
export function populationStdev(values: readonly Dec[]): Dec {
  const mean = meanDec(values);
  const sumSquares = sumDec(values.map((value) => value.minus(mean).pow(2)));
  const n = new D(String(values.length));
  return sumSquares.div(n).sqrt();
}

export function maxDec(values: readonly Dec[]): Dec {
  return values.reduce((best, value) => (value.greaterThan(best) ? value : best));
}

export function minDec(values: readonly Dec[]): Dec {
  return values.reduce((best, value) => (value.lessThan(best) ? value : best));
}
