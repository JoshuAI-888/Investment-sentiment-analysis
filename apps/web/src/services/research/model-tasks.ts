/**
 * `ResearchModelClient` — the LLM boundary for F11's two model calls: synthesis (and its
 * follow-up variant) and the bounded model-verification pass.
 * `02-ARCHITECTURE-CONTRACTS.md` §4.6's `ModelClient` names three methods —
 * `classify`/`synthesize`/`verify` — but the merged `services/llm/ports.ts`
 * (F10, D-21) implements only `classify`, scoped to exactly the two tasks D-21 permits in v1
 * (`'relevance' | 'entity_collision'`) with `MODEL_TASKS` as a **closed** union. Widening that
 * union or adding a `synthesize`/`verify` method both mean editing `services/llm/` — out of
 * bounds for this feature (`F11` build brief: "Never edit anything inside
 * `apps/web/src/services/llm/`... if you find a genuine bug or missing hook in them, report it
 * rather than editing").
 *
 * **This module is the same move F10 already made once**, one layer up: `services/llm/ports.ts`
 * itself explains why it does not reuse `adapters/ports.ts`'s `BudgetGate`/`CostSink`/
 * `CallLogSink` (keyed on `ProviderId`, an exhaustive union it does not own) — *"this module
 * defines its own... port shapes below, structurally identical in spirit... Reported as a
 * contract request."* This module does the identical thing relative to `services/llm/ports.ts`
 * itself: same dispatch discipline (budget-check-before-call, temperature 0, strict-schema
 * validate, drop to a typed error rather than coerce), a disjoint task union, own fixture root.
 * **Contract request, reported in this feature's build report:** `services/llm/ports.ts`'s
 * `ModelTask` should widen to include `'synthesis' | 'followup' | 'verify'` and `ModelClient`
 * should grow the `synthesize`/`verify` methods `02-ARCHITECTURE-CONTRACTS.md` §4.6 already
 * specifies, so F11 does not need a second, structurally-duplicated client. Not done here.
 *
 * **D-34: the verifier runs on a different vendor entirely, not merely a different model.**
 * Vercel AI Gateway model IDs are `<vendor>/<model>` strings (`AI_MODEL_SYNTHESIS`,
 * `AI_MODEL_VERIFY` in `src/env.ts` — both already exist as distinct config; no `env.ts` gap
 * found here). `assertDifferentVendors` below is a real, tested runtime check — not a comment —
 * enforced once at composition time (`run-service.ts`), so a misconfiguration that points both
 * routes at the same vendor fails loudly rather than silently defeating D-34's reasoning that two
 * same-vendor models share training lineage and therefore share blind spots.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';

export const RESEARCH_MODEL_TASKS = ['synthesis', 'followup', 'verify'] as const;
export type ResearchModelTask = (typeof RESEARCH_MODEL_TASKS)[number];

export type ResearchModelInput = {
  readonly task: ResearchModelTask;
  /** Semver-shaped — see `prompts.ts`. Recorded per run (F11 §4.4: "the system prompt is versioned and recorded per run"). */
  readonly promptVersion: string;
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  /** Fixture-mode case selection, mirrors `services/llm/ports.ts#ModelClassifyInput`. */
  readonly fixtureCase?: string;
};

export type ResearchModelCallMeta = {
  readonly modelId: string;
  readonly route: string;
  readonly promptVersion: string;
  readonly temperature: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costUsd: string | null;
  readonly requestId: string;
  readonly latencyMs: number;
  readonly requestedAt: string;
};

export type ResearchModelError =
  | { readonly kind: 'schema_invalid'; readonly issues: readonly string[]; readonly raw: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'upstream'; readonly status: number }
  | { readonly kind: 'budget_denied'; readonly scope: 'account' | 'global' };

export type ResearchModelResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: ResearchModelCallMeta }
  | { readonly ok: false; readonly error: ResearchModelError; readonly meta: ResearchModelCallMeta };

export type ResearchModelClient = {
  run<T>(input: ResearchModelInput, schema: z.ZodType<T>): Promise<ResearchModelResult<T>>;
};

// ── Budget, cost and call-log ports — this module's own, mirroring `services/llm/ports.ts` ─────

