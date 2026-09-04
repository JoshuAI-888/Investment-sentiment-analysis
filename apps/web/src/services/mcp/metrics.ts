/**
 * The single call every symbol-scoped MCP tool makes for a security's computed metrics —
 * `assembleTickerSnapshot` (F09), already the reviewed, tested, compute-on-read path that
 * produces `CalculationArtifact`-backed `AxisMetric`s with no provider call in the read path.
 * F21 §3: *"F21 reads. It does not compute."* — this module is the one place that reuse happens,
 * so every tool that needs "the metrics for a symbol" gets them the same way `/ticker/:symbol`
 * itself does, rather than a second, tool-specific computation path that could drift from it
 * (§8's own named risk: "the surface drifts from the web app's metrics").
 */
import { METHOD_REGISTRY } from '@/services/calculations';
import { assembleTickerSnapshot } from '@/services/ticker/snapshot';
import type { AxisMetric, TickerRefusal, TickerSnapshotResponse } from '@/services/ticker/contract';
import { mustNotClaimLines } from './must-not-claim';

export type ResolvedTickerMetrics = {
  readonly resolved: true;
  readonly securityId: string;
  readonly symbol: string;
  readonly snapshot: Extract<TickerSnapshotResponse, { resolved: true }>;
  readonly byMethodId: ReadonlyMap<string, AxisMetric>;
};

export type TickerMetricsResult =
  | ResolvedTickerMetrics
  | { readonly resolved: false; readonly refusal: TickerRefusal };

export async function getTickerMetrics(symbol: string, asOf?: Date): Promise<TickerMetricsResult> {
  const snapshot = await assembleTickerSnapshot(symbol, asOf === undefined ? {} : { asOf });
  if (!snapshot.resolved) return { resolved: false, refusal: snapshot.refusal };

  const byMethodId = new Map<string, AxisMetric>();
  const add = (metric: AxisMetric | null): void => {
    if (metric !== null) byMethodId.set(metric.metricId, metric);
  };

  add(snapshot.attention.mentionDelta);
  add(snapshot.attention.rankChange);
  for (const frame of snapshot.stance) add(frame.metric);
  add(snapshot.news.metric);
  add(snapshot.price.volatility20);
  add(snapshot.price.regime);
  add(snapshot.price.rsi14);
  add(snapshot.price.movingAverage20);
  add(snapshot.price.movingAverage50);

  return { resolved: true, securityId: snapshot.header.securityId, symbol: snapshot.header.symbol, snapshot, byMethodId };
}

/** Every registered limitation + mustNotClaim line behind a set of `AxisMetric`s, unioned. */
export function limitationsAndClaimsFor(methodIds: readonly string[]): {
  readonly limitations: readonly string[];
  readonly mustNotClaim: readonly string[];
} {
  const limitations: string[] = [];
  const mustNotClaim: string[] = [];
  for (const methodId of methodIds) {
    const entry = METHOD_REGISTRY.latest(methodId);
    limitations.push(...entry.limitations);
    mustNotClaim.push(...mustNotClaimLines(entry));
  }
  return { limitations, mustNotClaim };
}
