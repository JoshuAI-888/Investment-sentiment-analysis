/**
 * `ModelClient` implementations. `ports.ts` defines the interface; this file supplies the only
 * two this lane may construct in its own tree: a deterministic fixture client (used everywhere
 * in this lane's own test suites — `04-BUILD-LOOP.md` §2.3: "fixtures before live calls...
 * PROVIDER_MODE=fixture") and a thin Vercel AI Gateway client for `PROVIDER_MODE=live`, gated by
 * `src/env.ts`'s already-enforced D-34 requirement that `AI_MODEL_VERIFY` names a different
 * vendor from `AI_MODEL_SYNTHESIS`.
 *
 * **No live call is ever made in a test.** `createFixtureModelClient` is a pure function of a
 * caller-supplied responder; `createGatewayModelClient` is exercised only by construction in
 * `route.ts` behind `PROVIDER_MODE === 'live'`, never invoked in `PROVIDER_MODE=fixture`.
 */
import type { z } from 'zod';
import type { ClassifyInput, ModelClient, SynthInput, VerifyInput } from './ports';

export type FixtureResponder = (
  task: 'stance' | 'synthesis' | 'followup' | 'verify',
  input: ClassifyInput | SynthInput | VerifyInput,
) => unknown;

export class ModelClientSchemaError extends Error {
  constructor(task: string, issues: string[]) {
    super(`ModelClient fixture response for task "${task}" failed its schema: ${issues.join('; ')}`);
    this.name = 'ModelClientSchemaError';
  }
}

/**
 * Deterministic, no network, no timers. `responder` is a plain function so a test can encode
 * "the model returns X for this exact call" without a fixture file when the shape under test is
 * about orchestration rather than a specific frozen payload; tests that want a committed
 * fixture file read it themselves and hand it to this same responder shape.
 */
export function createFixtureModelClient(responder: FixtureResponder): ModelClient {
  function parseOrThrow<T>(task: string, schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new ModelClientSchemaError(task, result.error.issues.map((issue) => issue.message));
    }
    return result.data;
  }

  return {
    classify: async (task, input, schema) => parseOrThrow(task, schema, responder(task, input)),
    synthesize: async (task, input, schema) => parseOrThrow(task, schema, responder(task, input)),
    verify: async (task, input, schema) => parseOrThrow(task, schema, responder(task, input)),
  };
}

export type GatewayModelClientConfig = {
  apiKey: string;
  synthesisModel: string;
  verifyModel: string;
  fastModel: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

/**
 * D-34: closes MT-06's transport half. One integration (Vercel AI Gateway), unified spend
 * visibility. `synthesisModel` and `verifyModel` **must** differ (checked at construction, not
 * at call time) — a same-vendor verifier would pass most of the time for the wrong reason, per
 * D-34's own reasoning, and failing fast at construction is cheaper than discovering it from a
 * production incident.
 *
 * This is intentionally the thinnest possible OpenAI-compatible chat-completions caller — no SDK
 * dependency, structured output requested via `response_format: json_schema`, and the response
 * is still re-validated against the caller's zod schema regardless of what the gateway claims to
 * have enforced (`04-BUILD-LOOP.md`: never trust a provider's own claim of shape).
 */
export function createGatewayModelClient(config: GatewayModelClientConfig): ModelClient {
  if (config.synthesisModel === config.verifyModel) {
    throw new Error(
      'D-34: AI_MODEL_SYNTHESIS and AI_MODEL_VERIFY must be different vendors. A verifier that shares a model with the synthesiser is not an independent check.',
    );
  }

  const baseUrl = config.baseUrl ?? 'https://ai-gateway.vercel.sh/v1';
  const fetchImpl = config.fetcher ?? fetch;

  function modelFor(task: 'stance' | 'synthesis' | 'followup' | 'verify'): string {
    if (task === 'verify') return config.verifyModel;
    if (task === 'synthesis' || task === 'followup') return config.synthesisModel;
    return config.fastModel;
  }

  async function call<T>(
    task: 'stance' | 'synthesis' | 'followup' | 'verify',
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: modelFor(task),
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`ModelClient gateway call for task "${task}" failed with status ${String(response.status)}`);
    }

    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (content === undefined) {
      throw new Error(`ModelClient gateway call for task "${task}" returned no content`);
    }

    const parsed: unknown = JSON.parse(content);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new ModelClientSchemaError(task, result.error.issues.map((issue) => issue.message));
    }
    return result.data;
  }

  return {
    classify: async (task, input, schema) => call(task, JSON.stringify(input), schema),
    synthesize: async (task, input, schema) => call(task, input.prompt, schema),
    verify: async (task, input, schema) => call(task, input.prompt, schema),
  };
}