export type ResearchModelBudgetGate = {
  check(input: {
    task: ResearchModelTask;
    estimatedCostUsd: string | null;
  }): Promise<{ allowed: true } | { allowed: false; scope: 'account' | 'global'; message: string }>;
};

export type ResearchModelCostEntry = {
  readonly task: ResearchModelTask;
  readonly runId: string;
  readonly modelId: string;
  readonly costUsd: string | null;
  readonly requestId: string;
  readonly occurredAt: Date;
};
export type ResearchModelCostSink = (entry: ResearchModelCostEntry) => Promise<void>;

export type ResearchModelCallLogEntry = {
  readonly task: ResearchModelTask;
  readonly runId: string;
  readonly requestFingerprint: string;
  readonly statusCode: number | null;
  readonly latencyMs: number;
  readonly estimatedCostUsd: string;
  readonly startedAt: Date;
  readonly errorClass: string | null;
};
export type ResearchModelCallLogSink = (entry: ResearchModelCallLogEntry) => Promise<void>;

export const permissiveResearchModelBudgetGate: ResearchModelBudgetGate = {
  check: async () => ({ allowed: true }),
};

// ── Fixture implementation — fixtures before live calls (`04-BUILD-LOOP.md` §2.3) ──────────────

export const DEFAULT_RESEARCH_LLM_FIXTURES_ROOT = join(process.cwd(), 'fixtures', 'llm');
export const DEFAULT_RESEARCH_FIXTURE_CASE = 'success';

type ResearchModelFixtureFile = {
  status: number;
  body: {
    modelId: string;
    tokensIn: number | null;
    tokensOut: number | null;
    costUsd: string | null;
    content: string;
  };
};

export class ResearchModelFixtureNotFoundError extends Error {
  constructor(
    public readonly task: string,
    public readonly fixtureCase: string,
    public readonly path: string,
  ) {
    super(
      `no LLM fixture recorded for ${task}/${fixtureCase} (looked in ${path}). Record one ` +
        'deliberately (fixtures/llm/README.md) — never invent one inline.',
    );
    this.name = 'ResearchModelFixtureNotFoundError';
  }
}

async function readResearchFixture(
  task: string,
  fixtureCase: string,
  root: string,
): Promise<ResearchModelFixtureFile> {
  const path = join(root, task, `${fixtureCase}.json`);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    throw new ResearchModelFixtureNotFoundError(task, fixtureCase, path);
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as ResearchModelFixtureFile).status !== 'number' ||
    typeof (parsed as ResearchModelFixtureFile).body !== 'object'
  ) {
    throw new Error(`${path} is not a valid LLM fixture: expected { status: number, body }`);
  }
  return parsed as ResearchModelFixtureFile;
}

export type ResearchModelClientDeps = {
  readonly budgetGate: ResearchModelBudgetGate;
  readonly costSink: ResearchModelCostSink;
  readonly callLogSink: ResearchModelCallLogSink;
  readonly runId: string;
  readonly now: () => Date;
  readonly nextRequestId: () => string;
};

export const systemResearchModelClientDeps: Pick<ResearchModelClientDeps, 'now' | 'nextRequestId'> = {
  now: () => new Date(),
  nextRequestId: () => randomUUID(),
};

