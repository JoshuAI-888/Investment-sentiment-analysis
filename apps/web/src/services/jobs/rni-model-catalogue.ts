import { sha256Hex } from '@/calc/canonical';
import { env } from '@/env';
import type { RniModelCapability } from '@/rni/config';
import { z } from 'zod';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const modelId = z.enum(['gpt-5.6-terra', 'gpt-5.6-sol']);
type ApprovedModelId = z.infer<typeof modelId>;

const decimalText = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/u)
  .refine((value) => /[1-9]/u.test(value), 'Price must be positive');

const priceTier = z
  .object({
    cost: decimalText,
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().positive().optional(),
  })
  .passthrough();

const catalogueModel = z
  .object({
    id: z.string().min(1),
    object: z.literal('model'),
    owned_by: z.literal('openai'),
    type: z.literal('language'),
    tags: z.array(z.string()),
    supported_specifications: z.array(z.string()),
    supported_parameters: z.array(z.string()),
    reasoning_options: z.array(
      z
        .object({
          type: z.string(),
          values: z.array(z.string()).optional(),
        })
        .passthrough(),
    ),
    pricing: z
      .object({
        input: decimalText,
        input_tiers: z.array(priceTier).optional(),
        output: decimalText,
        output_tiers: z.array(priceTier).optional(),
        web_search: decimalText,
      })
      .passthrough(),
  })
  .passthrough();

const catalogueEnvelope = z
  .object({ object: z.literal('list'), data: z.array(z.unknown()) })
  .passthrough();

const directModelEnvelope = z
  .object({ id: modelId, object: z.literal('model'), owned_by: z.literal('openai') })
  .passthrough();

type CatalogueModel = z.infer<typeof catalogueModel>;

export type RniDiscoveredPriceBook = {
  readonly priceBookVersion: string;
  readonly effectiveFrom: string;
  readonly sourceReference: string;
  readonly terraInputTokenUsd: string;
  readonly terraOutputTokenUsd: string;
  readonly solInputTokenUsd: string;
  readonly solOutputTokenUsd: string;
  readonly webSearchUsd: string;
  readonly firstTierInputCeiling: number | null;
};

export type RniModelCatalogueEvidence = {
  readonly observedAt: string;
  readonly catalogueResponseHash: string;
  readonly capabilities: readonly RniModelCapability[];
  readonly priceBook: RniDiscoveredPriceBook;
};

export class RniCatalogueHttpError extends Error {
  constructor(
    readonly source: 'openai_direct' | 'vercel_ai_gateway',
    readonly status: number,
    readonly providerRequestId: string | null,
  ) {
    super(`${source} model-catalogue request failed with HTTP ${status}`);
    this.name = 'RniCatalogueHttpError';
  }
}

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`;

const readJson = (text: string, source: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${source} model catalogue returned invalid JSON`);
  }
};

const fetchText = async (
  fetcher: FetchLike,
  source: 'openai_direct' | 'vercel_ai_gateway',
  url: string,
  apiKey?: string,
): Promise<{ readonly text: string; readonly hash: string }> => {
  const response = await fetcher(url, {
    method: 'GET',
    headers: apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new RniCatalogueHttpError(source, response.status, response.headers.get('x-request-id'));
  }
  const text = await response.text();
  return { text, hash: sha256Hex(text) };
};

const dividePerThousandPrice = (value: string): string => {
  const [whole = '0', fraction = ''] = value.split('.');
  const rawDigits = `${whole}${fraction}`.replace(/^0+(?=\d)/u, '');
  const scale = fraction.length + 3;
  const padded = rawDigits.padStart(scale + 1, '0');
  const integer = padded.slice(0, -scale).replace(/^0+(?=\d)/u, '');
  const decimals = padded.slice(-scale).replace(/0+$/u, '');
  return decimals === '' ? integer : `${integer}.${decimals}`;
};

const findModel = (data: readonly unknown[], canonicalId: ApprovedModelId): CatalogueModel => {
  const gatewayId = `openai/${canonicalId}`;
  const candidates = data.filter(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>)['id'] === gatewayId,
  );
  if (candidates.length !== 1) {
    throw new Error(`Gateway catalogue must expose exactly one ${gatewayId} model`);
  }
  return catalogueModel.parse(candidates[0]);
};

const reasoningEfforts = (model: CatalogueModel): RniModelCapability['reasoningEfforts'] => {
  const values = model.reasoning_options
    .filter(({ type }) => type === 'effort')
    .flatMap(({ values: optionValues }) => optionValues ?? [])
    .filter(
      (value): value is RniModelCapability['reasoningEfforts'][number] =>
        ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value),
    );
  return [...new Set(values)];
};

const firstTierCeiling = (model: CatalogueModel): number | null => {
  const ceilings = (model.pricing.input_tiers ?? [])
    .filter(({ min }) => min === undefined || min === 0)
    .map(({ max }) => max)
    .filter((value): value is number => value !== undefined);
  return ceilings.length === 1 ? ceilings[0]! : null;
};

