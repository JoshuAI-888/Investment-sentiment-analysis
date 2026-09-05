import { describe, expect, it, vi } from 'vitest';

import {
  discoverRniModelCatalogueEvidence,
  RniCatalogueHttpError,
} from '../../../src/services/jobs/rni-model-catalogue';

const model = (id: 'gpt-5.6-terra' | 'gpt-5.6-sol', webSearch = '10') => ({
  id: `openai/${id}`,
  object: 'model',
  owned_by: 'openai',
  type: 'language',
  tags: ['reasoning', 'tool-use', 'web-search'],
  supported_specifications: ['v2', 'v3', 'v4'],
  supported_parameters: ['max_tokens', 'tools', 'tool_choice', 'reasoning'],
  reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high'] }],
  pricing: {
    input: id.endsWith('terra') ? '0.000002' : '0.000003',
    input_tiers: [
      { cost: id.endsWith('terra') ? '0.000002' : '0.000003', min: 0, max: 272000 },
      { cost: '0.000004', min: 272000 },
    ],
    output: id.endsWith('terra') ? '0.000012' : '0.000015',
    web_search: webSearch,
  },
});

const discoveryFetch = (options: { readonly solWebSearch?: string; readonly directSolId?: string } = {}) =>
  vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [model('gpt-5.6-terra'), model('gpt-5.6-sol', options.solWebSearch)],
        }),
      );
    }
    const requestedId = url.endsWith('gpt-5.6-terra') ? 'gpt-5.6-terra' : 'gpt-5.6-sol';
    return new Response(
      JSON.stringify({
        id: requestedId === 'gpt-5.6-sol' ? (options.directSolId ?? requestedId) : requestedId,
        object: 'model',
        owned_by: 'openai',
      }),
    );
  });

describe('I10C2 — RNI model catalogue discovery', () => {
  it('derives exact Direct/Gateway identities and normalized conservative price evidence', async () => {
    const requestFetch = discoveryFetch();
    const evidence = await discoverRniModelCatalogueEvidence({
      fetch: requestFetch,
      openAiApiKey: 'direct-secret',
      openAiBaseUrl: 'https://openai.example/v1',
      gatewayBaseUrl: 'https://gateway.example/v1/',
      observedAt: new Date('2026-09-05T01:02:03.000Z'),
    });

    expect(requestFetch).toHaveBeenCalledTimes(3);
    expect(evidence.capabilities).toHaveLength(4);
    expect(evidence.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: 'openai_direct',
          configuredModelId: 'gpt-5.6-terra',
          providerModelId: 'gpt-5.6-terra',
          supportsResponses: true,
          supportsStructuredOutputs: true,
          supportsWebSearch: true,
          reasoningEfforts: ['none', 'low', 'medium', 'high'],
        }),
        expect.objectContaining({
          route: 'vercel_ai_gateway',
          configuredModelId: 'openai/gpt-5.6-sol',
          providerModelId: 'gpt-5.6-sol',
        }),
      ]),
    );
    expect(evidence.priceBook).toMatchObject({
      terraInputTokenUsd: '0.000002',
      terraOutputTokenUsd: '0.000012',
      solInputTokenUsd: '0.000003',
      solOutputTokenUsd: '0.000015',
      webSearchUsd: '0.01',
      firstTierInputCeiling: 272000,
    });
    expect(evidence.priceBook.sourceReference).toMatch(
      /^https:\/\/gateway\.example\/v1\/models#sha256=[a-f0-9]{64}$/u,
    );
    const directCalls = requestFetch.mock.calls.filter(([url]) => String(url).includes('openai.example'));
    expect(directCalls).toHaveLength(2);
    for (const call of directCalls) {
      expect((call[1]?.headers as Record<string, string>).authorization).toBe('Bearer direct-secret');
    }
  });

  it('fails closed on crossed Direct identity or conflicting per-search catalogue prices', async () => {
    await expect(
      discoverRniModelCatalogueEvidence({
        fetch: discoveryFetch({ directSolId: 'gpt-5.6-terra' }),
        openAiApiKey: 'secret',
        observedAt: new Date('2026-09-05T00:00:00.000Z'),
      }),
    ).rejects.toThrow();
    await expect(
      discoverRniModelCatalogueEvidence({
        fetch: discoveryFetch({ solWebSearch: '14' }),
        openAiApiKey: 'secret',
        observedAt: new Date('2026-09-05T00:00:00.000Z'),
      }),
    ).rejects.toThrow('conflicting Gateway Web Search prices');
  });

  it('sanitizes catalogue HTTP failures without copying the provider body', async () => {
    const requestFetch = vi.fn(async () =>
      new Response('secret provider detail', {
        status: 503,
        headers: { 'x-request-id': 'provider-request-1' },
      }),
    );
    const error = await discoverRniModelCatalogueEvidence({
      fetch: requestFetch,
      openAiApiKey: 'secret',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RniCatalogueHttpError);
    expect(String(error)).not.toContain('secret provider detail');
  });
});
