/**
 * The research run state machine — F11 §4.1, §4.2. Pure orchestration: every I/O boundary (DB
 * reads, LLM calls) is an injected dependency, so this module is unit-testable without a live
 * Postgres or a real model — matching this codebase's own "fixtures before live calls" and
 * dependency-injection conventions throughout `services/`.
 *
 * **State diagram (F11 §4.1):**
 * ```
 * queued → gathering → analyzing → synthesizing → verifying → complete
 *                                               ↘ verification_failed
 *               ↘ abstained (insufficient evidence)
 *               ↘ degraded (deterministic metrics only; prose timed out or withheld)
 *               ↘ failed
 * ```
 * `retracted` (operator action, F-20) is not reachable from inside this state machine at all —
 * it only ever applies to an already-`complete`/`degraded` run, after this function has returned
 * (`repositories/research.ts#retractResearchRun`).
 *
 * **Every transition calls `emit`**, which the caller (`run-service.ts`) wires to
 * `appendResearchEvent` — "runs are append-only; every transition writes a `research_event`. A
 * run survives reload because the events are the source of truth, not the stream" (F11 §4.1).
 * This module holds no state across calls; a reload replays the same event log this function
 * itself produced, it does not re-run this function.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '@/repositories/client';
import type { EvidenceForSecurityResult } from '@/repositories/evidence';
import type { Security } from '@/contracts/security';
import type { ModelClient } from '@/services/llm/ports';
import { buildAxisDisclosures, type EvidencePack } from '@/services/evidence';
import { fetchRawEvidence, classifyEvidence } from './evidence-gather';
import type { MetricsGatherer, MetricFact } from './metrics';
import type { ResearchModelClient } from './model-tasks';
import { synthesisOutput, type SynthesisOutput } from './schema';
import { synthesisSystemPrompt, SYNTHESIS_PROMPT_VERSION } from './prompts';
import { runDeterministicChecks, type VerifyContext } from './deterministic-checks';
import { resolveVerification, runModelVerification, type ModelVerificationResult, type VerificationOutcome } from './verify';
import { templateFollowups, rewriteFollowups, type FollowupQuestion } from './followups';
import type { NewClaimLedgerEntry } from '@/repositories/research';

// ── Staged latency budget (F11 §4.2) — overridable so tests exercise every overrun path fast ────

export type StageBudgetsMs = {
  readonly fanOut: number;
  readonly deterministicAnalysis: number;
  readonly classification: number;
  readonly synthesis: number;
  readonly verification: number;
  readonly totalWallClock: number;
};

export const DEFAULT_STAGE_BUDGETS_MS: StageBudgetsMs = {
  fanOut: 8_000,
  deterministicAnalysis: 1_000,
  classification: 6_000,
  synthesis: 10_000,
  verification: 4_000,
  totalWallClock: 30_000,
};

export type RunEvent = { readonly eventType: string; readonly label: string; readonly payload: unknown };
export type EmitFn = (event: RunEvent) => Promise<void>;

export type StateMachineDeps = {
  readonly runId: string;
  readonly question: string;
  readonly securityId: string;
  readonly security: Pick<Security, 'symbol' | 'name' | 'aliases'>;
  readonly db?: Queryable;
  /** F10's relevance/collision client — used only inside the classification stage. */
  readonly classifyModelClient: ModelClient;
  readonly synthesisModelClient: ResearchModelClient;
  /** D-34: must resolve to a different vendor than `synthesisModelClient` — asserted by the caller before this runs. */
  readonly verifyModelClient: ResearchModelClient;
  readonly metricsGatherer: MetricsGatherer;
  readonly emit: EmitFn;
  readonly clock: () => Date;
  readonly budgets: StageBudgetsMs;
  readonly synthesisMaxOutputTokens: number;
  readonly verifyMaxOutputTokens: number;
  readonly followupMaxOutputTokens: number;
  readonly generateFollowupRewrite: boolean;
};

export type RunOutcome =
  | {
      readonly kind: 'complete';
      readonly output: SynthesisOutput;
      readonly claims: readonly NewClaimLedgerEntry[];
      readonly metrics: readonly MetricFact[];
      readonly followups: readonly FollowupQuestion[];
    }
  | { readonly kind: 'abstained'; readonly reason: string; readonly metrics: readonly MetricFact[]; readonly followups: readonly FollowupQuestion[] }
  | { readonly kind: 'degraded'; readonly reason: string; readonly metrics: readonly MetricFact[]; readonly followups: readonly FollowupQuestion[] }
  | {
      readonly kind: 'verification_failed';
      readonly reason: string;
      readonly claims: readonly NewClaimLedgerEntry[];
      readonly metrics: readonly MetricFact[];
      readonly followups: readonly FollowupQuestion[];
    }
  | { readonly kind: 'failed'; readonly reason: string };

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), ms);
    }),
  ]);
}

