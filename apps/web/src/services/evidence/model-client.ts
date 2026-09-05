/**
 * The `ModelClient`-shaped backend F10's two LLM methods call through — `relevance.filter` and
 * `entity.collision_guard` (D-21). See this module's `CONTRACTS`-flagged gap, spelled out below,
 * before extending it.
 *
 * ## Why this lives here and not in `src/contracts/`
 *
 * `02-ARCHITECTURE-CONTRACTS.md` §4.6 names `ModelClient` as a **core shared contract**, but no
 * implementation of it exists anywhere in this repository (checked: no `ModelClient` usage, no
 * `ai`/`@ai-sdk/*` dependency, nothing under `src/contracts/` or `src/adapters/`) — this lane is
 * the first to actually need one. §4.6's literal interface (`classify(task: 'stance', ...)`,
 * `synthesize`, `verify`) also predates D-21: stance moved to F20's pinned scorer and is never
 * a `ModelClient` call at all (D-13), and the interface names no task for `relevance` or
 * `entity_collision_guard`. Extending or importing that stale type would be worse than not using
 * it — it would misrepresent an interface this feature does not actually implement.
 *
 * So, mirroring how `adapters/scorer.ts` handled the same situation for `ScoreResult`/
 * `ScorerIdentity` (owned by a contract file that does not exist yet): this module builds the
 * narrow, behavioural slice F10 actually needs — strict zod schema per call, temperature 0,
 * bounded output, retry-once-then-drop on a schema-invalid response, and a recorded
 * model/route/prompt-version/cost per call (F10 §4.4, §6) — without claiming to be the shared
 * `ModelClient`. **Reported under this lane's `CONTRACTS` line**: SPINE should reconcile
 * `02-ARCHITECTURE-CONTRACTS.md` §4.6's interface (retire `'stance'`, add the two D-21 tasks) and
 * decide whether this file's `ModelBackend`/`classifyBatch` becomes the canonical
 * `src/contracts/model-client.ts` implementation F11/F12 also build against.
 *
 * ## Fixture-first, live-path unverified
 *
 * `PROVIDER_MODE=fixture` is the only mode exercised by this feature's own test suite —
 * `04-BUILD-LOOP.md` §2.3, "fixtures before live calls". `GatewayModelBackend` below is a real
 * implementation of the live path (Vercel AI Gateway's OpenAI-compatible chat-completions
 * endpoint, per D-34/D-39), but it has not been exercised against a live endpoint in this build
 * session — there is no `AI_GATEWAY_API_KEY` in this sandbox, and burning a live call to test it
 * would be exactly the quota spend `04-BUILD-LOOP.md` §2.3 warns against. Flagged under this
 * lane's `RISKS`: a manual smoke test against a real key is owed before this path is relied on.
 */
import { z } from 'zod';

// ── The backend boundary ──────────────────────────────────────────────────────────────────────

export type ModelUsage = {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  /** Decimal string or `null` (UNPRICED) — never `'0'` for an unknown price (§4.1). */
  readonly costUsd: string | null;
};

export type ModelGenerateRequest = {
  readonly system: string;
  readonly user: string;
  readonly model: string;
  /** Always `0` for these two methods (F10 §4.4's retained discipline). */
  readonly temperature: 0;
  readonly maxOutputTokens: number;
};

export type ModelGenerateResult = {
  /** Whatever the backend returned, parsed as JSON if it looked like JSON — validated by the caller. */
  readonly raw: unknown;
  readonly usage: ModelUsage;
};

/**
 * Thrown for an outage — the backend could not be reached, timed out, or otherwise did not
 * produce a response at all. Never thrown for a response that merely failed its schema; that is
 * a `ModelGenerateResult` whose `raw` does not validate, handled by `classifyBatch` below.
 */
export class ModelBackendUnavailable extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ModelBackendUnavailable';
  }
}

export interface ModelBackend {
  generate(request: ModelGenerateRequest): Promise<ModelGenerateResult>;
}

// ── Fixture backend — what every test in this lane actually exercises ────────────────────────

