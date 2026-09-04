import type { McpCoverageEntry, McpToolResultEnvelope, McpWindow } from './contract';

export type BuildEnvelopeArgs = {
  readonly tool: string;
  readonly data: unknown;
  readonly coverage: readonly McpCoverageEntry[];
  readonly n: number | null;
  readonly window: McpWindow | null;
  readonly limitations: readonly string[];
  readonly mustNotClaim: readonly string[];
  readonly calculationIds: readonly string[];
};

/** Dedupes while preserving first-seen order — several tools union limitations/mustNotClaim/calculationIds across more than one registry entry. */
function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function buildEnvelope(args: BuildEnvelopeArgs): McpToolResultEnvelope {
  return {
    ok: true,
    tool: args.tool,
    data: args.data,
    coverage: [...args.coverage],
    n: args.n,
    window: args.window,
    limitations: dedupe(args.limitations),
    mustNotClaim: dedupe(args.mustNotClaim),
    calculationIds: dedupe(args.calculationIds),
  };
}
