/**
 * F21 §4.2 `get_coverage` — "What is collected, since when, with what gaps. **Called before any
 * historical claim.**" §6 DoD: "reports the real collector start date and real gaps." Reads
 * `repositories/coverage.ts#coverageWindowFor`/`listGaps` directly — the same repository F22
 * built and F09's own coverage panel reads (`services/ticker/coverage.ts`) — never a fabricated
 * or hand-maintained coverage story.
 */
import { z } from 'zod';
import { coverageAxis, type CoverageAxis } from '@/contracts/coverage';
import { coverageWindowFor } from '@/repositories/coverage';
import { floorDisclosure } from '@/calc/coverage';
import { buildEnvelope } from '../envelope';
import type { McpToolResultEnvelope } from '../contract';
import { McpToolError } from './errors';

const ALL_AXES: readonly CoverageAxis[] = ['reddit', 'x', 'substack', 'market'];

export const getCoverageInputSchema = {
  type: 'object',
  properties: {
    axis: {
      type: 'string',
      enum: [...ALL_AXES],
      description: 'Restrict to one coverage axis. Omit to report every axis.',
    },
  },
  required: [],
  additionalProperties: false,
} as const;

const inputZod = z.object({ axis: coverageAxis.optional() });

export async function getCoverage(rawArgs: unknown): Promise<McpToolResultEnvelope> {
  const args = inputZod.safeParse(rawArgs ?? {});
  if (!args.success) throw new McpToolError('invalid_arguments', `get_coverage: ${args.error.message}`);

  const axes = args.data.axis === undefined ? ALL_AXES : [args.data.axis];

  const perAxis = await Promise.all(
    axes.map(async (axis) => {
      const window = await coverageWindowFor(axis);
      if (window === null) {
        return {
          axis,
          startedAt: null as string | null,
          lastObservedAt: null as string | null,
          gaps: [] as { from: string; to: string; reason: string; permanent: true }[],
          disclosure: `no coverage floor is recorded yet for ${axis} — the collector has not reported a start`,
        };
      }
      return {
        axis,
        startedAt: window.startedAt.toISOString(),
        lastObservedAt: window.lastObservedAt === null ? null : window.lastObservedAt.toISOString(),
        gaps: window.gaps.map((gap) => ({
          from: gap.from.toISOString(),
          to: gap.to.toISOString(),
          reason: gap.reason,
          permanent: gap.permanent,
        })),
        disclosure: floorDisclosure(axis, window.startedAt),
      };
    }),
  );

  const coverage = perAxis.map((row) => ({
    axis: row.axis,
    startedAt: row.startedAt,
    gapCount: row.gaps.length,
    disclosure: row.disclosure,
  }));

  return buildEnvelope({
    tool: 'get_coverage',
    data: { axes: perAxis },
    coverage,
    n: null,
    window: null,
    limitations: [
      'Under D-16, collection is forward-only. There is no backfill — a gap here is permanent, never a temporary hole that will be filled retroactively.',
    ],
    mustNotClaim: [
      'A coverage report is not a claim about what happened before the collector started. Absence of coverage is not absence of activity.',
    ],
    calculationIds: [],
  });
}
