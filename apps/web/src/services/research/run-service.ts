/**
 * Top-level composition and persistence for a research run — F11 §4.1's "run persistence and
 * reload." The one place this feature reads `@/env` (matching `services/market/collector.ts` and
 * similar top-level composers' own convention of owning the one `@/env` import for their slice),
 * the one place a run's fine-grained state machine (`state-machine.ts`) is wired to real
 * Postgres-backed repositories and real (or fixture) model clients.
 *
 * **Persist-as-you-go, not persist-at-the-end.** Every `state-machine.ts` transition is written
 * to `research_event` the moment it happens (via `emit` below), before the function that produced
 * it returns — "a run survives reload because the events are the source of truth, not the
 * stream" (F11 §4.1) is only true if the events exist in the database while the run is still in
 * flight, not just once it finishes.
 *
 * **Why a research run executes synchronously inside the HTTP request that starts it, rather
 * than being dispatched to a background worker the way F16's job scheduler would run one.**
 * F16 (the scheduler/dispatcher) is not built in this codebase yet — there is no queue or worker
 * infrastructure a request could hand this off to. F11 §4.2's own 30 s hard wall-clock cap fits
 * inside a single serverless function invocation (`docs/DEPLOY.md` MT-09 is the Pro-tier upgrade
 * that gives this more headroom), so running the whole state machine inline, writing events as it
 * goes, is the honest interim shape — reload/replay from the event log is what makes the
 * `[runId]/stream` route's independent polling loop and any mid-run browser refresh both work
 * correctly regardless of how the run is actually executed. Reported as a RISK, not hidden: true
 * out-of-request execution needs F16.
 */
import { env } from '@/env';
import type { Queryable } from '@/repositories/client';
import { getPool } from '@/repositories/client';
import {
  insertResearchRun,
  appendResearchEvent,
  patchResearchRun,
  insertClaimLedgerEntries,
  findResearchRun,
  listResearchEvents,
  listClaimLedgerForRun,
  retractResearchRun as retractResearchRunRepo,
  type NewResearchRun,
} from '@/repositories/research';
import type { ResearchRun, ResearchEvent, ClaimLedgerEntry } from '@/contracts/research';
import { findSecurityById } from '@/repositories/security';
import type { Security } from '@/contracts/security';
import { D } from '@/calc/decimal';
import {
  createFixtureModelClient,
  createGatewayModelClient,
  systemModelClientDeps as systemClassifyDeps,
  permissiveBudgetGate as permissiveClassifyBudgetGate,
} from '@/services/llm/model-client';
import type { ModelClient } from '@/services/llm/ports';
import {
  createFixtureResearchModelClient,
  createGatewayResearchModelClient,
  systemResearchModelClientDeps,
  assertDifferentVendors,
  type ResearchModelClient,
} from './model-tasks';
import { realResearchModelBudgetGate, researchCostSinkOverCostEvent, noopResearchCallLog } from './model-deps';
import { realMetricsGatherer } from './metrics';
import {
  runResearchStateMachine,
  DEFAULT_STAGE_BUDGETS_MS,
  type RunOutcome,
  type StageBudgetsMs,
} from './state-machine';
import { SYNTHESIS_PROMPT_VERSION } from './prompts';

const SYNTHESIS_MAX_OUTPUT_TOKENS = 2_000;
const VERIFY_MAX_OUTPUT_TOKENS = 1_500;
const FOLLOWUP_MAX_OUTPUT_TOKENS = 400;

export type StartResearchRunInput = {
  readonly userId: string;
  readonly securityId: string;
  readonly question: string;
  readonly db?: Queryable;
  readonly clock?: () => Date;
  readonly budgets?: StageBudgetsMs;
  /** Test-only escape hatch — a caller can inject an already-built model client to avoid a live network call in a unit test. Never set from a route handler. */
  readonly overrideClients?: {
    readonly classify: ModelClient;
    readonly synthesis: ResearchModelClient;
    readonly verify: ResearchModelClient;
  };
};

export type StartResearchRunResult = { readonly run: ResearchRun; readonly outcome: RunOutcome };

