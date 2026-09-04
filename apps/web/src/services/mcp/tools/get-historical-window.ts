/**
 * F21 §4.2 `get_historical_window` — "A series with its **coverage floor** and per-axis start
 * dates. **Anything about the past.**"
 *
 * Returns the real, already-persisted `calculation_snapshot` rows for one registered metric and
 * security inside `[from, to]` (`@/repositories/mcp-calculation-lookup#findCalculationsInRange` —
 * a documented cross-lane gap-fill, see that module's header) — never a freshly computed series. **This is a
 * real, disclosed limitation right now, not a corner cut**: `assembleTickerSnapshot` (F09)
 * computes and persists an artifact only when a symbol is actually viewed (its own doc: "compute-
 * on-read, not cache-on-write"), and the collector has not started yet
 * (`docs/PROGRESS.md`: "Collector start date: NOT STARTED"). So this tool honestly returns
 * whatever has actually been computed and persisted for the requested window — which today is
 * frequently nothing — with the coverage floor/gap disclosure explaining why, rather than
 * fabricating a backfilled series D-16 does not permit anyway.
 */
import { z } from 'zod';
import { resolveTickerSymbol } from '@/services/ticker/resolve';
import { findCalculationsInRange } from '@/repositories/mcp-calculation-lookup';
import { coverageEntryFor } from '../coverage-view';
import { buildEnvelope } from '../envelope';
import { mustNotClaimLines } from '../must-not-claim';
import type { McpToolResultEnvelope } from '../contract';
import type { CoverageAxis } from '@/contracts/coverage';
import { METHOD_REGISTRY } from '@/services/calculations';
import { McpToolError } from './errors';

export const getHistoricalWindowInputSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string', description: 'The security\'s ticker symbol, e.g. "GME".' },
    methodId: { type: 'string', description: 'A registered methodId, e.g. "social.stance_reddit" or "price.regime".' },
    from: { type: 'string', description: 'ISO-8601 start instant.' },
    to: { type: 'string', description: 'ISO-8601 end instant.' },
  },
  required: ['symbol', 'methodId', 'from', 'to'],
  additionalProperties: false,
} as const;

const inputZod = z.object({
  symbol: z.string().min(1),
  methodId: z.string().min(1),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

/** Which coverage axis' floor/gap disclosure governs a given metric's history. `market` is the fallback for price/technical/market.* metrics — F22's `coverageAxis` enum has no dedicated news/price axis. */
function axisFor(methodId: string): CoverageAxis {
  if (methodId.startsWith('social.stance_x')) return 'x';
  if (methodId.startsWith('social.stance_substack')) return 'substack';
  if (methodId.startsWith('social.stance_reddit') || methodId.startsWith('attention.')) return 'reddit';
  return 'market';
}

export async function getHistoricalWindow(rawArgs: unknown): Promise<McpToolResultEnvelope> {
  const args = inputZod.safeParse(rawArgs);
  if (!args.success) throw new McpToolError('invalid_arguments', `get_historical_window: ${args.error.message}`);

  let entry;
  try {
    entry = METHOD_REGISTRY.latest(args.data.methodId);
  } catch {
    throw new McpToolError('invalid_arguments', `'${args.data.methodId}' is not a registered method.`);
  }

  const asOf = new Date();
  const resolved = await resolveTickerSymbol(args.data.symbol, asOf);
  if (!resolved.ok) {
    throw new McpToolError(
      resolved.refusal.reason === 'not_found' ? 'not_found' : resolved.refusal.reason === 'ambiguous' ? 'ambiguous' : 'ineligible',
      resolved.refusal.message,
    );
  }

  const from = new Date(args.data.from);
  const to = new Date(args.data.to);
  if (from > to) throw new McpToolError('invalid_arguments', "'from' must not be after 'to'.");

  const axis = axisFor(entry.id);
  const coverage = await coverageEntryFor(axis);

  const rows = await findCalculationsInRange(entry.id, resolved.security.id, from, to);

  const points = rows.map((row) => ({
    calculationId: row.id,
    computedAt: row.computedAt.toISOString(),
    inputCutoff: row.inputCutoff.toISOString(),
    status: row.status,
    exact: (row.exactResult as { exact: string | null }).exact,
    display: (row.displayResult as { display: string | null }).display,
  }));

  return buildEnvelope({
    tool: 'get_historical_window',
    data: {
      symbol: resolved.security.symbol,
      securityId: resolved.security.id,
      methodId: entry.id,
      methodVersion: entry.version,
      points,
    },
    coverage: [coverage],
    n: points.length,
    window: { from: from.toISOString(), to: to.toISOString(), label: `${entry.id} history` },
    limitations: [
      ...entry.limitations,
      'Points are the calculations already persisted for this security and window — this tool never computes or backfills a series (D-16: forward-only, no backfill).',
    ],
    mustNotClaim: mustNotClaimLines(entry),
    calculationIds: points.map((point) => point.calculationId),
  });
}