export type FixtureModelStep =
  | { readonly kind: 'json'; readonly body: unknown; readonly usage?: Partial<ModelUsage> }
  /** The backend "succeeded" but returned something that is not the JSON array the caller expects. */
  | { readonly kind: 'invalid_json' }
  | { readonly kind: 'throw'; readonly message?: string };

export type FixtureModelScript = readonly FixtureModelStep[];

/**
 * A deterministic, in-memory backend driven by a scripted sequence of responses — one entry per
 * call, in order (attempt 1, then attempt 2 if a retry happens). The last entry repeats if the
 * script is exhausted, so a single-entry script can stand in for "always answers this way".
 */
export class FixtureModelBackend implements ModelBackend {
  private cursor = 0;

  constructor(private readonly script: FixtureModelScript) {
    if (script.length === 0) {
      throw new Error('FixtureModelBackend: refusing an empty script — nothing to answer with');
    }
  }

  generate(_request: ModelGenerateRequest): Promise<ModelGenerateResult> {
    const index = Math.min(this.cursor, this.script.length - 1);
    const step = this.script[index] as FixtureModelStep;
    this.cursor += 1;

    if (step.kind === 'throw') {
      throw new ModelBackendUnavailable(step.message ?? 'fixture backend unavailable');
    }
    if (step.kind === 'invalid_json') {
      return Promise.resolve({
        raw: 'not a JSON array — a malformed or truncated model response',
        usage: { promptTokens: null, completionTokens: null, costUsd: null },
      });
    }
    return Promise.resolve({
      raw: step.body,
      usage: {
        promptTokens: step.usage?.promptTokens ?? null,
        completionTokens: step.usage?.completionTokens ?? null,
        costUsd: step.usage?.costUsd ?? null,
      },
    });
  }
}

// ── Live backend — Vercel AI Gateway, OpenAI-compatible chat completions (D-34/D-39) ──────────

export type GatewayModelBackendOptions = {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
};

const DEFAULT_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
const DEFAULT_GATEWAY_TIMEOUT_MS = 20_000;

/**
 * **Unverified against a live endpoint — see the module docstring.** Built to the documented
 * OpenAI-compatible shape (`POST /v1/chat/completions`, `Authorization: Bearer <key>`,
 * `response_format: { type: 'json_object' }` for broad model compatibility since not every
 * routed model supports a full JSON-schema response format).
 */
export class GatewayModelBackend implements ModelBackend {
  constructor(private readonly options: GatewayModelBackendOptions) {}

