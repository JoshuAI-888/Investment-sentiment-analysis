/**
 * F21 §4.2 `explain_spike` — "The trigger event, the items around it, the price context.
 * **The primary tool.** Something moved and the operator wants to know what was said."
 *
 * Composes three already-existing, already-reviewed reads — never a new computation (§3):
 *
 * 1. The latest `market.spike_detection` verdict for the security
 *    (`@/repositories/mcp-calculation-lookup#findLatestCalculationByMethod` — see that module's
 *    own doc for why this is a documented cross-lane gap-fill rather than a
 *    `repositories/calculations.ts` edit), loaded through `loadArtifact` so its inputs/steps/hash
 *    are the same real
 *    `CalculationArtifact` `open_calculation` would return for the same id.
 * 2. Classified evidence retrievable as of the trigger's own `asOf` instant
 *    (`repositories/evidence.ts#evidenceForSecurity`), bounded the same way
 *    `list_supporting_evidence` is (`../evidence-view.ts`'s `MAX_EVIDENCE_ITEMS`) — this tool
 *    does not stance-filter, since "what was said around a spike" wants both sides.
 * 3. The security's current price/technical context (`../metrics.ts#getTickerMetrics`).
 *
 * **Deliberately does not call F11's research/synthesis pipeline.** §4.2's own "Returns" column
 * for this tool names three structured facts, not prose — the four binding rules in §4.1 exist
 * precisely because "an MCP server owns none of [the render boundary]... that host's model
 * writes the prose." Generating synthesis text inside this tool would make F21 the thing writing
 * the prose it cannot govern; leaving prose to the calling host, over structured facts it can
 * quote but not fabricate an aggregate from, is rule 1's whole point. F11's synthesis+verifier
 * keep running in the web app's own CI as the surface's evidence of honest use (§4.1 rule 4) —
 * this tool does not need to invoke them to be honest, it needs to never produce prose itself.
 */
import { z } from 'zod';
import { resolveTickerSymbol } from '@/services/ticker/resolve';
import { evidenceForSecurity } from '@/repositories/evidence';
import type { EvidenceItem } from '@/contracts/evidence';
import { loadArtifact, METHOD_REGISTRY } from '@/services/calculations';
import { findLatestCalculationByMethod } from '@/repositories/mcp-calculation-lookup';
import { getTickerMetrics } from '../metrics';
import { coverageEntriesFor } from '../coverage-view';
import { buildEnvelope } from '../envelope';
import { mustNotClaimLines } from '../must-not-claim';
import type { McpToolResultEnvelope } from '../contract';
import { MAX_EVIDENCE_ITEMS, type BoundedEvidenceItem } from '../evidence-view';
import { McpToolError } from './errors';

export const explainSpikeInputSchema = {
  type: 'object',
  properties: { symbol: { type: 'string', description: 'The security\'s ticker symbol, e.g. "GME".' } },
  required: ['symbol'],
  additionalProperties: false,
} as const;

const inputZod = z.object({ symbol: z.string().min(1) });

const MARKET_SPIKE_DETECTION_ID = 'market.spike_detection';

function isClassified(item: EvidenceItem): boolean {
  return item.stanceLabel !== null && item.stanceScore !== null && item.relevanceScore !== null;
}

function project(item: EvidenceItem & { id: string }): BoundedEvidenceItem {
  return {
    id: item.id,
    sourceKind: item.evidenceType,
    provider: item.provider,
    title: item.title,
    url: item.sourceUrl,
    publishedAt: item.publishedAt === null ? null : item.publishedAt.toISOString(),
    retrievedAt: item.ingestedAt.toISOString(),
    snippet: item.snippet,
    relevance: item.relevanceScore,
    stanceLabel: item.stanceLabel,
    stanceScore: item.stanceScore,
    availability: item.availability,
    lastCheckedAt: item.lastCheckedAt === null ? null : item.lastCheckedAt.toISOString(),
  };
}

