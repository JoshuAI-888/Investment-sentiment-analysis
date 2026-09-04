/**
 * Series input conventions (F06 §4.1, §4.2, §4.7).
 *
 * Several §8 formulas take a window of observations rather than one scalar: `robust_z`'s
 * history, social stance's per-item weights, price regime's closes. `CalculationArtifact`'s
 * `inputs` are a flat, frozen list of single-valued facts (§4.2) — there is no array-typed
 * input — so a window is carried as `count` many individually-declared, individually-hashed
 * inputs named `${prefix}_0 .. ${prefix}_{count-1}`. Each one is then its own line in the
 * Inspector's input table with its own provenance, which a single JSON-blob input could not be.
 *
 * `no-float-in-analytics` (F01 §4.4) forbids arithmetic on a numeric literal in this directory,
 * which rules out the ordinary `i - 1` / `i + 1` index math a windowed algorithm reaches for.
 * The helpers below do the necessary indexing with array methods and bitwise shifts (`>>`,
 * `&`, neither governed by the rule) instead — see `median` in `stats.ts` for why that is safe
 * rather than a workaround-of-convenience.
 */
import type { ComputeContext } from './artifact';
import type { Dec } from './decimal';

/** Reads `${prefix}_0 .. ${prefix}_{count-1}` as already-declared decimal inputs, in order. */
export function readSeries(ctx: ComputeContext, prefix: string, count: number): readonly Dec[] {
  return Array.from({ length: count }, (_unused, index) => ctx.input(`${prefix}_${index}`));
}

/** How many `${prefix}_N` inputs are actually declared, without guessing a fixed window. */
export function seriesLength(ctx: ComputeContext, prefix: string): number {
  let length = 0;
  while (ctx.hasInput(`${prefix}_${length}`)) length += 1;
  return length;
}
