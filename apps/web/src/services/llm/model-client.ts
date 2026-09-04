/**
 * Two `ModelClient` implementations — fixture and live — sharing one dispatch pipeline: budget
 * check, call, parse, validate, record. See `ports.ts` for why this is not `adapters/wrapper.ts`
 * reused.
 *
 * **Fixtures before live calls** (`docs/04-BUILD-LOOP.md` §2.3). `createFixtureModelClient` is
 * what every test in this feature runs against. `createGatewayModelClient` exists because MT-06
 * is now provisioned, but it is exercised only by type-checking and a live-mode smoke path in
 * this build — no test in this feature calls a real model, matching F04/F20's own convention of
 * developing against `PROVIDER_MODE=fixture` and never inventing a key for CI.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  ModelBudgetGate,
  ModelCallLogSink,
  ModelCallMeta,
  ModelClassifyInput,
  ModelClient,
  ModelClientError,
  ModelClientResult,
  ModelCostSink,
} from './ports';

export const DEFAULT_LLM_FIXTURES_ROOT = join(process.cwd(), 'fixtures', 'llm');
export const DEFAULT_FIXTURE_CASE = 'success';

/** The on-disk shape a recorded (or, here, synthetic — see `fixtures/llm/README.md`) case has. */
type ModelFixtureFile = {
  status: number;
  body: {
    modelId: string;
    tokensIn: number | null;
    tokensOut: number | null;
    costUsd: string | null;
    /** The raw text the model emitted — a JSON string, exactly as a real completion would be. */
    content: string;
  };
};

export class ModelFixtureNotFoundError extends Error {
  constructor(
    public readonly task: string,
    public readonly fixtureCase: string,
    public readonly path: string,
  ) {
    super(
      `no LLM fixture recorded for ${task}/${fixtureCase} (looked in ${path}). Record one ` +
        'deliberately (fixtures/llm/README.md) — never invent one inline.',
    );
    this.name = 'ModelFixtureNotFoundError';
  }
}

async function readModelFixture(
  task: string,
  fixtureCase: string,
  root: string,
): Promise<ModelFixtureFile> {
  const path = join(root, task, `${fixtureCase}.json`);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    throw new ModelFixtureNotFoundError(task, fixtureCase, path);
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as ModelFixtureFile).status !== 'number' ||
    typeof (parsed as ModelFixtureFile).body !== 'object'
  ) {
    throw new Error(`${path} is not a valid LLM fixture: expected { status: number, body }`);
  }
  return parsed as ModelFixtureFile;
}

/** Injected so every test controls the clock and the id, per this codebase's own convention. */
export type ModelClientDeps = {
  readonly budgetGate: ModelBudgetGate;
  readonly costSink: ModelCostSink;
  readonly callLogSink: ModelCallLogSink;
  readonly now: () => Date;
  readonly nextRequestId: () => string;
};

export const systemModelClientDeps: Pick<ModelClientDeps, 'now' | 'nextRequestId'> = {
  now: () => new Date(),
  nextRequestId: () => randomUUID(),
};

/** A permissive budget gate — the default until F18 lands, matching `adapters/ports.ts`'s note. */
export const permissiveBudgetGate: ModelBudgetGate = {
  check: async () => ({ allowed: true }),
};

function emptyMeta(input: ModelClassifyInput, route: string, requestId: string, at: Date): ModelCallMeta {
  return {
    modelId: '',
    route,
    promptVersion: input.promptVersion,
    temperature: '0',
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    requestId,
    latencyMs: 0,
    requestedAt: at.toISOString(),
  };
}

/**
 * Shared by both implementations: budget-check, then dispatch (the injected `dispatch`
 * function), then parse `content` as JSON, then validate against the caller's schema. Never
 * throws — a malformed response is `{ ok: false, error: { kind: 'schema_invalid' } }`, never a
 * coerced value (F10 §4.4, §6 DoD: "a schema-invalid response never becomes a stance" — and,
 * for these two methods, never becomes a relevance or collision verdict either).
 */