export async function explainSpike(rawArgs: unknown): Promise<McpToolResultEnvelope> {
  const args = inputZod.safeParse(rawArgs);
  if (!args.success) throw new McpToolError('invalid_arguments', `explain_spike: ${args.error.message}`);

  const asOf = new Date();
  const resolved = await resolveTickerSymbol(args.data.symbol, asOf);
  if (!resolved.ok) {
    throw new McpToolError(
      resolved.refusal.reason === 'not_found' ? 'not_found' : resolved.refusal.reason === 'ambiguous' ? 'ambiguous' : 'ineligible',
      resolved.refusal.message,
    );
  }
  const security = resolved.security;

  const latestSnapshot = await findLatestCalculationByMethod(MARKET_SPIKE_DETECTION_ID, security.id);

  const coverage = await coverageEntriesFor(['market', 'reddit', 'x', 'substack']);

  if (latestSnapshot === null) {
    return buildEnvelope({
      tool: 'explain_spike',
      data: {
        symbol: security.symbol,
        securityId: security.id,
        trigger: null,
        items: [],
        priceContext: null,
      },
      coverage,
      n: 0,
      window: null,
      limitations: ['No market.spike_detection verdict has ever been recorded for this security — the trigger job has not evaluated it yet.'],
      mustNotClaim: ['Absence of a recorded trigger event is not evidence that no move occurred — it means the check has not run.'],
      calculationIds: [],
    });
  }

  const artifact = await loadArtifact(latestSnapshot.id);
  const fired = artifact?.result?.exact === '1';
  const triggerAsOf = artifact === null ? latestSnapshot.inputCutoff : new Date(artifact.asOf);

  const evidenceResult = await evidenceForSecurity({ securityId: security.id, asOfInstant: triggerAsOf, limit: 200 });
  const classified = evidenceResult.items.filter(isClassified);
  const bounded = classified.slice(0, MAX_EVIDENCE_ITEMS);

  const metrics = await getTickerMetrics(security.symbol, asOf);
  const priceContext = metrics.resolved
    ? { regime: metrics.snapshot.price.regime, volatility20: metrics.snapshot.price.volatility20, rsi14: metrics.snapshot.price.rsi14 }
    : null;

  const calculationIds: string[] = [latestSnapshot.id];
  const methodIds = new Set<string>([MARKET_SPIKE_DETECTION_ID]);
  if (priceContext?.regime !== null && priceContext?.regime !== undefined) {
    calculationIds.push(priceContext.regime.calculationId);
    methodIds.add(priceContext.regime.metricId);
  }
  if (priceContext?.volatility20 !== null && priceContext?.volatility20 !== undefined) {
    calculationIds.push(priceContext.volatility20.calculationId);
    methodIds.add(priceContext.volatility20.metricId);
  }
  if (priceContext?.rsi14 !== null && priceContext?.rsi14 !== undefined) {
    calculationIds.push(priceContext.rsi14.calculationId);
    methodIds.add(priceContext.rsi14.metricId);
  }

  const limitations = [
    'The trigger runs on FMP Starter\'s daily bars (D-15/D-31) — a day-over-day threshold crossing, not an intraday one. A move that reverted inside a session will not have fired this check.',
    'market.spike_detection is registered with `calc/artifact.ts#buildArtifact` directly (a documented cross-lane gap-fill, `calc/methods/market-spike-detection.ts`) and is not yet projected into `analytics/registry.ts`\'s `MethodRegistry` — its own limitations therefore are not sourced from a registry entry the way every other method\'s are here. Reported as a contract gap for whoever next owns F06.',
    'This list is bounded and evidence-window-scoped to the trigger instant. It is not the full evidence corpus for this security.',
  ];
  const mustNotClaim: string[] = [
    'A threshold-crossing verdict is a description of what the price did, not an explanation of why, and not a prediction of what happens next.',
  ];
  for (const methodId of methodIds) {
    if (methodId === MARKET_SPIKE_DETECTION_ID) continue;
    mustNotClaim.push(...mustNotClaimLines(METHOD_REGISTRY.latest(methodId)));
  }

  return buildEnvelope({
    tool: 'explain_spike',
    data: {
      symbol: security.symbol,
      securityId: security.id,
      trigger: {
        calculationId: latestSnapshot.id,
        fired,
        observedAt: triggerAsOf.toISOString(),
        percentChange: artifact?.steps.find((step) => step.key === 'percent_change')?.displayValue ?? null,
        eligibility: artifact?.eligibility ?? latestSnapshot.status,
      },
      items: bounded.map((item) => project(item)),
      priceContext,
    },
    coverage,
    n: bounded.length,
    window: { from: null, to: triggerAsOf.toISOString(), label: 'evidence retrievable as of the trigger instant' },
    limitations,
    mustNotClaim,
    calculationIds,
  });
}
