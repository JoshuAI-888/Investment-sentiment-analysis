/**
 * The MCP JSON-RPC 2.0 dispatcher (F21 §2, §4). Transport-agnostic — `app/api/mcp/route.ts` is
 * the one caller, and owns authentication (F21 §6 DoD: "Server authentication is required").
 *
 * **Read-only, no exceptions (§4.2).** Every method this dispatcher exposes —
 * `initialize`/`tools/list`/`tools/call`/`resources/list`/`resources/templates/list`/
 * `resources/read` — only ever reads. There is no `tools/call` target, anywhere in `TOOLS`
 * below, whose handler contains an `insert`/`update`/`delete` or a call into `services/jobs/`,
 * `services/admin/` or any dispatch path — `docs/features/F21-mcp-surface.md` §7 PR review step
 * 4 ("confirm no write path — not a disabled one, an absent one") is verified by inspecting this
 * module's own route table, which is short and exhaustive by construction.
 */
import { z } from 'zod';
import { METRIC_TOOL_CATALOGUE, findMetricTool, type GeneratedMetricTool } from './catalogue';
import { callMetricTool } from './tools/metric-tool';
import { getTickerSentiment, getTickerSentimentInputSchema } from './tools/get-ticker-sentiment';
import { comparePlatforms, comparePlatformsInputSchema } from './tools/compare-platforms';
import { explainSpike, explainSpikeInputSchema } from './tools/explain-spike';
import { getHistoricalWindow, getHistoricalWindowInputSchema } from './tools/get-historical-window';
import { listSupportingEvidence, listContradictingEvidence, listEvidenceInputSchema } from './tools/list-evidence';
import { openCalculation, openCalculationInputSchema } from './tools/open-calculation';
import { getCoverage, getCoverageInputSchema } from './tools/get-coverage';
import { McpToolError } from './tools/errors';
import { renderMetricCard, MetricCardNotFoundError } from './resources/metric-card';
import { renderEvidenceList, EvidenceListNotFoundError } from './resources/evidence-list';
import { renderInspector, InspectorNotFoundError } from './resources/inspector';
import type { McpToolErrorEnvelope, McpToolResultEnvelope } from './contract';

// ── The 8 named tools (F21 §4.2's table) ──────────────────────────────────────────────────────

type NamedTool = {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly inputSchema: Record<string, unknown>;
  readonly handler: (args: unknown) => Promise<McpToolResultEnvelope>;
};

const NAMED_TOOLS: readonly NamedTool[] = [
  {
    name: 'get_ticker_sentiment',
    description: 'Per-axis stance with n, window, calculationId, per-axis disclosure.',
    whenToUse: 'The current state of one name.',
    inputSchema: getTickerSentimentInputSchema,
    handler: getTickerSentiment,
  },
  {
    name: 'compare_platforms',
    description: 'The three axes side by side, never blended.',
    whenToUse: 'Where Reddit, X and Substack disagree.',
    inputSchema: comparePlatformsInputSchema,
    handler: comparePlatforms,
  },
  {
    name: 'explain_spike',
    description: 'The trigger event, the items around it, the price context.',
    whenToUse: "The primary tool. Something moved and the operator wants to know what was said.",
    inputSchema: explainSpikeInputSchema,
    handler: explainSpike,
  },
  {
    name: 'get_historical_window',
    description: 'A series with its coverage floor and per-axis start dates.',
    whenToUse: 'Anything about the past.',
    inputSchema: getHistoricalWindowInputSchema,
    handler: getHistoricalWindow,
  },
  {
    name: 'list_supporting_evidence',
    description: 'Bounded, classified items with URLs and retrievedAt.',
    whenToUse: 'Grounding a claim.',
    inputSchema: listEvidenceInputSchema,
    handler: listSupportingEvidence,
  },
  {
    name: 'list_contradicting_evidence',
    description: 'Same as list_supporting_evidence, filtered to opposing stance.',
    whenToUse: 'Adversarial checking.',
    inputSchema: listEvidenceInputSchema,
    handler: listContradictingEvidence,
  },
  {
    name: 'open_calculation',
    description: 'The CalculationArtifact with inputs, steps, exact decimal, hashes.',
    whenToUse: '"How was this computed?"',
    inputSchema: openCalculationInputSchema,
    handler: openCalculation,
  },
  {
    name: 'get_coverage',
    description: 'What is collected, since when, with what gaps.',
    whenToUse: 'Called before any historical claim.',
    inputSchema: getCoverageInputSchema,
    handler: getCoverage,
  },
];

function metricToolAsListing(tool: GeneratedMetricTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    _meta: { whenToUse: tool.whenToUse, methodId: tool.methodId, methodVersion: tool.methodVersion },
  };
}

export function listTools(): readonly { name: string; description: string; inputSchema: unknown; _meta?: unknown }[] {
  const named = NAMED_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    _meta: { whenToUse: tool.whenToUse },
  }));
  const generated = METRIC_TOOL_CATALOGUE.map(metricToolAsListing);
  return [...named, ...generated];
}

