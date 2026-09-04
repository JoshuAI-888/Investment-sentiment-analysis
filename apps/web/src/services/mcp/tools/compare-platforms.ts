/**
 * F21 §4.2 `compare_platforms` — "The three axes side by side, never blended. **Where Reddit, X
 * and Substack disagree.**" D-14: three platform axes, never one blended number — this tool
 * returns the same `stance[]` array `get_ticker_sentiment` does, on its own, so a caller asking
 * specifically for a cross-platform comparison never has to parse a bundled response to find it.
 */
import { z } from 'zod';
import { getTickerMetrics } from '../metrics';
import { coverageEntriesFor } from '../coverage-view';
import { buildEnvelope } from '../envelope';
import type { McpToolResultEnvelope } from '../contract';
import { METHOD_REGISTRY } from '@/services/calculations';
import { mustNotClaimLines } from '../must-not-claim';
import { McpToolError } from './errors';

export const comparePlatformsInputSchema = {
  type: 'object',
  properties: { symbol: { type: 'string', description: 'The security\'s ticker symbol, e.g. "GME".' } },
  required: ['symbol'],
  additionalProperties: false,
} as const;

const inputZod = z.object({ symbol: z.string().min(1) });

export async function comparePlatforms(rawArgs: unknown): Promise<McpToolResultEnvelope> {
  const args = inputZod.safeParse(rawArgs);
  if (!args.success) throw new McpToolError('invalid_arguments', `compare_platforms: ${args.error.message}`);

  const result = await getTickerMetrics(args.data.symbol);
  if (!result.resolved) {
    throw new McpToolError(
      result.refusal.reason === 'not_found' ? 'not_found' : result.refusal.reason === 'ambiguous' ? 'ambiguous' : 'ineligible',
      result.refusal.message,
    );
  }

  const { snapshot } = result;
  const calculationIds: string[] = [];
  const methodIds = new Set<string>();
  const limitations: string[] = [];

  for (const frame of snapshot.stance) {
    limitations.push(frame.disclosure, ...frame.selectionBiasNotes);
    if (frame.metric !== null) {
      calculationIds.push(frame.metric.calculationId);
      methodIds.add(frame.metric.metricId);
    }
  }

  const mustNotClaim: string[] = [];
  for (const methodId of methodIds) mustNotClaim.push(...mustNotClaimLines(METHOD_REGISTRY.latest(methodId)));
  if (mustNotClaim.length === 0) {
    mustNotClaim.push(
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    );
  }

  const totalN = snapshot.stance.reduce((sum, frame) => sum + frame.usedCount, 0);
  const coverage = await coverageEntriesFor(['reddit', 'x', 'substack']);

  return buildEnvelope({
    tool: 'compare_platforms',
    data: {
      symbol: snapshot.header.symbol,
      securityId: snapshot.header.securityId,
      platforms: snapshot.stance.map((frame) => ({
        axis: frame.axis,
        label: frame.label,
        metric: frame.metric,
        sampleAdequacy: frame.sampleAdequacy,
        retrievedCount: frame.retrievedCount,
        usedCount: frame.usedCount,
        window: frame.window,
        disclosure: frame.disclosure,
      })),
      asOf: snapshot.asOf.toISOString(),
      neverBlended: true as const,
    },
    coverage,
    n: totalN,
    window: { from: null, to: null, label: 'evidence retrieved this render' },
    limitations,
    mustNotClaim,
    calculationIds,
  });
}
