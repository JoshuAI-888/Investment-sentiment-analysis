/**
 * The attention leaderboard's own Redis keys, over the same small REST client F07 built
 * (`services/dashboard/redis.ts`). Re-exported rather than duplicated: `RedisClient`,
 * `resolveRedisClient` and `inMemoryRedisClient` carry nothing dashboard-specific — F07's own doc
 * comment explains why *that* file exists standalone rather than importing a still-earlier one
 * (F02's private client), and the same reasoning does not apply a second time here, since this
 * file and `services/dashboard/redis.ts` are both already this lane's own, reviewed code.
 * Duplicating the Upstash REST plumbing a second time would be the opportunistic-refactor
 * direction, not the conservative one.
 */
export { resolveRedisClient, inMemoryRedisClient, type RedisClient } from '@/services/dashboard/redis';

/**
 * `dashboard:pointer:...`'s sibling namespace for this feature's own calculation pointers.
 *
 * **`historyDepth`/`rankChangeSource`/`comparisonWindowHours` were removed here — lane-review
 * round 7 finding 1.** They were three more side-channel keys the read path trusted with no
 * freshness check of their own, exposed to the identical partial-materialization interruption the
 * five `metricPointer` writes were hardened against in rounds 4–6. `leaderboard.ts` now derives
 * all three directly from the `rank_change`/`mentions_zscore` artifacts it already verifies are
 * fresh, so there is nothing left for a fourth, fifth and sixth side channel to guard.
 */
export const KEYS = {
  metricPointer: (securityId: string, methodId: string) => `attention:pointer:${securityId}:${methodId}`,
  lastCollectedAt: () => 'attention:last_collected_at',
  degraded: () => 'attention:degraded',
  /**
   * Round-11 lane-review finding 2. `degraded` alone cannot distinguish *why* the last run
   * produced no new data — `pipeline.ts` sets it both for a genuine fetch failure (ApeWisdom
   * unreachable) and for a 200 response that yielded nothing usable (every entry malformed or
   * unmatched) — and the read path rendered the same "ApeWisdom could not be reached" claim for
   * both, which is false for the latter: the provider was reached and answered. This key carries
   * which of the two actually happened, so `degradedMessage` can say so accurately.
   *
   * **Round-12 lane-review finding 2 widened this to three values.** `collected.error.kind ===
   * 'contract'` (`contracts/provider.ts`) is itself a 200 response whose body no longer matches
   * the recorded schema — ApeWisdom changed shape, F08 §8's own named risk — and is exactly as
   * "reached" as the `no_new_data` branch, not the genuine unreachable case every other
   * `ProviderError` kind (`timeout`, `upstream`, `rate_limit`, `entitlement`, `quota`,
   * `budget_denied`, `circuit_open`) represents. Collapsing it into `'provider_unreachable'`
   * hid the one failure most likely to need a code fix rather than a wait, since
   * `apewisdomWrapperDeps`'s `noopContractViolation` (`provider-deps.ts`) discards the same
   * signal a second time.
   */
  degradedReason: () => 'attention:degraded_reason',
  notableMovers: () => 'attention:notable_movers',
  /**
   * Round-33 lane-review finding 3. `degraded`/`degradedReason` above only ever fire when a run
   * produced *no* usable snapshots at all (`pipeline.ts`'s `noProgress` branch) — a *partial*
   * malformed board (most entries parse, a few don't) left `collectAttentionSnapshots`'s own
   * `malformedEntries` returned to `runAttentionCollection`'s caller and recorded nowhere durable,
   * while the affected securities' rows quietly stopped advancing with no trace of why. Written
   * unconditionally on every successful provider contact — including an empty list, to clear a
   * prior run's flag the moment the identical security parses cleanly again — never merged with a
   * previous run's value.
   */
  malformedTickers: () => 'attention:malformed_tickers',
} as const;
