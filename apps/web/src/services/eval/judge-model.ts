/**
 * `EvalModelClient` — the LLM boundary for F12's one model call: the judge.
 *
 * **Structurally the same move F11's `ResearchModelClient` already made once** (that module's own
 * docstring: "the same move F10 already made once, one layer up"). F12 needs a model boundary on
 * its own task route (F12 §4.3: "a different model from the synthesiser, on its own task route"),
 * and neither `services/llm/ports.ts#ModelClient` (F10, closed to `'relevance'|'entity_collision'`)
 * nor `services/research/model-tasks.ts#ResearchModelClient` (F11, closed to
 * `'synthesis'|'followup'|'verify'`) can be widened without editing a merged file this feature is
 * out of bounds to touch. Same dispatch discipline as both: budget-check-before-call (permissive
 * by default — the judge is off the synthesis critical path and F12 does not yet have its own
 * budget policy; wiring one is a follow-on, not invented here), temperature 0, strict-schema
 * validate, drop to a typed error rather than coerce, own fixture root.
 *
 * **Contract request, reported in this feature's build report** (same shape as F11's own,
 * `model-tasks.ts` lines 20-23): `services/llm/ports.ts`'s `ModelTask` / `services/research/
 * model-tasks.ts`'s `ResearchModelTask` should eventually converge into one model-boundary module
 * with `'relevance' | 'entity_collision' | 'synthesis' | 'followup' | 'verify' | 'judge'`, so
 * three near-identical clients do not have to be kept in lockstep by hand. Not done here — each of
 * the three is owned by a different, already-merged feature.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';

export const EVAL_MODEL_TASKS = ['judge'] as const;
export type EvalModelTask = (typeof EVAL_MODEL_TASKS)[number];

export type EvalModelInput = {
  readonly task: EvalModelTask;
  readonly promptVersion: string;
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  readonly fixtureCase?: string;
};

export type EvalModelCallMeta = {
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

export type EvalModelError =
  | { readonly kind: 'schema_invalid'; readonly issues: readonly string[]; readonly raw: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'upstream'; readonly status: number }
  | { readonly kind: 'budget_denied'; readonly message: string };

export type EvalModelResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: EvalModelCallMeta }
  | { readonly ok: false; readonly error: EvalModelError; readonly meta: EvalModelCallMeta };

export type EvalModelClient = {
  run<T>(input: EvalModelInput, schema: z.ZodType<T>): Promise<EvalModelResult<T>>;
};

export type EvalModelBudgetGate = {
  check(input: { estimatedCostUsd: string | null }): Promise<{ allowed: true } | { allowed: false; message: string }>;
};

export const permissiveEvalModelBudgetGate: EvalModelBudgetGate = {
  check: async () => ({ allowed: true }),
};

export type EvalModelCostEntry = {
  readonly evalRunId: string;
  readonly modelId: string;
  readonly costUsd: string | null;
  readonly requestId: string;
  readonly occurredAt: Date;
};
export type EvalModelCostSink = (entry: EvalModelCostEntry) => Promise<void>;

/** Discards every entry — the default for a fixture-mode or ad hoc run with no cost ledger wired up. */
export const noopEvalModelCostSink: EvalModelCostSink = async () => {};

export const DEFAULT_EVAL_LLM_FIXTURES_ROOT = join(process.cwd(), 'fixtures', 'llm');
export const DEFAULT_EVAL_FIXTURE_CASE = 'success';

type EvalModelFixtureFile = {
  status: number;
  body: {
    modelId: string;
    tokensIn: number | null;
    tokensOut: number | null;
    costUsd: string | null;
    content: string;
  };
};

export class EvalModelFixtureNotFoundError extends Error {
  constructor(
    public readonly task: string,
    public readonly fixtureCase: string,
    public readonly path: string,
  ) {
    super(
      `no LLM fixture recorded for ${task}/${fixtureCase} (looked in ${path}). Record one ` +
        'deliberately (fixtures/llm/README.md) — never invent one inline.',
    );
    this.name = 'EvalModelFixtureNotFoundError';
  }
}

