/**
 * Formatting helpers shared between `AttentionTable` (the per-row cells) and `NotableMovers` (the
 * headline card) — round-33 lane-review finding 2 found the card disclosing neither a Δ Rank's
 * comparison window nor its source while the table's own row for the identical security discloses
 * both. Extracted here rather than duplicated so the two surfaces cannot independently drift on
 * what the same underlying fields mean.
 */

/**
 * Lane-review finding 2 (originally on `AttentionTable.tsx`): the actual span, not a fixed
 * provider-window constant — a sub-hour gap (a real dispatch cadence, once F16a exists) renders in
 * minutes rather than being rounded up into a misleadingly large "N-hour" label.
 *
 * `suffix` — round-29 lane-review finding 1. This label was reused, unqualified, for two
 * genuinely different spans: the gap between two *local* observations (a row's own Δ Rank
 * comparison) and, via `CoverageLabel` for the z-score, the depth-14+ history span. `suffix` names
 * what the number actually spans at each call site instead of a single ambiguous phrase for both.
 */
export function windowLabel(hours: number, suffix: string): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${String(minutes)}-minute ${suffix}`;
  }
  const rounded = Math.round(hours * 10) / 10;
  const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${display}-hour ${suffix}`;
}

/**
 * The base source caption for a Δ Rank value — round-33 lane-review finding 2 needed the
 * identical wording on `NotableMovers`'s card that `AttentionTable.tsx`'s `rankChangeSourceLabel`
 * used to give the same security's row on its own, before round 42 lane-review finding 2 moved
 * the warm-up layering here too (see `rankChangeCaption` below). Exported on its own because a
 * provider-defined value never carries a warm-up qualifier regardless of caller.
 */
export function rankChangeSourceCaption(source: 'own_history' | 'provider_reported'): string {
  return source === 'provider_reported' ? 'provider-defined' : "this deployment's own comparison";
}

/**
 * Round-42 lane-review finding 2, correcting round 33's own split. `AttentionTable.tsx`'s
 * `rankChangeSourceLabel` used to layer this warm-up qualifier on top of `rankChangeSourceCaption`
 * locally, reasoning `NotableMoverView` "does not need" `historyDepth` — but the depth-14 warm-up
 * disclosure is exactly as load-bearing on the headline card as it is on the table row: F08 §4.1
 * requires it on every rendered Δ Rank, and `selectNotableMovers` picks movers from the identical
 * `AttentionRowView` the table renders, `historyDepth` included. A warm-up-window delta (as few as
 * two comparable observations) sat on the card indistinguishable from a matured one, on the
 * surface that ranks deltas against each other by raw magnitude. Unified here so the two surfaces
 * can no longer independently drift on what "own_history" means without a qualifier.
 */
export function rankChangeCaption(source: 'own_history' | 'provider_reported', isWarmingUp: boolean): string {
  const base = rankChangeSourceCaption(source);
  if (source === 'provider_reported') return base;
  return isWarmingUp ? `${base} — warm-up window` : base;
}