export async function callTool(name: string, args: unknown): Promise<McpToolResultEnvelope | McpToolErrorEnvelope> {
  const named = NAMED_TOOLS.find((tool) => tool.name === name);
  try {
    if (named !== undefined) return await named.handler(args);

    const metricTool = findMetricTool(name);
    if (metricTool !== undefined) return await callMetricTool(metricTool, args);

    return { ok: false, tool: name, error: { code: 'invalid_arguments', message: `Unknown tool '${name}'.` } };
  } catch (error) {
    if (error instanceof McpToolError) {
      return { ok: false, tool: name, error: { code: error.code, message: error.message } };
    }
    throw error;
  }
}

// ── ui:// resources (F21 §4.4) ────────────────────────────────────────────────────────────────

export const UI_RESOURCE_TEMPLATES = [
  { uriTemplate: 'ui://metric-card{?calculationId,n,window,label}', name: 'Metric card', mimeType: 'text/html' },
  { uriTemplate: 'ui://evidence-list{?symbol,direction}', name: 'Evidence list', mimeType: 'text/html' },
  { uriTemplate: 'ui://inspector{?calculationId}', name: 'Inspector', mimeType: 'text/html' },
] as const;

export class ResourceNotFoundError extends Error {}

export async function readResource(uri: string): Promise<{ readonly mimeType: string; readonly text: string }> {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new ResourceNotFoundError(`'${uri}' is not a valid resource URI.`);
  }
  if (parsed.protocol !== 'ui:') {
    throw new ResourceNotFoundError(`Only ui:// resources are served here — got '${parsed.protocol}'.`);
  }

  const kind = parsed.hostname; // 'metric-card' | 'evidence-list' | 'inspector'
  const params = parsed.searchParams;

  try {
    if (kind === 'metric-card') {
      const calculationId = params.get('calculationId');
      if (calculationId === null) throw new ResourceNotFoundError('metric-card requires calculationId.');
      const n = params.get('n');
      const html = await renderMetricCard({
        calculationId,
        n: n === null ? null : Number(n),
        window: params.get('window'),
        label: params.get('label'),
      });
      return { mimeType: 'text/html', text: html };
    }

    if (kind === 'evidence-list') {
      const symbol = params.get('symbol');
      const directionRaw = params.get('direction') ?? 'supporting';
      const direction = z.enum(['supporting', 'contradicting']).safeParse(directionRaw);
      if (symbol === null || !direction.success) {
        throw new ResourceNotFoundError('evidence-list requires symbol and a valid direction.');
      }
      const html = await renderEvidenceList({ symbol, direction: direction.data });
      return { mimeType: 'text/html', text: html };
    }

    if (kind === 'inspector') {
      const calculationId = params.get('calculationId');
      if (calculationId === null) throw new ResourceNotFoundError('inspector requires calculationId.');
      const html = await renderInspector(calculationId);
      return { mimeType: 'text/html', text: html };
    }
  } catch (error) {
    if (error instanceof MetricCardNotFoundError || error instanceof EvidenceListNotFoundError || error instanceof InspectorNotFoundError) {
      throw new ResourceNotFoundError(error.message);
    }
    throw error;
  }

  throw new ResourceNotFoundError(`Unknown ui:// resource kind '${kind}'.`);
}

// ── JSON-RPC 2.0 envelope ─────────────────────────────────────────────────────────────────────

const jsonRpcRequest = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export type JsonRpcResponse = {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
} & ({ readonly result: unknown } | { readonly error: { readonly code: number; readonly message: string } });

const SERVER_INFO = { name: 'barebone-social-sentiment-mcp', version: '1.0.0' } as const;
/** Pinned per F21 §8's own named risk ("MCP Apps is a young extension and its spec is moving"). */
const PROTOCOL_VERSION = '2025-06-18';

export async function handleJsonRpc(body: unknown): Promise<JsonRpcResponse> {
  const parsed = jsonRpcRequest.safeParse(body);
  if (!parsed.success) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Invalid Request: ${parsed.error.message}` } };
  }
  const { id, method, params } = parsed.data;
  const responseId = id ?? null;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: {} },
            serverInfo: SERVER_INFO,
          },
        };

      case 'tools/list':
        return { jsonrpc: '2.0', id: responseId, result: { tools: listTools() } };

      case 'tools/call': {
        const callParams = z.object({ name: z.string().min(1), arguments: z.unknown().optional() }).parse(params);
        const envelope = await callTool(callParams.name, callParams.arguments ?? {});
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: { content: [{ type: 'text', text: JSON.stringify(envelope) }], isError: !envelope.ok },
        };
      }

      case 'resources/list':
        return { jsonrpc: '2.0', id: responseId, result: { resources: [] } };

      case 'resources/templates/list':
        return { jsonrpc: '2.0', id: responseId, result: { resourceTemplates: UI_RESOURCE_TEMPLATES } };

      case 'resources/read': {
        const readParams = z.object({ uri: z.string().min(1) }).parse(params);
        const resource = await readResource(readParams.uri);
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: { contents: [{ uri: readParams.uri, mimeType: resource.mimeType, text: resource.text }] },
        };
      }

      default:
        return { jsonrpc: '2.0', id: responseId, error: { code: -32601, message: `Method not found: '${method}'.` } };
    }
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return { jsonrpc: '2.0', id: responseId, error: { code: -32001, message: error.message } };
    }
    if (error instanceof z.ZodError) {
      return { jsonrpc: '2.0', id: responseId, error: { code: -32602, message: `Invalid params: ${error.message}` } };
    }
    throw error;
  }
}