function buildLiveClassifyClient(): ModelClient {
  if (env.AI_GATEWAY_API_KEY === undefined) {
    throw new Error('AI_GATEWAY_API_KEY is required when PROVIDER_MODE=live and MODEL_TRANSPORT_DEFAULT=vercel_gateway');
  }
  if (env.AI_MODEL_FAST === undefined) {
    throw new Error('AI_MODEL_FAST is required when PROVIDER_MODE=live');
  }
  return createGatewayModelClient(
    { apiKey: env.AI_GATEWAY_API_KEY, modelId: env.AI_MODEL_FAST },
    { ...systemClassifyDeps, budgetGate: permissiveClassifyBudgetGate, costSink: async () => {}, callLogSink: async () => {} },
  );
}

function buildLiveResearchClients(runId: string, db: Queryable): { synthesis: ResearchModelClient; verify: ResearchModelClient } {
  if (env.AI_GATEWAY_API_KEY === undefined) {
    throw new Error('AI_GATEWAY_API_KEY is required when PROVIDER_MODE=live and MODEL_TRANSPORT_DEFAULT=vercel_gateway');
  }
  if (env.AI_MODEL_SYNTHESIS === undefined || env.AI_MODEL_VERIFY === undefined) {
    throw new Error('AI_MODEL_SYNTHESIS and AI_MODEL_VERIFY are both required when PROVIDER_MODE=live');
  }
  // D-34, enforced — not merely documented.
  assertDifferentVendors(env.AI_MODEL_SYNTHESIS, env.AI_MODEL_VERIFY);

  const deps = {
    ...systemResearchModelClientDeps,
    budgetGate: realResearchModelBudgetGate(db),
    costSink: researchCostSinkOverCostEvent(db),
    callLogSink: noopResearchCallLog,
    runId,
  };
  return {
    synthesis: createGatewayResearchModelClient({ apiKey: env.AI_GATEWAY_API_KEY, modelId: env.AI_MODEL_SYNTHESIS }, deps),
    verify: createGatewayResearchModelClient({ apiKey: env.AI_GATEWAY_API_KEY, modelId: env.AI_MODEL_VERIFY }, deps),
  };
}

function buildFixtureClients(runId: string, db: Queryable): { classify: ModelClient; synthesis: ResearchModelClient; verify: ResearchModelClient } {
  const classify = createFixtureModelClient({
    ...systemClassifyDeps,
    budgetGate: permissiveClassifyBudgetGate,
    costSink: async () => {},
    callLogSink: async () => {},
  });
  const researchDeps = {
    ...systemResearchModelClientDeps,
    budgetGate: realResearchModelBudgetGate(db),
    costSink: researchCostSinkOverCostEvent(db),
    callLogSink: noopResearchCallLog,
    runId,
  };
  return {
    classify,
    synthesis: createFixtureResearchModelClient(researchDeps),
    verify: createFixtureResearchModelClient(researchDeps),
  };
}

function outcomeToPersisted(outcome: RunOutcome): {
  readonly status: ResearchRun['status'];
  readonly result: unknown;
  readonly error: unknown;
} {
  switch (outcome.kind) {
    case 'complete':
      return {
        status: 'complete',
        result: { outcome: 'answered', prose: outcome.output, metrics: outcome.metrics, followups: outcome.followups },
        error: null,
      };
    case 'abstained':
      return {
        status: 'complete',
        result: { outcome: 'abstained', prose: null, reason: outcome.reason, metrics: outcome.metrics, followups: outcome.followups },
        error: null,
      };
    case 'degraded':
      return {
        status: 'degraded',
        result: { outcome: 'degraded', prose: null, reason: outcome.reason, metrics: outcome.metrics, followups: outcome.followups },
        error: null,
      };
    case 'verification_failed':
      return {
        status: 'verification_failed',
        result: { outcome: 'verification_failed', prose: null, reason: outcome.reason, metrics: outcome.metrics, followups: outcome.followups },
        error: null,
      };
    case 'failed':
      return { status: 'failed', result: null, error: { reason: outcome.reason } };
  }
}