function emptyEvidencePack(securityId: string, asOf: Date, note: string): EvidencePack {
  const zero = { retrieved: 0, used: 0, exclusions: [] };
  const disclosures = buildAxisDisclosures({
    counts: { reddit: zero, x: zero, substack: zero },
    windowFrom: null,
    windowTo: asOf.toISOString(),
    reddit: { subredditsPolled: [], treeComplete: null },
    x: { watchlistVersion: null, triggerEvent: null },
  });
  return {
    securityId,
    asOf: asOf.toISOString(),
    retrievalWindow: { from: null, to: asOf.toISOString() },
    retrievalQuery: `security=${securityId} note=${note}`,
    items: [],
    excluded: [],
    retrievedCount: 0,
    usedCount: 0,
    truncatedByScanWindow: false,
    disclosures,
  };
}

function buildSynthesisPrompt(input: {
  readonly question: string;
  readonly subjectSymbol: string;
  readonly subjectName: string;
  readonly pack: EvidencePack;
  readonly metrics: readonly MetricFact[];
}): string {
  return JSON.stringify({
    question: input.question,
    subject: { symbol: input.subjectSymbol, name: input.subjectName },
    metrics: input.metrics.map((metric) => ({
      metricId: metric.metricId,
      label: metric.label,
      display: metric.display,
      unit: metric.unit,
      n: metric.n,
      window: metric.window,
      observedAt: metric.observedAt?.toISOString() ?? null,
    })),
    evidence: input.pack.items.map((item) => ({
      evidenceId: item.stableId,
      axis: item.axis,
      title: item.item.title,
      snippet: item.item.snippet,
      publishedAt: item.item.publishedAt?.toISOString() ?? null,
      availableAt: item.item.availableAt.toISOString(),
      relevance: item.relevanceScore,
    })),
    disclosures: input.pack.disclosures,
  });
}

