/**
 * Reading an append-only score history — the read-side counterpart of F20 §4.4's write rule.
 *
 * Nothing is ever recomputed in place, so an item's history is a chain: an initial row, then
 * zero or more successors, each naming the row it supersedes. "The current score" is therefore
 * a *query*, not a column, and this module is the only place that answers it.
 *
 * There is no arithmetic here and there is deliberately none anywhere in this path — the score
 * values are carried as decimal strings from the wire to the store and back, and F06 owns every
 * operation that combines them.
 */
import type { ScoreRow } from './ports';

/**
 * The rows nothing supersedes. A superseded predecessor stays readable and hash-verifiable
 * (§4.4, F20 §7 step 7) — it is excluded from the current view, never deleted or altered.
 */
export function liveScores(rows: readonly ScoreRow[]): readonly ScoreRow[] {
  const superseded = new Set(
    rows.map((row) => row.supersedesScoreId).filter((id): id is string => id !== null),
  );
  return rows.filter((row) => !superseded.has(row.scoreId));
}

/**
 * The live row per item.
 *
 * Two live rows for one item means two independent scorings of the same item, which the queue's
 * idempotency contract is meant to prevent. It is resolved rather than thrown — a rendered page
 * must not 500 on a duplicated row — by the latest `recordedAt`, with `scoreId` as a total
 * tie-break so the answer is the same on every call and on every replica. `stance-availability`
 * still refuses the window if those rows disagree on `scorerVersion`, which is the case that
 * actually matters (Tier D3).
 */
export function latestScoreByItem(rows: readonly ScoreRow[]): Map<string, ScoreRow> {
  const byItem = new Map<string, ScoreRow>();
  for (const row of liveScores(rows)) {
    const current = byItem.get(row.itemId);
    if (current === undefined || compareRecency(row, current) > 0) byItem.set(row.itemId, row);
  }
  return byItem;
}

function compareRecency(a: ScoreRow, b: ScoreRow): number {
  const byTime = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
  if (byTime !== 0) return byTime;
  return a.scoreId < b.scoreId ? -1 : a.scoreId > b.scoreId ? 1 : 0;
}

/** Every distinct `scorerVersion` in a set of rows, sorted — Tier D3's "no series mixes scorers". */
export function distinctScorerVersions(rows: readonly ScoreRow[]): readonly string[] {
  return [...new Set(rows.map((row) => row.scorerVersion))].sort();
}