async function readEvalFixture(task: string, fixtureCase: string, root: string): Promise<EvalModelFixtureFile> {
  const path = join(root, task, `${fixtureCase}.json`);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    throw new EvalModelFixtureNotFoundError(task, fixtureCase, path);
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as EvalModelFixtureFile).status !== 'number' ||
    typeof (parsed as EvalModelFixtureFile).body !== 'object'
  ) {
    throw new Error(`${path} is not a valid LLM fixture: expected { status: number, body }`);
  }
  return parsed as EvalModelFixtureFile;
}

export type EvalModelClientDeps = {
  readonly budgetGate: EvalModelBudgetGate;
  readonly costSink: EvalModelCostSink;
  readonly evalRunId: string;
  readonly now: () => Date;
  readonly nextRequestId: () => string;
};

export const systemEvalModelClientDeps: Pick<EvalModelClientDeps, 'now' | 'nextRequestId'> = {
  now: () => new Date(),
  nextRequestId: () => randomUUID(),
};

function emptyMeta(input: EvalModelInput, route: string, requestId: string, at: Date): EvalModelCallMeta {
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

async function dispatch<T>(
  input: EvalModelInput,
  schema: z.ZodType<T>,
  route: string,
  deps: EvalModelClientDeps,
  call: () => Promise<{ status: number; body: EvalModelFixtureFile['body'] }>,
): Promise<EvalModelResult<T>> {
  const requestId = deps.nextRequestId();
  const startedAt = deps.now();

  const budget = await deps.budgetGate.check({ estimatedCostUsd: null });
  if (!budget.allowed) {
    return { ok: false, error: { kind: 'budget_denied', message: budget.message }, meta: emptyMeta(input, route, requestId, startedAt) };
  }

  const response = await call();
  const latencyMs = deps.now().getTime() - startedAt.getTime();
  const meta: EvalModelCallMeta = {
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

  if (response.body.costUsd !== null) {
    await deps.costSink({
      evalRunId: deps.evalRunId,
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

export function createFixtureEvalModelClient(
  deps: EvalModelClientDeps,
  fixturesRoot: string = DEFAULT_EVAL_LLM_FIXTURES_ROOT,
): EvalModelClient {
  return {
    run: async (input, schema) =>
      dispatch(input, schema, 'fixture', deps, async () => {
        const file = await readEvalFixture(input.task, input.fixtureCase ?? DEFAULT_EVAL_FIXTURE_CASE, fixturesRoot);
        return { status: file.status, body: file.body };
      }),
  };
}

/** `PROVIDER_MODE=live` — mirrors `services/research/model-tasks.ts#createGatewayResearchModelClient` exactly. */
export type EvalGatewayConfig = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
};

const DEFAULT_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export function createGatewayEvalModelClient(config: EvalGatewayConfig, deps: EvalModelClientDeps): EvalModelClient {
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

// ── D-34-style vendor separation: the judge must differ from the synthesiser ────────────────────

/** Reused rather than re-derived: `vendorOf` is a pure string function with no research/-specific
 * behaviour — importing it is not touching research/'s prohibited territory (a read-only import
 * of a pure helper, same as importing a type). */
export { vendorOf } from '@/services/research/model-tasks';

export class SameModelJudgeError extends Error {
  constructor(synthesisModelId: string, judgeModelId: string) {
    super(
      `F12 §4.3: the judge must be "a different model from the synthesiser". AI_MODEL_SYNTHESIS ` +
        `('${synthesisModelId}') and AI_MODEL_JUDGE ('${judgeModelId}') are the same model id — ` +
        'point AI_MODEL_JUDGE at a distinct model.',
    );
    this.name = 'SameModelJudgeError';
  }
}

/** Narrower than D-34's `assertDifferentVendors` (same vendor is fine for the judge — only
 * literal self-grading is forbidden) — F12 §4.3 says "a different model", not "a different
 * vendor"; conflating the two would be a stricter rule than the spec actually states. */
export function assertJudgeDiffersFromSynthesis(synthesisModelId: string, judgeModelId: string): void {
  if (synthesisModelId === judgeModelId) {
    throw new SameModelJudgeError(synthesisModelId, judgeModelId);
  }
}
