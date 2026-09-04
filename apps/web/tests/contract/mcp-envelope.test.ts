import { describe, expect, it } from 'vitest';
import { mcpToolResult, mcpToolResultEnvelope, mcpToolErrorEnvelope } from '../../src/services/mcp/contract';
import { buildEnvelope } from '../../src/services/mcp/envelope';

/**
 * F21 §5 contract level: "Every tool result validates against `ToolResultEnvelope`; every
 * numeric carries a `calculationId`." This file checks the envelope's own shape in isolation
 * (no DB); `tests/integration/mcp-tools.test.ts` checks real tool output against it end to end.
 */

const okEnvelope = {
  ok: true as const,
  tool: 'get_ticker_sentiment',
  data: { symbol: 'GME' },
  coverage: [{ axis: 'reddit' as const, startedAt: '2026-09-04T00:00:00.000Z', gapCount: 0, disclosure: 'coverage begins 2026-09-04 for reddit' }],
  n: 12,
  window: { from: null, to: null, label: 'current snapshot' },
  limitations: ['a limitation'],
  mustNotClaim: ['This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.'],
  calculationIds: ['00000000-0000-4000-8000-000000000001'],
};

describe('mcpToolResultEnvelope', () => {
  it('parses a fully-populated ok envelope', () => {
    expect(() => mcpToolResultEnvelope.parse(okEnvelope)).not.toThrow();
  });

  it('rejects an envelope with an empty mustNotClaim — every result carries at least the §6.4 line', () => {
    expect(() => mcpToolResultEnvelope.parse({ ...okEnvelope, mustNotClaim: [] })).toThrow();
  });

  it('rejects an envelope missing coverage entirely', () => {
    const { coverage: _coverage, ...rest } = okEnvelope;
    expect(() => mcpToolResultEnvelope.parse(rest)).toThrow();
  });

  it('rejects an envelope missing calculationIds entirely', () => {
    const { calculationIds: _calculationIds, ...rest } = okEnvelope;
    expect(() => mcpToolResultEnvelope.parse(rest)).toThrow();
  });

  it('accepts n: null and window: null for a tool with no single sampled aggregate (e.g. open_calculation)', () => {
    expect(() => mcpToolResultEnvelope.parse({ ...okEnvelope, n: null, window: null })).not.toThrow();
  });

  it('rejects a coverage axis outside F22\'s four', () => {
    expect(() =>
      mcpToolResultEnvelope.parse({ ...okEnvelope, coverage: [{ ...okEnvelope.coverage[0], axis: 'twitter' }] }),
    ).toThrow();
  });
});

describe('mcpToolErrorEnvelope / mcpToolResult', () => {
  it('parses a well-formed error envelope', () => {
    expect(() =>
      mcpToolErrorEnvelope.parse({ ok: false, tool: 'get_ticker_sentiment', error: { code: 'not_found', message: 'no such security' } }),
    ).not.toThrow();
  });

  it('the discriminated union accepts both shapes and rejects a mixed one', () => {
    expect(() => mcpToolResult.parse(okEnvelope)).not.toThrow();
    expect(() =>
      mcpToolResult.parse({ ok: false, tool: 'x', error: { code: 'not_found', message: 'm' } }),
    ).not.toThrow();
    expect(() => mcpToolResult.parse({ ok: false, tool: 'x', data: {} })).toThrow();
  });
});

describe('buildEnvelope', () => {
  it('dedupes limitations, mustNotClaim and calculationIds while preserving order', () => {
    const built = buildEnvelope({
      tool: 'compare_platforms',
      data: {},
      coverage: [],
      n: 3,
      window: null,
      limitations: ['a', 'b', 'a'],
      mustNotClaim: ['x', 'x'],
      calculationIds: ['id-1', 'id-2', 'id-1'],
    });
    expect(built.limitations).toEqual(['a', 'b']);
    expect(built.mustNotClaim).toEqual(['x']);
    expect(built.calculationIds).toEqual(['id-1', 'id-2']);
    expect(() => mcpToolResultEnvelope.parse(built)).not.toThrow();
  });
});
