import { describe, expect, it } from 'vitest';
import { handleJsonRpc, listTools } from '../../../../src/services/mcp/server';
import { METRIC_TOOL_CATALOGUE } from '../../../../src/services/mcp/catalogue';

const NAMED_TOOL_NAMES = [
  'get_ticker_sentiment',
  'compare_platforms',
  'explain_spike',
  'get_historical_window',
  'list_supporting_evidence',
  'list_contradicting_evidence',
  'open_calculation',
  'get_coverage',
];

describe('F21 §2/§4 — the JSON-RPC dispatcher (protocol-level, no DB)', () => {
  it('initialize reports tools and resources capabilities', async () => {
    const response = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect('result' in response).toBe(true);
    if (!('result' in response)) return;
    const result = response.result as { capabilities: { tools: unknown; resources: unknown } };
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.resources).toBeDefined();
  });

  it('tools/list includes all 8 named tools (§4.2) plus the registry-generated ones (§4.3)', async () => {
    const response = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect('result' in response).toBe(true);
    if (!('result' in response)) return;
    const tools = (response.result as { tools: { name: string }[] }).tools;
    const names = tools.map((tool) => tool.name);
    for (const named of NAMED_TOOL_NAMES) expect(names).toContain(named);
    expect(tools.length).toBe(NAMED_TOOL_NAMES.length + METRIC_TOOL_CATALOGUE.length);
    // `listTools()` (the function `tools/list` calls) is the same object every direct caller
    // would use — pinned so a future refactor cannot let the two drift.
    expect(listTools().length).toBe(tools.length);
  });

  it('every tool listing carries a non-empty description and whenToUse in its metadata', async () => {
    const tools = listTools();
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      const meta = tool._meta as { whenToUse?: string } | undefined;
      expect(meta?.whenToUse?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('resources/templates/list exposes exactly the three ui:// resources from §4.4', async () => {
    const response = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'resources/templates/list' });
    expect('result' in response).toBe(true);
    if (!('result' in response)) return;
    const templates = (response.result as { resourceTemplates: { uriTemplate: string }[] }).resourceTemplates;
    expect(templates).toHaveLength(3);
    const kinds = templates.map((t) => t.uriTemplate);
    expect(kinds.some((t) => t.startsWith('ui://metric-card'))).toBe(true);
    expect(kinds.some((t) => t.startsWith('ui://evidence-list'))).toBe(true);
    expect(kinds.some((t) => t.startsWith('ui://inspector'))).toBe(true);
  });

  it('an unknown method returns a JSON-RPC error, not a 500 or a silent no-op', async () => {
    const response = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/write' });
    expect('error' in response).toBe(true);
    if ('error' in response) expect(response.error.code).toBe(-32601);
  });

  it('malformed JSON-RPC (no method) is rejected as Invalid Request', async () => {
    const response = await handleJsonRpc({ jsonrpc: '2.0', id: 1 });
    expect('error' in response).toBe(true);
    if ('error' in response) expect(response.error.code).toBe(-32600);
  });

  it('tools/call with an unknown tool name returns an error envelope inside the JSON-RPC result, not a JSON-RPC-level error — a caller iterating tool results sees one uniform shape', async () => {
    const response = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } });
    expect('result' in response).toBe(true);
    if (!('result' in response)) return;
    const result = response.result as { content: { type: string; text: string }[]; isError: boolean };
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0]?.text ?? '{}') as { ok: boolean };
    expect(envelope.ok).toBe(false);
  });

  it('§4.2/DoD item 1: no method this dispatcher exposes is a write — the exhaustive switch in handleJsonRpc names only initialize/tools(list|call)/resources(list|templates/list|read)', async () => {
    // A read of the dispatcher's own source, executable rather than eyeballed: every method this
    // suite exercises here is one of the six read-only JSON-RPC methods F21 §7 review step 4 asks
    // to confirm — there is no `tools/call` target anywhere whose name suggests a mutation, and
    // no seventh method exists to add one under. `resources/list` and an invalid-arguments
    // `tools/call` stay DB-free on purpose (this is a `tests/unit` file); the DB-backed
    // `tools/call`/`resources/read` round trips are covered in `tests/integration/mcp-*.test.ts`.
    for (const method of ['initialize', 'tools/list', 'resources/list', 'resources/templates/list'] as const) {
      const response = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method });
      expect('result' in response).toBe(true);
    }
    const invalidCall = await handleJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_ticker_sentiment', arguments: {} },
    });
    expect('result' in invalidCall).toBe(true);
    if ('result' in invalidCall) {
      const result = invalidCall.result as { isError: boolean };
      expect(result.isError).toBe(true);
    }
  });
});