export async function startResearchRun(input: StartResearchRunInput): Promise<StartResearchRunResult> {
  const db = input.db ?? getPool();
  const clock = input.clock ?? (() => new Date());
  const budgets = input.budgets ?? DEFAULT_STAGE_BUDGETS_MS;

  const security = await findSecurityById(input.securityId, db);
  if (security === null) {
    throw new Error(`security ${input.securityId} not found`);
  }

  const newRun: NewResearchRun = {
    userId: input.userId,
    securityId: input.securityId,
    question: input.question,
    coverageStatus: 'unknown',
    inputCutoff: clock(),
    promptVersion: SYNTHESIS_PROMPT_VERSION,
    modelRoute: { transport: env.MODEL_TRANSPORT_DEFAULT },
    toolManifest: { classify: true, synthesis: true, verify: true },
  };
  const run = await insertResearchRun(newRun, db);

  let sequence = 0;
  const emit = async (event: { readonly eventType: string; readonly label: string; readonly payload: unknown }): Promise<void> => {
    sequence += 1;
    await appendResearchEvent({ runId: run.id, sequence, eventType: event.eventType, label: event.label, payload: event.payload }, db);
  };
  await emit({ eventType: 'state', label: 'queued', payload: {} });
  await patchResearchRun(run.id, { status: 'running' }, db);

  const clients =
    input.overrideClients ??
    (env.PROVIDER_MODE === 'live'
      ? { classify: buildLiveClassifyClient(), ...buildLiveResearchClients(run.id, db) }
      : buildFixtureClients(run.id, db));

  const securityForMatching: Pick<Security, 'symbol' | 'name' | 'aliases'> = {
    symbol: security.symbol,
    name: security.name,
    aliases: security.aliases,
  };

  const outcome = await runResearchStateMachine({
    runId: run.id,
    question: input.question,
    securityId: input.securityId,
    security: securityForMatching,
    db,
    classifyModelClient: clients.classify,
    synthesisModelClient: clients.synthesis,
    verifyModelClient: clients.verify,
    metricsGatherer: realMetricsGatherer,
    emit,
    clock,
    budgets,
    synthesisMaxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
    verifyMaxOutputTokens: VERIFY_MAX_OUTPUT_TOKENS,
    followupMaxOutputTokens: FOLLOWUP_MAX_OUTPUT_TOKENS,
    // The state machine itself only spends this call once it already knows the run is
    // `complete` (see `state-machine.ts`'s own gate on `deps.generateFollowupRewrite`) — passing
    // `true` here says "allowed to", not "will".
    generateFollowupRewrite: true,
  });

  if (outcome.kind === 'complete' || outcome.kind === 'verification_failed') {
    await insertClaimLedgerEntries(outcome.claims, db);
  }

  const persisted = outcomeToPersisted(outcome);
  const spend = await totalSpendForRun(run.id, db);
  const finalRun = await patchResearchRun(
    run.id,
    { status: persisted.status, completedAt: clock(), result: persisted.result, error: persisted.error, costUsd: spend },
    db,
  );

  return { run: finalRun, outcome };
}

async function totalSpendForRun(runId: string, db: Queryable): Promise<string> {
  const { rows } = await db.query<{ total: string | null }>(
    `select coalesce(sum(cost_usd), 0)::text as total from cost_event where research_run_id = $1`,
    [runId],
  );
  const total = rows[0]?.total ?? '0';
  return new D(total).toFixed(6);
}

// ── Reload (F11 §4.1: "a run survives reload because the events are the source of truth") ──────

export type ReloadedRun = {
  readonly run: ResearchRun;
  readonly events: readonly ResearchEvent[];
  readonly claims: readonly ClaimLedgerEntry[];
};

export async function reloadResearchRun(runId: string, db: Queryable = getPool()): Promise<ReloadedRun | null> {
  const run = await findResearchRun(runId, db);
  if (run === null) return null;
  const [events, claims] = await Promise.all([listResearchEvents(runId, db), listClaimLedgerForRun(runId, db)]);
  return { run, events, claims };
}

// ── Retraction (F-20) ─────────────────────────────────────────────────────────────────────────

export type RetractResearchRunInput = { readonly runId: string; readonly reason: string; readonly actorId: string };

/** Thin wrapper naming the F-20 step this is — "record" — the repository does identify/retract/record atomically; "notify" is every future read (`reloadResearchRun`) surfacing the retracted status. */
export async function retractResearchRun(input: RetractResearchRunInput): Promise<ResearchRun> {
  return retractResearchRunRepo({ id: input.runId, reason: input.reason, actorId: input.actorId });
}
