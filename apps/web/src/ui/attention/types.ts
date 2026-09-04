/**
 * The attention leaderboard UI components' own prop shapes.
 *
 * `02-ARCHITECTURE-CONTRACTS.md` §3: "ui/ may import only contracts/" — so this file declares
 * the shapes these components need independently of `src/services/attention/contract.ts`,
 * exactly as `ui/dashboard/types.ts` (F07) already does for the same reason. `page.tsx` (the
 * `app/` layer, allowed to import both `services/` and `ui/`) passes data that is structurally
 * identical, so no conversion step is needed at the call site — only the two declarations must
 * be kept in sync by hand.
 */

export type MetricEligibility = 'ok' | 'insufficient_data' | 'not_applicable' | 'stale';

export type AttentionMetricView = {
  readonly calculationId: string;
  readonly metricId: string;
  readonly label: string;
  readonly display: string | null;
  readonly unit: string;
  readonly roundingRule: string;
  readonly eligibility: MetricEligibility;
  readonly reason: string | null;
  /** Round-29 lane-review finding 2 — see `AttentionTable.tsx`'s own doc for why a value whose
   *  denominator hit a hard floor (`attention.mentions_zscore`'s epsilon floor on a near-zero
   *  MAD) must not render identically to one computed off a genuine spread. */
  readonly isClamped: boolean;
};

export type HistoryDepthView = {
  readonly securityId: string;
  readonly comparableSnapshots: number;
  readonly requiredForZscore: number;
};

export type AttentionRowView = {
  readonly securityId: string;
  readonly symbol: string;
  readonly companyName: string;
  readonly mentions: AttentionMetricView;
  readonly mentionDelta: AttentionMetricView | null;
  readonly mentionGrowth: AttentionMetricView | null;
  readonly upvotes: AttentionMetricView;
  readonly rank: AttentionMetricView;
  readonly rankChange: AttentionMetricView;
  readonly mentionsZscore: AttentionMetricView | null;
  /** Lane-review round 25 finding 2 — see `AttentionTable.tsx`'s own doc for why "no window
   *  applies to a depth-gated count" was wrong: the real span is derivable and now rendered. */
  readonly mentionsZscoreWindowHours: number | null;
  readonly observedAt: Date;
  /** The real elapsed span the rendered deltas were computed over, in (possibly fractional) hours
   *  — never a fixed provider-window constant. Lane-review finding 2. */
  readonly observationWindowHours: number;
  readonly historyDepth: HistoryDepthView;
  readonly isNew: boolean;
  readonly isDroppedFromBoard: boolean;
  readonly isMethodologyBoundary: boolean;
  readonly isThinSample: boolean;
  readonly rankChangeSource: 'own_history' | 'provider_reported';
  /** Lane-review finding 5 — derived at read time from `observedAt` against the real clock. */
  readonly isStale: boolean;
  /** Round-33 lane-review finding 3 — see `contract.ts`'s own doc for why this is distinct from
   *  `isDroppedFromBoard` and why it is derived fresh on every read, never persisted on the row. */
  readonly wasMalformedLastRun: boolean;
};

export type NotableMoverView = {
  readonly securityId: string;
  readonly symbol: string;
  readonly companyName: string;
  readonly rankChange: AttentionMetricView;
  readonly mentionDelta: AttentionMetricView | null;
  /** Round-33 lane-review finding 2 — see `contract.ts`'s own doc for why this card needs the
   *  same source/window disclosure `AttentionTable.tsx` already gives the identical security. */
  readonly rankChangeSource: 'own_history' | 'provider_reported';
  readonly observationWindowHours: number;
  /** Round-42 lane-review finding 2 — see `contract.ts`'s own doc for why this card needs the
   *  same warm-up qualifier `AttentionTable.tsx` already gives the identical security. */
  readonly isWarmingUp: boolean;
};

export type AttentionPageState = 'ok' | 'stale' | 'degraded' | 'unavailable';

/** Round-10 lane-review finding 4 — see `AttentionUnavailable.tsx`'s own doc for why the two
 *  causes `state: 'unavailable'` collapses need distinct copy. */
export type AttentionUnavailableReason = 'never_collected' | 'no_active_config_version';

/** Round-21 lane-review finding 1 — see `AttentionTable.tsx`'s own doc for why only
 *  `'provider_unreachable'` licenses the shared `FreshnessBadge`'s "refresh failed" wording. */
export type AttentionDegradedReason = 'provider_unreachable' | 'no_new_data' | 'provider_contract_changed';
