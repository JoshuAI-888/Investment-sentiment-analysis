/**
 * F21 §4.2 `get_ticker_sentiment` — "Per-axis stance with `n`, window, `calculationId`, per-axis
 * disclosure. **The current state of one name.**"
 */
import { getTickerMetrics } from '../metrics';
import { coverageEntriesFor } from '../coverage-view';
import { buildEnvelope } from '../envelope';
import { mcpToolResultEnvelope, type McpToolResultEnvelope } from '../contract';
import { METHOD_REGISTRY } from '@/services/calculations';
import { mustNotClaimLines } from '../must-not-claim';
import { McpToolError } from './errors';
import { z } from 'zod';

export const getTickerSentimentInputSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string', description: 'The security\'s ticker symbol, e.g. "GME".' },
  },
  required: ['symbol'],
  additionalProperties: false,
} as const;

const inputZod = z.object({ symbol: z.string().min(1) });

export const getTickerSentimentData = z.object({
  symbol: z.string(),
  securityId: z.string(),
  attention: z.object({
    mentions: z.number().int().nonnegative().nullable(),
    rank: z.number().int().positive().nullable(),
    mentionDelta: z.unknown().nullable(),
    rankChange: z.unknown().nullable(),
    coverageDisclosure: z.string(),
  }),
  stance: z.array(
    z.object({
      axis: z.enum(['reddit', 'x', 'substack']),
      label: z.string(),
      metric: z.unknown().nullable(),
      sampleAdequacy: z.string().nullable(),
      retrievedCount: z.number(),
      usedCount: z.number(),
      window: z.string(),
      disclosure: z.string(),
    }),
  ),
  news: z.object({ metric: z.unknown().nullable(), articleCount: z.number(), window: z.string() }),
  price: z.object({
    regime: z.unknown().nullable(),
    volatility20: z.unknown().nullable(),
    rsi14: z.unknown().nullable(),
  }),
  divergence: z.unknown(),
  asOf: z.string(),
});

export async function getTickerSentiment(rawArgs: unknown): Promise<McpToolResultEnvelope> {
  const args = inputZod.safeParse(rawArgs);
  if (!args.success) {
    throw new McpToolError('invalid_arguments', `get_ticker_sentiment: ${args.error.message}`);
  }

  const result = await getTickerMetrics(args.data.symbol);
  if (!result.resolved) {
    throw new McpToolError(
      result.refusal.reason === 'not_found' ? 'not_found' : result.refusal.reason === 'ambiguous' ? 'ambiguous' : 'ineligible',
      result.refusal.message,
    );
  }

  const { snapshot } = result;
  const calculationIds: string[] = [];
  const methodIds: string[] = [];
  const collect = (metric: { calculationId: string; metricId: string } | null): void => {
    if (metric === null) return;
    calculationIds.push(metric.calculationId);
    methodIds.push(metric.metricId);
  };

  collect(snapshot.attention.mentionDelta);
  collect(snapshot.attention.rankChange);
  for (const frame of snapshot.stance) collect(frame.metric);
  collect(snapshot.news.metric);
  collect(snapshot.price.regime);
  collect(snapshot.price.volatility20);
  collect(snapshot.price.rsi14);
  if (snapshot.divergence.available) {
    calculationIds.push(snapshot.divergence.calculationId);
    methodIds.push('market.divergence_state');
  }

  const limitations: string[] = [];
  const mustNotClaim: string[] = [];
  for (const methodId of new Set(methodIds)) {
    const entry = METHOD_REGISTRY.latest(methodId);
    limitations.push(...entry.limitations);
    mustNotClaim.push(...mustNotClaimLines(entry));
  }
  // Sample-adequacy/selection-bias disclosures F09 attaches per stance frame, reproduced here
  // rather than dropped — the envelope is the only structural place a host model reads them.
  for (const frame of snapshot.stance) {
    limitations.push(frame.disclosure, ...frame.selectionBiasNotes);
  }
  if (mustNotClaim.length === 0) mustNotClaim.push('This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.');

  const coverage = await coverageEntriesFor(['reddit', 'x', 'substack', 'market']);

  const data = {
    symbol: snapshot.header.symbol,
    securityId: snapshot.header.securityId,
    attention: {
      mentions: snapshot.attention.mentions,
      rank: snapshot.attention.rank,
      mentionDelta: snapshot.attention.mentionDelta,
      rankChange: snapshot.attention.rankChange,
      coverageDisclosure: snapshot.attention.coverageDisclosure,
    },
    stance: snapshot.stance.map((frame) => ({
      axis: frame.axis,
      label: frame.label,
      metric: frame.metric,
      sampleAdequacy: frame.sampleAdequacy,
      retrievedCount: frame.retrievedCount,
      usedCount: frame.usedCount,
      window: frame.window,
      disclosure: frame.disclosure,
    })),
    news: { metric: snapshot.news.metric, articleCount: snapshot.news.articleCount, window: snapshot.news.window },
    price: { regime: snapshot.price.regime, volatility20: snapshot.price.volatility20, rsi14: snapshot.price.rsi14 },
    divergence: snapshot.divergence,
    asOf: snapshot.asOf.toISOString(),
  };
  getTickerSentimentData.parse(data);

  return buildEnvelope({
    tool: 'get_ticker_sentiment',
    data,
    coverage,
    n: null,
    window: { from: null, to: null, label: 'current snapshot' },
    limitations,
    mustNotClaim,
    calculationIds,
  });
}

export type { McpToolResultEnvelope };
export { mcpToolResultEnvelope };