export async function runResearchStateMachine(deps: StateMachineDeps): Promise<RunOutcome> {
  const startedAt = deps.clock().getTime();
  const deadline = startedAt + deps.budgets.totalWallClock;
  const remaining = (): number => deadline - deps.clock().getTime();

  await deps.emit({ eventType: 'state', label: 'gathering', payload: {} });

  const dbArg = deps.db === undefined ? {} : { db: deps.db };

  // ── Typed parallel fetch: raw evidence (fan-out) and F06 metrics (deterministic analysis) ────
  const [evidenceOutcome, metricsOutcome] = await Promise.all([
    fetchRawEvidence({ securityId: deps.securityId, asOf: deps.clock(), fanOutBudgetMs: deps.budgets.fanOut, ...dbArg }),
    raceTimeout(
      deps.metricsGatherer({ symbol: deps.security.symbol, asOf: deps.clock(), ...dbArg }),
      deps.budgets.deterministicAnalysis,
    ),
  ]);

  // "Deterministic analysis | 1 s | hard failure — this is local computation" (F11 §4.2). Unlike
  // every other stage, an overrun here is not a degraded-and-continue path.
  if (metricsOutcome === 'timeout') {
    await deps.emit({
      eventType: 'error',
      label: 'deterministic_analysis_overrun',
      payload: { budgetMs: deps.budgets.deterministicAnalysis },
    });
    return { kind: 'failed', reason: `deterministic analysis exceeded its ${String(deps.budgets.deterministicAnalysis)}ms budget` };
  }
  const metrics = metricsOutcome;

  let rawEvidence: EvidenceForSecurityResult;
  if (evidenceOutcome.kind === 'timed_out') {
    await deps.emit({ eventType: 'gap', label: 'fan_out_overrun', payload: { budgetMs: deps.budgets.fanOut } });
    rawEvidence = { items: [], scannedCount: 0, distinctCount: 0, truncated: false };
  } else {
    rawEvidence = evidenceOutcome.result;
  }

  await deps.emit({
    eventType: 'state',
    label: 'analyzing',
    payload: { retrievedCount: rawEvidence.scannedCount, metricsGathered: metrics.length },
  });

  const classifyOutcome = await classifyEvidence({
    securityId: deps.securityId,
    asOf: deps.clock(),
    raw: rawEvidence,
    security: deps.security,
    modelClient: deps.classifyModelClient,
    classificationBudgetMs: deps.budgets.classification,
  });

  let pack: EvidencePack;
  if (classifyOutcome.kind === 'timed_out') {
    await deps.emit({
      eventType: 'gap',
      label: 'classification_overrun',
      payload: { budgetMs: deps.budgets.classification, retrievedCount: classifyOutcome.retrievedCount },
    });
    pack = emptyEvidencePack(deps.securityId, deps.clock(), 'classification_timed_out');
  } else {
    pack = classifyOutcome.pack;
  }

  // ── Abstention: genuinely nothing to work with (F11 §4.1's "insufficient evidence" branch) ────
  if (pack.usedCount === 0 && metrics.length === 0) {
    const reason = `No usable evidence and no computable metric was found for ${deps.security.symbol} in the run's window.`;
    await deps.emit({ eventType: 'state', label: 'abstained', payload: { reason } });
    const followups = templateFollowups({ subjectSymbol: deps.security.symbol, metrics, pack });
    return { kind: 'abstained', reason, metrics, followups };
  }

  if (remaining() <= 0) {
    const reason = 'Total wall-clock budget exhausted before synthesis could start.';
    await deps.emit({ eventType: 'state', label: 'degraded', payload: { reason } });
    return { kind: 'degraded', reason, metrics, followups: templateFollowups({ subjectSymbol: deps.security.symbol, metrics, pack }) };
  }

  await deps.emit({ eventType: 'state', label: 'synthesizing', payload: {} });

  const synthesisBudget = Math.min(deps.budgets.synthesis, Math.max(remaining(), 0));
  const synthesisOutcome = await raceTimeout(
    deps.synthesisModelClient.run(
      {
        task: 'synthesis',
        promptVersion: SYNTHESIS_PROMPT_VERSION,
        system: synthesisSystemPrompt(deps.security.symbol),
        prompt: buildSynthesisPrompt({
          question: deps.question,
          subjectSymbol: deps.security.symbol,
          subjectName: deps.security.name,
          pack,
          metrics,
        }),
        maxOutputTokens: deps.synthesisMaxOutputTokens,
      },
      synthesisOutput,
    ),
    synthesisBudget,
  );

  const followupsFor = (p: EvidencePack): readonly FollowupQuestion[] =>
    templateFollowups({ subjectSymbol: deps.security.symbol, metrics, pack: p });

  if (synthesisOutcome === 'timeout') {
    await deps.emit({ eventType: 'state', label: 'degraded', payload: { reason: 'synthesis timed out' } });
    return { kind: 'degraded', reason: 'Synthesis did not complete inside its budget; prose withheld, computed metrics stand.', metrics, followups: followupsFor(pack) };
  }
  if (!synthesisOutcome.ok) {
    await deps.emit({ eventType: 'state', label: 'degraded', payload: { reason: synthesisOutcome.error.kind } });
    return {
      kind: 'degraded',
      reason: `Synthesis failed (${synthesisOutcome.error.kind}); prose withheld, computed metrics stand.`,
      metrics,
      followups: followupsFor(pack),
    };
  }

  const output = synthesisOutcome.data;

  if (remaining() <= 0) {
    await deps.emit({ eventType: 'state', label: 'degraded', payload: { reason: 'wall clock exhausted before verification' } });
    return { kind: 'degraded', reason: 'Total wall-clock budget exhausted before verification could run.', metrics, followups: followupsFor(pack) };
  }

  await deps.emit({ eventType: 'state', label: 'verifying', payload: {} });

  const ctx: VerifyContext = { output, pack, metrics, subjectSymbol: deps.security.symbol };
  const preCheck = runDeterministicChecks(ctx);

  let modelVerification: ModelVerificationResult | null = null;
  if (preCheck.ok) {
    const verifyBudget = Math.min(deps.budgets.verification, Math.max(remaining(), 0));
    const verifyOutcome = await raceTimeout(
      runModelVerification({
        runId: deps.runId,
        output,
        client: deps.verifyModelClient,
        maxOutputTokens: deps.verifyMaxOutputTokens,
      }),
      verifyBudget,
    );
    modelVerification = verifyOutcome === 'timeout' ? { kind: 'error', detail: 'model verification pass timed out' } : verifyOutcome;
  }

  const verdict: VerificationOutcome = resolveVerification(deps.runId, ctx, modelVerification);

  if (verdict.kind === 'verification_failed') {
    await deps.emit({ eventType: 'state', label: 'verification_failed', payload: { reason: verdict.reason } });
    return { kind: 'verification_failed', reason: verdict.reason, claims: verdict.claims, metrics, followups: followupsFor(pack) };
  }

  await deps.emit({ eventType: 'state', label: 'complete', payload: {} });

  let followups = followupsFor(pack);
  if (deps.generateFollowupRewrite) {
    followups = await rewriteFollowups({
      subjectSymbol: deps.security.symbol,
      templates: followups,
      client: deps.synthesisModelClient,
      maxOutputTokens: deps.followupMaxOutputTokens,
    });
  }

  return { kind: 'complete', output, claims: verdict.claims, metrics, followups };
}

export function newClaimId(): string {
  return randomUUID();
}