const capability = (input: {
  readonly route: 'openai_direct' | 'vercel_ai_gateway';
  readonly model: CatalogueModel;
  readonly canonicalId: ApprovedModelId;
  readonly directModel: z.infer<typeof directModelEnvelope>;
  readonly responseHash: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}): RniModelCapability => {
  const efforts = reasoningEfforts(input.model);
  const configuredModelId =
    input.route === 'openai_direct' ? input.canonicalId : input.model.id;
  return {
    route: input.route,
    configuredModelId,
    provider: 'openai',
    providerModelId: input.canonicalId,
    modelRevision: input.directModel.id,
    capabilitySnapshotId:
      `rni-cap-${input.route}-${input.canonicalId}-${sha256Hex(`${input.responseHash}:${input.observedAt}`).slice(0, 16)}`,
    capabilityResponseHash: input.responseHash,
    observedAt: input.observedAt,
    expiresAt: input.expiresAt,
    available: true,
    supportsResponses: input.model.supported_specifications.includes('v4'),
    supportsStructuredOutputs: input.model.supported_specifications.includes('v4'),
    supportsWebSearch: input.model.tags.includes('web-search'),
    reasoningEfforts: efforts,
  };
};

/**
 * Discover server-side model identities from OpenAI and dispatch/capability/pricing metadata from
 * the public Gateway catalogue. This is preflight evidence; I11 still proves an actual governed
 * Responses call before any staged successor is activated.
 */
export const discoverRniModelCatalogueEvidence = async (options: {
  readonly fetch?: FetchLike;
  readonly openAiApiKey?: string;
  readonly openAiBaseUrl?: string;
  readonly gatewayBaseUrl?: string;
  readonly observedAt?: Date;
  readonly capabilityTtlMs?: number;
} = {}): Promise<RniModelCatalogueEvidence> => {
  const fetcher = options.fetch ?? fetch;
  const openAiApiKey = options.openAiApiKey ?? env.OPENAI_API_KEY;
  if (openAiApiKey === undefined || openAiApiKey.trim() === '') {
    throw new Error('OPENAI_API_KEY is required for RNI Direct capability discovery');
  }
  const openAiBaseUrl = options.openAiBaseUrl ?? 'https://api.openai.com/v1';
  const gatewayBaseUrl = options.gatewayBaseUrl ?? env.AI_GATEWAY_BASE_URL;
  const observedAt = options.observedAt ?? new Date();
  const ttlMs = options.capabilityTtlMs ?? 86_400_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 86_400_000) {
    throw new Error('RNI capability TTL must be a positive duration no longer than 24 hours');
  }
  const observedAtIso = observedAt.toISOString();
  const expiresAt = new Date(observedAt.getTime() + ttlMs).toISOString();

  const gatewayResponse = await fetchText(
    fetcher,
    'vercel_ai_gateway',
    joinUrl(gatewayBaseUrl, 'models'),
  );
  const gatewayEnvelope = catalogueEnvelope.parse(
    readJson(gatewayResponse.text, 'Gateway'),
  );
  const terra = findModel(gatewayEnvelope.data, 'gpt-5.6-terra');
  const sol = findModel(gatewayEnvelope.data, 'gpt-5.6-sol');

  const directResponses = await Promise.all(
    (['gpt-5.6-terra', 'gpt-5.6-sol'] as const).map(async (id) => {
      const response = await fetchText(
        fetcher,
        'openai_direct',
        joinUrl(openAiBaseUrl, `models/${id}`),
        openAiApiKey,
      );
      return { id, response, model: directModelEnvelope.parse(readJson(response.text, 'OpenAI')) };
    }),
  );
  const directById = new Map(directResponses.map((entry) => [entry.id, entry]));
  if (directResponses.some((entry) => entry.model.id !== entry.id)) {
    throw new Error('OpenAI Direct model lookup returned a crossed approved model identity');
  }

  const capabilityRows = ([
    ['gpt-5.6-terra', terra],
    ['gpt-5.6-sol', sol],
  ] as const).flatMap(([id, model]) => {
    const direct = directById.get(id)!;
    const combinedHash = sha256Hex(`${gatewayResponse.hash}:${direct.response.hash}`);
    return [
      capability({
        route: 'openai_direct',
        model,
        canonicalId: id,
        directModel: direct.model,
        responseHash: combinedHash,
        observedAt: observedAtIso,
        expiresAt,
      }),
      capability({
        route: 'vercel_ai_gateway',
        model,
        canonicalId: id,
        directModel: direct.model,
        responseHash: gatewayResponse.hash,
        observedAt: observedAtIso,
        expiresAt,
      }),
    ];
  });

  const webSearchPrices = [terra.pricing.web_search, sol.pricing.web_search];
  if (new Set(webSearchPrices).size !== 1) {
    throw new Error('Approved OpenAI models expose conflicting Gateway Web Search prices');
  }
  const ceilings = [firstTierCeiling(terra), firstTierCeiling(sol)];
  const firstTierInputCeiling =
    ceilings.every((value): value is number => value !== null) ? Math.min(...ceilings) : null;
  const priceBookVersion =
    `rni-gateway-${observedAtIso.replace(/\D/gu, '')}-${gatewayResponse.hash.slice(0, 12)}`;

  return {
    observedAt: observedAtIso,
    catalogueResponseHash: gatewayResponse.hash,
    capabilities: capabilityRows,
    priceBook: {
      priceBookVersion,
      effectiveFrom: observedAtIso,
      sourceReference: `${joinUrl(gatewayBaseUrl, 'models')}#sha256=${gatewayResponse.hash}`,
      terraInputTokenUsd: terra.pricing.input,
      terraOutputTokenUsd: terra.pricing.output,
      solInputTokenUsd: sol.pricing.input,
      solOutputTokenUsd: sol.pricing.output,
      // Gateway's model pages display this catalogue field per 1,000 searches. Normalize it to
      // this repository's per-search unit so reservation and settlement multiply like units.
      webSearchUsd: dividePerThousandPrice(webSearchPrices[0]!),
      firstTierInputCeiling,
    },
  };
};
