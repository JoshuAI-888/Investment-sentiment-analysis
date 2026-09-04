/**
 * Matching an ApeWisdom board entry to a security we already track — F08 §4.1's collector and
 * §8's "uppercase-ticker rule collides with common words" risk.
 *
 * **The rule, stated plainly: match by uppercased ticker against the security master; an entry
 * that matches nothing is dropped, never guessed.** D-30 seeded the universe from ApeWisdom's own
 * ranking, so this collector's job is to re-observe the *same* names on later runs, not to invent
 * new ones — a board entry for a ticker this deployment does not track (a common word ApeWisdom's
 * own extraction mis-parsed as a ticker, or simply a name outside the seeded 100) is silently
 * absent from the persisted snapshot set for this run, exactly as F08 §8's risk table asks.
 *
 * Kept pure and free of any repository/adapter import so it is unit- and contract-testable
 * against a real `ApeWisdomEntry[]` fixture with no database.
 */
import type { ApeWisdomEntry } from '@/adapters/apewisdom';

export type MatchableSecurity = {
  readonly id: string;
  readonly symbol: string;
  readonly active: boolean;
};

export type MatchedBoardEntry = {
  readonly entry: ApeWisdomEntry;
  readonly securityId: string;
  readonly symbol: string;
};

export type MatchBoardEntriesResult = {
  readonly matched: readonly MatchedBoardEntry[];
  /**
   * Round-23 lane-review finding 1. `entries` is one page-1 board response, not a set — nothing
   * in ApeWisdom's own documented shape rules out the same ticker appearing twice on it (an
   * extraction bug, or two share classes normalising to the one symbol this deployment tracks —
   * the same "uppercase-ticker rule collides" family F08 §8's risk table already names). Without
   * de-duplication, both entries would pass every per-entry validation
   * `buildAttentionSnapshotInput` performs and both would be written for the identical
   * `(security_id, source, observed_at)` — `insertAttentionSnapshot` has no way to know this is
   * not a genuine mid-run revision, since its own contract is exactly "same identity, different
   * `raw_hash` ⇒ the provider recomputed this window" (`repositories/attention.ts`'s own doc).
   * `attentionSnapshotHistory`'s `distinct on (observed_at) … order by ingested_at desc` then
   * makes whichever entry was *inserted second* — an accident of list order, not anything
   * meaningful — the reading every later read returns, permanently shadowing the other one under
   * D-16's no-delete retention. Kept here, not in `collectAttentionSnapshots`: this module's own
   * job is "which entries name a security we track," and "how many times" is the same kind of
   * question.
   */
  readonly duplicateTickers: readonly string[];
};

/**
 * One entry per matched, currently-active security. An entry whose ticker (uppercased) does not
 * equal any active security's symbol (also uppercased) is omitted — never fuzzy-matched, never
 * created. Symbols are compared case-insensitively because ApeWisdom's own casing is not a
 * documented guarantee, but the *comparison*, not the stored value, is where that tolerance ends:
 * the returned `symbol` is always the security master's own casing, never the provider's.
 *
 * A ticker matching more than one board entry keeps only the first (`entries`' own order is
 * ApeWisdom's rank order, so this is the best-ranked reading) — the rest are reported in
 * `duplicateTickers` rather than silently written as if each were a distinct, later revision.
 */
export function matchBoardEntriesToSecurities(
  entries: readonly ApeWisdomEntry[],
  securities: readonly MatchableSecurity[],
): MatchBoardEntriesResult {
  const bySymbol = new Map<string, MatchableSecurity>();
  for (const security of securities) {
    if (!security.active) continue;
    bySymbol.set(security.symbol.toUpperCase(), security);
  }

  const matched: MatchedBoardEntry[] = [];
  const duplicateTickers: string[] = [];
  const seenSecurityIds = new Set<string>();
  for (const entry of entries) {
    const security = bySymbol.get(entry.ticker.toUpperCase());
    if (security === undefined) continue;
    if (seenSecurityIds.has(security.id)) {
      duplicateTickers.push(entry.ticker);
      continue;
    }
    seenSecurityIds.add(security.id);
    matched.push({ entry, securityId: security.id, symbol: security.symbol });
  }
  return { matched, duplicateTickers };
}
