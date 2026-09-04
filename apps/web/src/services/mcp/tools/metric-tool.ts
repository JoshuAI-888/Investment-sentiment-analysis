/**
 * The handler behind every catalogue-generated `metric.<methodId>` tool (`../catalogue.ts`).
 * Input is always `{ symbol }`; output is that one metric's `AxisMetric`, read the same way
 * `get_ticker_sentiment` reads all of them (`../metrics.ts#getTickerMetrics`).
 *
 * **Scope, disclosed rather than silently narrower than it looks.** `assembleTickerSnapshot`
 * computes security-scoped metrics only — `market.sector_breadth`/`market.composite` are
 * `subjectKind: 'market'` and have no per-symbol reading at all. A generated tool for one of
 * those returns a `not_applicable`-eligibility result explaining why, rather than a 404: the
 * tool genuinely exists (DoD item 7 is about the tool appearing, not about every tool having
 * symbol-scoped data), it just has nothing to report for a `{symbol}` call.
 */
import { z } from 'zod';
import { getTickerMetrics } from '../metrics';
import { coverageEntriesFor } from '../coverage-view';
import { buildEnvelope } from '../envelope';
import { mustNotClaimLines } from '../must-not-claim';
import type { McpToolResultEnvelope } from '../contract';
import type { GeneratedMetricTool } from '../catalogue';
import { METHOD_REGISTRY } from '@/services/calculations';
import { McpToolError } from './errors';

const inputZod = z.object({ symbol: z.string().min(1) });

const AXIS_BY_METHOD_PREFIX: ReadonlyArray<readonly ['x' | 'reddit' | 'substack' | 'market', (id: string) => boolean]> = [
  ['x', (id) => id.startsWith('social.stance_x')],
  ['substack', (id) => id.startsWith('social.stance_substack')],
  ['reddit', (id) => id.startsWith('social.stance_reddit') || id.startsWith('attention.')],
];

function coverageAxesFor(methodId: string): readonly ('reddit' | 'x' | 'substack' | 'market')[] {
  const match = AXIS_BY_METHOD_PREFIX.find(([, test]) => test(methodId));
  return [match?.[0] ?? 'market'];
}

export async function callMetricTool(tool: GeneratedMetricTool, rawArgs: unknown): Promise<McpToolResultEnvelope> {
  const args = inputZod.safeParse(rawArgs);
  if (!args.success) throw new McpToolError('invalid_arguments', `${tool.name}: ${args.error.message}`);

  const entry = METHOD_REGISTRY.get(tool.methodId, tool.methodVersion);

  if (entry.subjectKind !== 'security') {
    return buildEnvelope({
      tool: tool.name,
      data: { symbol: args.data.symbol, methodId: tool.methodId, metric: null, reason: `${tool.methodId} is a ${entry.subjectKind}-scoped metric with no per-symbol reading.` },
      coverage: [],
      n: null,
      window: null,
      limitations: [...entry.limitations],
      mustNotClaim: mustNotClaimLines(entry),
      calculationIds: [],
    });
  }

  const result = await getTickerMetrics(args.data.symbol);
  if (!result.resolved) {
    throw new McpToolError(
      result.refusal.reason === 'not_found' ? 'not_found' : result.refusal.reason === 'ambiguous' ? 'ambiguous' : 'ineligible',
      result.refusal.message,
    );
  }

  const metric = result.byMethodId.get(tool.methodId) ?? null;
  const coverage = await coverageEntriesFor(coverageAxesFor(tool.methodId));

  return buildEnvelope({
    tool: tool.name,
    data: { symbol: result.symbol, securityId: result.securityId, methodId: tool.methodId, metric },
    coverage,
    n: metric?.n ?? null,
    window: metric === null ? null : { from: null, to: null, label: metric.window ?? 'current snapshot' },
    limitations: [...entry.limitations],
    mustNotClaim: mustNotClaimLines(entry),
    calculationIds: metric === null ? [] : [metric.calculationId],
  });
}