function emptyMeta(input: ResearchModelInput, route: string, requestId: string, at: Date): ResearchModelCallMeta {
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
 * Shared by both implementations below — budget-check, then dispatch, then parse-and-validate.
 * Never throws; a malformed response is a typed error, never coerced (F11 §4.5: prose withheld
 * on any doubt, never guessed at).
 */
async function dispatch<T>(
  input: ResearchModelInput,
  schema: z.ZodType<T>,
  route: string,
  deps: ResearchModelClientDeps,
  call: () => Promise<{ status: number; body: ResearchModelFixtureFile['body'] }>,
): Promise<ResearchModelResult<T>> {
  const requestId = deps.nextRequestId();
  const startedAt = deps.now();

  const budget = await deps.budgetGate.check({ task: input.task, estimatedCostUsd: null });
  if (!budget.allowed) {
    const meta = emptyMeta(input, route, requestId, startedAt);
    await deps.callLogSink({
      task: input.task,
      runId: deps.runId,
      requestFingerprint: requestId,
      statusCode: null,
      latencyMs: 0,
      estimatedCostUsd: '0',
      startedAt,
      errorClass: 'budget_denied',
    });
    return { ok: false, error: { kind: 'budget_denied', scope: budget.scope, message: budget.message }, meta };
  }

  const response = await call();
  const latencyMs = deps.now().getTime() - startedAt.getTime();
  const meta: ResearchModelCallMeta = {
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
    runId: deps.runId,
    requestFingerprint: requestId,
    statusCode: response.status,
    latencyMs,
    estimatedCostUsd: response.body.costUsd ?? '0',
    startedAt,
    errorClass: response.status === 200 ? null : `http_${String(response.status)}`,
  });
  if (response.body.costUsd !== null) {
    await deps.costSink({
      task: input.task,
      runId: deps.runId,
      modelId: response.body.modelId,
      costUsd: response.body.costUsd,
      requestId,
      occurredAt: startedAt,
    });
  }

  if (response.status !== 200) {
    return { ok: false, error: { kind: 'upstream', status: response.status }, meta };
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

export function createFixtureResearchModelClient(
  deps: ResearchModelClientDeps,
  fixturesRoot: string = DEFAULT_RESEARCH_LLM_FIXTURES_ROOT,
): ResearchModelClient {
  return {
    run: async (input, schema) =>
      dispatch(input, schema, 'fixture', deps, async () => {
        const file = await readResearchFixture(input.task, input.fixtureCase ?? DEFAULT_RESEARCH_FIXTURE_CASE, fixturesRoot);
        return { status: file.status, body: file.body };
      }),
  };
}

/** `PROVIDER_MODE=live` — mirrors `services/llm/model-client.ts#createGatewayModelClient` exactly. */
export type ResearchGatewayConfig = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
};

const DEFAULT_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export function createGatewayResearchModelClient(
  config: ResearchGatewayConfig,
  deps: ResearchModelClientDeps,
): ResearchModelClient {
  const baseUrl = config.baseUrl ?? DEFAULT_GATEWAY_BASE_URL;
  return {
    run: async (input, schema) =>
      dispatch(input, schema, 'vercel_gateway', deps, async () => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
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

// ── D-34 vendor separation ───────────────────────────────────────────────────────────────────

/** `"openai/gpt-4o"` → `"openai"`. A model id with no `/` has no declared vendor at all. */
export function vendorOf(modelId: string): string | null {
  const slash = modelId.indexOf('/');
  if (slash <= 0) return null;
  return modelId.slice(0, slash);
}

export class SameVendorVerifierError extends Error {
  constructor(synthesisModelId: string, verifyModelId: string, vendor: string | null) {
    super(
      `D-34: the verifier must run on a different vendor from synthesis. AI_MODEL_SYNTHESIS ` +
        `('${synthesisModelId}') and AI_MODEL_VERIFY ('${verifyModelId}') resolve to the ` +
        `${vendor === null ? 'same (undeclared) vendor' : `same vendor ('${vendor}')`} — "a model ` +
        'checking itself is not a check", and two same-vendor models share training lineage and ' +
        'therefore share blind spots (MEMORY.md D-34). Point AI_MODEL_VERIFY at a model from a ' +
        'different vendor prefix (e.g. "openai/..." vs "anthropic/...").',
    );
    this.name = 'SameVendorVerifierError';
  }
}

/** Throws `SameVendorVerifierError` rather than returning a boolean — a real, load-bearing invariant, not advice. */
export function assertDifferentVendors(synthesisModelId: string, verifyModelId: string): void {
  const synthesisVendor = vendorOf(synthesisModelId);
  const verifyVendor = vendorOf(verifyModelId);
  const sameDeclaredVendor = synthesisVendor !== null && synthesisVendor === verifyVendor;
  const bothUndeclaredAndIdentical = synthesisVendor === null && verifyVendor === null && synthesisModelId === verifyModelId;
  if (sameDeclaredVendor || bothUndeclaredAndIdentical) {
    throw new SameVendorVerifierError(synthesisModelId, verifyModelId, synthesisVendor);
  }
}