  async generate(request: ModelGenerateRequest): Promise<ModelGenerateResult> {
    const baseUrl = (this.options.baseUrl ?? DEFAULT_GATEWAY_BASE_URL).replace(/\/$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_GATEWAY_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ModelBackendUnavailable('Vercel AI Gateway request failed', error);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ModelBackendUnavailable(`Vercel AI Gateway responded ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ModelBackendUnavailable('Vercel AI Gateway response had no message content');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      // Not a `ModelBackendUnavailable` — the backend answered, it just didn't answer with
      // parseable JSON. `classifyBatch` treats this exactly like `invalid_json` above.
      raw = content;
    }

    return {
      raw,
      usage: {
        promptTokens: body.usage?.prompt_tokens ?? null,
        completionTokens: body.usage?.completion_tokens ?? null,
        // Vercel AI Gateway does not return a priced cost in the completion body itself; F10
        // records `null` (UNPRICED) rather than inventing a price from a rate card this feature
        // does not own. F18's budget/pricing work is the eventual source of a real figure here.
        costUsd: null,
      },
    };
  }
}

export function createModelBackend(
  providerMode: 'fixture' | 'live',
  options: { readonly script?: FixtureModelScript } & Partial<GatewayModelBackendOptions>,
): ModelBackend {
  if (providerMode === 'fixture') {
    return new FixtureModelBackend(options.script ?? [{ kind: 'json', body: [] }]);
  }
  if (options.apiKey === undefined || options.apiKey === '') {
    throw new Error('createModelBackend: apiKey is required when providerMode is "live"');
  }
  return new GatewayModelBackend({
    apiKey: options.apiKey,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

// ── The retry-once-then-drop batch harness ────────────────────────────────────────────────────

/**
 * The pre-dispatch budget gate — `02-ARCHITECTURE-CONTRACTS.md` §4.6: "subject to the
 * pre-dispatch budget check." Required (not optional) on `ClassifyBatchOptions` deliberately
 * (lane-review finding 4): a caller that forgets to wire the real check must fail to compile,
 * not silently get an unbudgeted LLM path.
 */
export type BudgetGate = { readonly allowed: boolean; readonly message?: string };

/** One HTTP attempt's provenance — recorded regardless of whether it was ultimately admitted. */
export type ModelCallAttemptRecord = {
  readonly methodId: string;
  readonly methodVersion: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly temperature: 0;
  readonly attempt: 1 | 2;
  readonly requestedAt: string;
  readonly usage: ModelUsage;
  readonly outcome: 'admitted_some' | 'schema_invalid' | 'backend_unavailable' | 'budget_denied';
};

export type ClassifyBatchOutcome<TRow> = {
  /** itemId → the validated row for it. */
  readonly admitted: ReadonlyMap<string, TRow>;
  /** itemId → why it was not admitted. */
  readonly rejected: ReadonlyMap<string, string>;
  readonly records: readonly ModelCallAttemptRecord[];
};

const batchEnvelopeSchema = z.array(z.unknown());

export type ClassifyBatchOptions<TRow> = {
  readonly methodId: string;
  readonly methodVersion: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly backend: ModelBackend;
  /**
   * Checked before **every** dispatch, including the repair retry (lane-review finding 4: a
   * schema-invalid response used to trigger a second, billable call with no budget check between
   * the decision and the dispatch). Required, not optional — see `BudgetGate`'s docstring.
   */
  readonly checkBudget: () => Promise<BudgetGate>;
  /** `repair` is `true` on the one retry, after a whole-response schema failure. */
  readonly buildPrompt: (repair: boolean) => { readonly system: string; readonly user: string };
  readonly rowSchema: z.ZodType<TRow>;
  readonly rowKey: (row: TRow) => string;
  readonly requestedIds: readonly string[];
  readonly maxOutputTokens?: number;
  readonly now?: () => Date;
};

/**
 * Runs one batched, structured-output classification call with F10 §4.4's retained discipline:
 * a schema-invalid *response* (the whole thing isn't the JSON array expected) is retried once
 * with a repair instruction, then every requested item is dropped rather than coerced. A
 * *row* that is individually malformed within an otherwise-valid array is rejected on its own —
 * mirroring `adapters/scorer.ts`'s `admitPerItem` (a lane-review finding there: retrying or
 * failing the whole batch over one bad row would punish every well-formed neighbour for it).
 *
 * Never throws for an expected condition — an empty `requestedIds` is a caller bug (nothing to
 * classify) and throws, same as `postScoreBatch`'s empty-batch guard.
 */
export async function classifyBatch<TRow>(
  options: ClassifyBatchOptions<TRow>,
): Promise<ClassifyBatchOutcome<TRow>> {
  if (options.requestedIds.length === 0) {
    throw new Error('classifyBatch: refusing to call the model with no requested items');
  }

  const now = options.now ?? (() => new Date());
  const records: ModelCallAttemptRecord[] = [];

  const attemptOnce = async (
    attempt: 1 | 2,
  ): Promise<
    { outcome: 'admitted' | 'schema_invalid'; rows: readonly unknown[] } | 'unavailable' | { outcome: 'budget_denied'; message: string }
  > => {
    const gate = await options.checkBudget();
    if (!gate.allowed) {
      records.push(
        attemptRecord(options, attempt, now(), { promptTokens: null, completionTokens: null, costUsd: null }, 'budget_denied'),
      );
      return { outcome: 'budget_denied', message: gate.message ?? 'global ceiling reached' };
    }

    let result: ModelGenerateResult;
    try {
      const prompt = options.buildPrompt(attempt === 2);
      result = await options.backend.generate({
        system: prompt.system,
        user: prompt.user,
        model: options.model,
        temperature: 0,
        maxOutputTokens: options.maxOutputTokens ?? 1024,
      });
    } catch (error) {
      if (error instanceof ModelBackendUnavailable) {
        records.push(
          attemptRecord(options, attempt, now(), { promptTokens: null, completionTokens: null, costUsd: null }, 'backend_unavailable'),
        );
        return 'unavailable';
      }
      throw error;
    }

    const parsed = batchEnvelopeSchema.safeParse(result.raw);
    if (!parsed.success) {
      records.push(attemptRecord(options, attempt, now(), result.usage, 'schema_invalid'));
      return { outcome: 'schema_invalid', rows: [] };
    }
    records.push(attemptRecord(options, attempt, now(), result.usage, 'admitted_some'));
    return { outcome: 'admitted', rows: parsed.data };
  };

  let rows: readonly unknown[] | null = null;

  const first = await attemptOnce(1);
  if (first === 'unavailable') {
    return allRejected(options.requestedIds, 'the model backend was unavailable', records);
  }
  if (first.outcome === 'budget_denied') {
    return allRejected(options.requestedIds, `budget denied before dispatch: ${first.message}`, records);
  }
  if (first.outcome === 'admitted') {
    rows = first.rows;
  } else {
    const second = await attemptOnce(2);
    if (second === 'unavailable') {
      return allRejected(options.requestedIds, 'the model backend was unavailable on retry', records);
    }
    if (second.outcome === 'budget_denied') {
      return allRejected(
        options.requestedIds,
        `budget denied before the repair-retry dispatch: ${second.message}`,
        records,
      );
    }
    if (second.outcome === 'schema_invalid') {
      return allRejected(
        options.requestedIds,
        'the model response was not a valid JSON array, even after one repair retry',
        records,
      );
    }
    rows = second.rows;
  }

  return { ...admitPerItem(options.requestedIds, rows, options.rowSchema, options.rowKey), records };
}

function attemptRecord<TRow>(
  options: ClassifyBatchOptions<TRow>,
  attempt: 1 | 2,
  requestedAt: Date,
  usage: ModelUsage,
  outcome: ModelCallAttemptRecord['outcome'],
): ModelCallAttemptRecord {
  return {
    methodId: options.methodId,
    methodVersion: options.methodVersion,
    promptVersion: options.promptVersion,
    model: options.model,
    temperature: 0,
    attempt,
    requestedAt: requestedAt.toISOString(),
    usage,
    outcome,
  };
}

function allRejected<TRow>(
  requestedIds: readonly string[],
  reason: string,
  records: readonly ModelCallAttemptRecord[],
): ClassifyBatchOutcome<TRow> {
  const rejected = new Map<string, string>();
  for (const id of requestedIds) rejected.set(id, reason);
  return { admitted: new Map(), rejected, records };
}

/** Per-item admission, mirroring `adapters/scorer.ts`'s `admitPerItem` shape and reasoning. */
function admitPerItem<TRow>(
  requestedIds: readonly string[],
  rows: readonly unknown[],
  rowSchema: z.ZodType<TRow>,
  rowKey: (row: TRow) => string,
): { admitted: Map<string, TRow>; rejected: Map<string, string> } {
  const admitted = new Map<string, TRow>();
  const rejected = new Map<string, string>();
  const requestedSet = new Set(requestedIds);
  const byId = new Map<string, unknown[]>();

  for (const row of rows) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      // We cannot know which requested item an unparseable row was meant to answer for; it is
      // simply not admitted for anyone. A row that does parse but names an id nobody asked about
      // is handled below via `requestedSet`.
      continue;
    }
    const id = rowKey(parsed.data);
    if (!requestedSet.has(id)) continue;
    const existing = byId.get(id);
    if (existing === undefined) byId.set(id, [row]);
    else existing.push(row);
  }

  for (const id of requestedIds) {
    const matches = byId.get(id) ?? [];
    if (matches.length === 0) {
      rejected.set(id, 'the model returned no admissible result for this item');
      continue;
    }
    if (matches.length > 1) {
      rejected.set(id, `the model returned ${matches.length} results for this item; none was admitted`);
      continue;
    }
    const parsed = rowSchema.safeParse(matches[0]);
    if (!parsed.success) {
      rejected.set(id, 'the model result for this item failed its schema');
      continue;
    }
    admitted.set(id, parsed.data);
  }

  return { admitted, rejected };
}