async function dispatch<T>(
  input: ModelClassifyInput,
  schema: z.ZodType<T>,
  route: string,
  deps: ModelClientDeps,
  call: () => Promise<{ status: number; body: ModelFixtureFile['body'] }>,
): Promise<ModelClientResult<T>> {
  const requestId = deps.nextRequestId();
  const startedAt = deps.now();

  const budget = await deps.budgetGate.check({
    task: input.task,
    // Unknown until the call returns (a classify call's cost depends on token count) — `null`
    // is UNPRICED-at-dispatch-time, the same convention `ProviderMeta.costUsd` uses.
    estimatedCostUsd: null,
  });
  if (!budget.allowed) {
    const meta = emptyMeta(input, route, requestId, startedAt);
    await deps.callLogSink({
      task: input.task,
      requestFingerprint: requestId,
      statusCode: null,
      latencyMs: 0,
      itemsReturned: null,
      estimatedCostUsd: '0',
      startedAt,
      errorClass: 'budget_denied',
    });
    return { ok: false, error: { kind: 'budget_denied', scope: budget.scope }, meta };
  }

  const response = await call();
  const latencyMs = deps.now().getTime() - startedAt.getTime();
  const meta: ModelCallMeta = {
    modelId: response.body.modelId,
    route,
    promptVersion: input.promptVersion,
    temperature: '0',
    tokensIn: response.body.tokensIn,
    tokensOut: response.body.tokensOut,
    costUsd: response.body.costUsd,
    requestId,
    latencyMs,
    requestedAt: startedAt.toISOString(),
  };

  await deps.callLogSink({
    task: input.task,
    requestFingerprint: requestId,
    statusCode: response.status,
    latencyMs,
    itemsReturned: response.status === 200 ? 1 : 0,
    estimatedCostUsd: response.body.costUsd ?? '0',
    startedAt,
    errorClass: response.status === 200 ? null : `http_${String(response.status)}`,
  });
  if (response.body.costUsd !== null) {
    await deps.costSink({
      task: input.task,
      unitType: 'call',
      requestUnits: '1',
      costUsd: response.body.costUsd,
      requestId,
      occurredAt: startedAt,
    });
  }

  if (response.status !== 200) {
    const error: ModelClientError = { kind: 'upstream', status: response.status };
    return { ok: false, error, meta };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.body.content);
  } catch {
    return {
      ok: false,
      error: { kind: 'schema_invalid', issues: ['response content is not valid JSON'], raw: response.body.content },
      meta,
    };
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return { ok: false, error: { kind: 'schema_invalid', issues, raw: response.body.content }, meta };
  }

  return { ok: true, data: result.data, meta };
}

/** `PROVIDER_MODE=fixture` — every test in this feature runs against this. */
export function createFixtureModelClient(
  deps: ModelClientDeps,
  fixturesRoot: string = DEFAULT_LLM_FIXTURES_ROOT,
): ModelClient {
  return {
    classify: async (input, schema) =>
      dispatch(input, schema, 'fixture', deps, async () => {
        const file = await readModelFixture(input.task, input.fixtureCase ?? DEFAULT_FIXTURE_CASE, fixturesRoot);
        return { status: file.status, body: file.body };
      }),
  };
}

/**
 * `PROVIDER_MODE=live`, `MODEL_TRANSPORT_DEFAULT=vercel_gateway` (D-34/ADR-017's default).
 * Config is passed in, not read from `@/env` here — the caller (the one composition point that
 * actually knows the environment) is responsible for reading `AI_GATEWAY_API_KEY`/`AI_MODEL_FAST`
 * and deciding the route string, matching how `services/market/collector.ts` and similar
 * top-level composers own the one `@/env` import for their slice.
 */
export type GatewayConfig = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
};

const DEFAULT_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export function createGatewayModelClient(config: GatewayConfig, deps: ModelClientDeps): ModelClient {
  const baseUrl = config.baseUrl ?? DEFAULT_GATEWAY_BASE_URL;
  return {
    classify: async (input, schema) =>
      dispatch(input, schema, 'vercel_gateway', deps, async () => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.modelId,
            temperature: 0,
            max_tokens: input.maxOutputTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.prompt },
            ],
          }),
        });

        if (!response.ok) {
          return { status: response.status, body: { modelId: config.modelId, tokensIn: null, tokensOut: null, costUsd: null, content: '' } };
        }

        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
          // Vercel AI Gateway surfaces spend via its own headers/usage extension; treated as
          // unpriced here rather than guessed — see the module docstring: only the fixture path
          // is exercised by this feature's tests.
        };
        const content = json.choices?.[0]?.message?.content ?? '';
        return {
          status: 200,
          body: {
            modelId: json.model ?? config.modelId,
            tokensIn: json.usage?.prompt_tokens ?? null,
            tokensOut: json.usage?.completion_tokens ?? null,
            costUsd: null,
            content,
          },
        };
      }),
  };
}
