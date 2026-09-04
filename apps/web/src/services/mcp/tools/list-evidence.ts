/**
 * F21 §4.2 `list_supporting_evidence` / `list_contradicting_evidence` — "Bounded, classified
 * items with URLs and `retrievedAt`." / "Same, filtered to opposing stance." Both share this
 * implementation, parameterized by `direction` — the bounding and classification-filter logic
 * lives once in `../evidence-view.ts`.
 */
import { z } from 'zod';
import { resolveTickerSymbol } from '@/services/ticker/resolve';
import { boundedEvidenceFor, type StanceDirection } from '../evidence-view';
import { buildEnvelope } from '../envelope';
import type { McpToolResultEnvelope } from '../contract';
import { McpToolError } from './errors';

export const listEvidenceInputSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string', description: 'The security\'s ticker symbol, e.g. "GME".' },
    relativeTo: {
      type: 'string',
      enum: ['bullish', 'bearish'],
      description: 'The stance to compare against. Omit to use the sample\'s own majority label.',
    },
  },
  required: ['symbol'],
  additionalProperties: false,
} as const;

const inputZod = z.object({
  symbol: z.string().min(1),
  relativeTo: z.enum(['bullish', 'bearish']).optional(),
});

async function listEvidence(rawArgs: unknown, direction: StanceDirection, toolName: string): Promise<McpToolResultEnvelope> {
  const args = inputZod.safeParse(rawArgs);
  if (!args.success) throw new McpToolError('invalid_arguments', `${toolName}: ${args.error.message}`);

  const asOf = new Date();
  const resolved = await resolveTickerSymbol(args.data.symbol, asOf);
  if (!resolved.ok) {
    throw new McpToolError(
      resolved.refusal.reason === 'not_found' ? 'not_found' : resolved.refusal.reason === 'ambiguous' ? 'ambiguous' : 'ineligible',
      resolved.refusal.message,
    );
  }

  const bounded = await boundedEvidenceFor(resolved.security.id, direction, asOf, args.data.relativeTo ?? null);

  return buildEnvelope({
    tool: toolName,
    data: {
      symbol: resolved.security.symbol,
      securityId: resolved.security.id,
      direction,
      items: bounded.items,
      retrievedCount: bounded.retrievedCount,
      usedCount: bounded.usedCount,
      truncated: bounded.truncated,
    },
    coverage: [],
    n: bounded.usedCount,
    window: { from: null, to: null, label: 'evidence on record at request time' },
    limitations: [
      'Snippets are shown as retrieved, never re-fetched — an item marked unreachable/removed still shows the text captured at ingest time (F-19).',
      'This list is bounded and stance-filtered. It is not the full evidence corpus for this security, and it is never a raw, unclassified dump.',
    ],
    mustNotClaim: [
      'A list of items agreeing with (or opposing) a stated stance is not itself evidence that the stance is correct — it is a bounded, classified sample, not a verdict.',
    ],
    calculationIds: [],
  });
}

export async function listSupportingEvidence(rawArgs: unknown): Promise<McpToolResultEnvelope> {
  return listEvidence(rawArgs, 'supporting', 'list_supporting_evidence');
}

export async function listContradictingEvidence(rawArgs: unknown): Promise<McpToolResultEnvelope> {
  return listEvidence(rawArgs, 'contradicting', 'list_contradicting_evidence');
}
