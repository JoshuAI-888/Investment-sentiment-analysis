/**
 * F11 — the research orchestrator. Drives the state machine (`state-machine.ts`) end to end:
 * budget check, gathering, deterministic analysis, synthesis, verification, the claim ledger,
 * and follow-ups. Every module this file composes is independently unit-tested; this file's own
 * tests are about **ordering and state transitions** — which stage runs before which, and which
 * outcome each failure mode produces — not about re-testing e.g. the eight checks' internals.
 *
 * **The one invariant every other decision in this file serves (F11 §6 DoD): "Unverified prose
 * can reach a user by no code path."** Trace it once, here: `result.prose` is only ever set in
 * the branch where `verifyClaims` returned `allSupported: true` *and* every claim's shape was
 * valid. Every other branch (`degraded`, `verification_failed`, `abstained`, `failed`) sets
 * `result.prose` to `null` before persisting. There is exactly one call to `repo.updateRun`
 * per outcome branch below, and each is written with its `result` object inline, so a reviewer
 * checking "is there a path where prose renders without a passed verification" can read this
 * file top to bottom rather than trace call sites (`04-BUILD-LOOP.md` PR review step 1).
 */
import type { ResearchRun } from '@/contracts/research';
import type { Clock } from '@/adapters/ports';
import {
  type BudgetCheck,
  type EvidenceGatheringPort,
  type MetricRef,
  type MetricsLookupPort,
  type ModelClient,
  type NewResearchEvent,
  type ResearchRepositoryPort,
} from './ports';
import { createSequenceCounter, dbStatusFor, type ResearchStage } from './state-machine';
import { stageEventDetail, streamEventDetail, type StreamEventDetail } from './stream-events';
import { STAGE_BUDGET_MS, withDeadline } from './latency-budget';
import { buildSynthesisPrompt, flattenSynthesis, runSynthesis, SYNTHESIS_PROMPT_VERSION, type FlatClaim, type SynthesisOutput } from './synthesis';
import { runDeterministicChecks, type VerifierContext } from './verifier/checks';
import { runModelVerificationPass, type ModelVerificationVerdict } from './verifier/model-pass';
import { buildClaimLedger, validateLedgerShape } from './claim-ledger';
import { templateFollowups, type FollowupTemplate } from './followups';
import type { SocialAxis } from '@/contracts/primitives';

/**
 * F11 §4.1: "abstained (insufficient evidence)." Not named numerically in the spec — this is a
 * named, documented default rather than a spec citation. Revisit once F12's eval corpus
 * (`05-TEST-STRATEGY.md` §5.1) gives an empirical floor.
 */
export const MIN_USABLE_EVIDENCE_ITEMS = 3;

/** F11 §4.5 check 5's own default, matching `05-TEST-STRATEGY.md` §6 item 5 exactly. */
export const MIN_STANCE_SAMPLE = 5;

/** How far back a run's own evidence query looks. Not named by the spec; a stated, revisitable default. */
export const RETRIEVAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export type RunResearchInput = {
  userId: string;
  securityId: string;
  /** Uppercased. F11 owns no ticker-resolution step; the caller (the route) already has this. */
  securitySymbol: string;
  question: string;
  /** Defaults to `[securitySymbol]` — a caller naming explicit comparables widens check 6's allow-list. */
  subjectSymbols?: readonly string[];
};

export type RunResearchDeps = {
  repo: ResearchRepositoryPort;
  evidence: EvidenceGatheringPort;
  metrics: MetricsLookupPort;
  model: ModelClient;
  clock: Clock;
  checkBudget: BudgetCheck;
  /**
   * Fired synchronously, right after the same event is durably appended via `repo.appendEvent`
   * — never before. This is what lets `POST /api/research` stream frames in real time within
   * the same request/response cycle without a background job queue (F16a is Wave 4+); it is
   * purely a fan-out of what was already persisted, never a substitute for it.
   */
  onEvent?: (event: NewResearchEvent) => void;
};

export type RunResearchOutcome =
  | { outcome: 'refused'; reason: 'budget'; message: string }
  | { outcome: 'ok'; run: ResearchRun };

type PersistedResult = {
  /** `null` on every branch except a fully verified `complete` (see module doc). */
  prose: SynthesisOutput | null;
  metrics: readonly MetricRef[];
  followups: readonly FollowupTemplate[];
  abstentionReason: string | null;
};

function sampleSizeByAxis(pack: { frames: ReadonlyArray<{ axis: SocialAxis; usedCount: number }> }): Record<SocialAxis, number> {
  const base: Record<SocialAxis, number> = { reddit: 0, x: 0, substack: 0 };
  for (const frame of pack.frames) base[frame.axis] = frame.usedCount;
  return base;
}

function evidenceSummaryFor(pack: { items: ReadonlyArray<{ item: { id: string; title: string; availableAt: Date }; axis: SocialAxis; relevant: boolean }> }): string {
  const used = pack.items.filter((entry) => entry.relevant);
  if (used.length === 0) return '(none)';
  return used
    .map((entry) => `- ${entry.item.id} [${entry.axis}] ${entry.item.title} (available: ${entry.item.availableAt.toISOString()})`)
    .join('\n');
}

function metricsSummaryFor(metrics: readonly MetricRef[]): string {
  if (metrics.length === 0) return '(none)';
  return metrics.map((metric) => `- ${metric.metricId} (${metric.methodId}): ${metric.displayValue} ${metric.unit}`).join('\n');
}

/**
 * Runs the full state machine once, to a terminal outcome. Never throws for an expected
 * condition (budget refusal, a stage timeout, a verifier error) — every one of those is a typed
 * result or a terminal `research_run.status`. An *unexpected* exception (a port's own bug) is
 * allowed to propagate; the caller (the route handler) is responsible for that boundary.
 */
export async function runResearch(input: RunResearchInput, deps: RunResearchDeps): Promise<RunResearchOutcome> {
  const now = deps.clock.now();

  // ── Step 0: the budget check, before anything priced (F11 §6 DoD: "Every run is budget-
  // checked before its first priced call"). No run row exists yet — a refusal is not a run,
  // matching `services/dashboard/refresh.ts`'s `respondRefused` shape for the same reason: a
  // refused attempt costs nothing and creates no audit trail of a "run" that never ran.
  const budget = await deps.checkBudget(now);
  if (!budget.allowed) {
    return { outcome: 'refused', reason: 'budget', message: budget.message };
  }

  const runId = crypto.randomUUID();
  const subjectSymbols = new Set((input.subjectSymbols ?? [input.securitySymbol]).map((symbol) => symbol.toUpperCase()));
  const sequence = createSequenceCounter();

  async function emit(runIdArg: string, stage: ResearchStage, rawDetail: StreamEventDetail): Promise<void> {
    // Validated here, not just at replay time (`stream-events.ts`'s `replayStreamEvents`) — a
    // detail that fails its own schema is a bug in this file, and it is cheaper to throw at the
    // point it was built than to silently drop it three months later on someone's page reload.
    const detail = streamEventDetail.parse(rawDetail);
    const event: NewResearchEvent = {
      runId: runIdArg,
      sequence: sequence(),
      eventType: 'stage',
      label: stage,
      payload: detail,
      createdAt: deps.clock.now(),
    };
    await deps.repo.appendEvent(event);
    deps.onEvent?.(event);
  }

  let run = await deps.repo.createRun({
    id: runId,
    userId: input.userId,
    securityId: input.securityId,
    question: input.question,
    status: 'queued',
    coverageStatus: 'pending',
    inputCutoff: now,
    startedAt: now,
    promptVersion: SYNTHESIS_PROMPT_VERSION,
    modelRoute: {},
    toolManifest: {},
  });

  // First progress event — F11 §4.3: "First progress event in < 1 s." Emitted immediately after
  // the row exists, before any network call, so nothing between this and the caller's request
  // can push it past the budget.
  await emit(runId, 'queued', stageEventDetail('queued'));

  async function finish(stage: 'complete' | 'degraded' | 'verification_failed' | 'abstained' | 'failed', result: PersistedResult | null, error: unknown): Promise<ResearchRun> {
    const completedAt = deps.clock.now();
    await emit(runId, stage, { kind: 'outcome', status: stage, reason: result?.abstentionReason ?? null });
    return deps.repo.updateRun(runId, {
      status: dbStatusFor(stage),
      completedAt,
      costUsd: '0',
      result,
      error: error === null || error === undefined ? null : { message: String(error) },
    });
  }

  // ── Gathering ────────────────────────────────────────────────────────────────────────────
  await emit(runId, 'gathering', stageEventDetail('gathering'));
  let gathered;
  try {
    gathered = await deps.evidence.gather(
      {
        securityId: input.securityId,
        question: input.question,
        window: { from: new Date(now.getTime() - RETRIEVAL_LOOKBACK_MS), to: now },
      },
      { fanOutMs: STAGE_BUDGET_MS.fanOut, classificationMs: STAGE_BUDGET_MS.classification },
    );
  } catch (error) {
    run = await finish('failed', null, error);
    return { outcome: 'ok', run };
  }
  await emit(runId, 'gathering', {
    kind: 'evidence_gathered',
    retrievedCount: gathered.pack.frames.reduce((sum, frame) => sum + frame.retrievedCount, 0),
    usedCount: gathered.pack.frames.reduce((sum, frame) => sum + frame.usedCount, 0),
  });
  if (gathered.fanOutTimedOut) await emit(runId, 'gathering', { kind: 'budget_overrun', stage: 'fan_out', budgetMs: STAGE_BUDGET_MS.fanOut });
  if (gathered.classificationTimedOut) await emit(runId, 'gathering', { kind: 'budget_overrun', stage: 'classification', budgetMs: STAGE_BUDGET_MS.classification });

  const usableItemCount = gathered.pack.items.filter((item) => item.relevant).length;
  if (usableItemCount < MIN_USABLE_EVIDENCE_ITEMS) {
    run = await finish(
      'abstained',
      { prose: null, metrics: [], followups: [], abstentionReason: `only ${String(usableItemCount)} usable evidence item(s), below the floor of ${String(MIN_USABLE_EVIDENCE_ITEMS)}` },
      null,
    );
    return { outcome: 'ok', run };
  }

  // ── Deterministic analysis — 1 s, hard failure on overrun (F11 §4.2: "this is local computation") ──
  await emit(runId, 'analyzing', stageEventDetail('analyzing'));
  let metrics: readonly MetricRef[];
  try {
    const timed = await withDeadline(deps.metrics.forSecurity(input.securityId, now), STAGE_BUDGET_MS.deterministicAnalysis, deps.clock);
    if (timed.timedOut) {
      run = await finish('failed', null, 'deterministic analysis exceeded its 1s hard budget');
      return { outcome: 'ok', run };
    }
    metrics = timed.value;
  } catch (error) {
    run = await finish('failed', null, error);
    return { outcome: 'ok', run };
  }
  // Deterministic metrics stream first and survive any later prose failure (F11 §4.2/§6 DoD).
  for (const metric of metrics) {
    await emit(runId, 'analyzing', { kind: 'metric', metricId: metric.metricId, displayValue: metric.displayValue, unit: metric.unit });
  }

  // ── Synthesis — 10 s, `degraded` on overrun/error ───────────────────────────────────────────
  await emit(runId, 'synthesizing', stageEventDetail('synthesizing'));
  const prompt = buildSynthesisPrompt({
    question: input.question,
    securitySymbol: input.securitySymbol,
    evidenceSummary: evidenceSummaryFor(gathered.pack),
    metricsSummary: metricsSummaryFor(metrics),
  });
  const synthesis = await runSynthesis(deps.model, prompt, {}, deps.clock, STAGE_BUDGET_MS.synthesis);
  if (synthesis.outcome !== 'ok') {
    run = await finish('degraded', { prose: null, metrics, followups: [], abstentionReason: null }, synthesis.outcome === 'error' ? synthesis.error : 'synthesis exceeded its 10s budget');
    return { outcome: 'ok', run };
  }

  // ── Verification — 4 s, `verification_failed` on any failure of any kind ──────────────────
  await emit(runId, 'verifying', stageEventDetail('verifying'));
  const claims: readonly FlatClaim[] = flattenSynthesis(synthesis.output);
  const verifierContext: VerifierContext = {
    pack: gathered.pack,
    metrics,
    runWindow: gathered.pack.retrievalWindow,
    subjectSymbols,
    sampleSizeByAxis: sampleSizeByAxis(gathered.pack),
    minStanceSample: MIN_STANCE_SAMPLE,
    statedFreshnessAsOf: new Date(synthesis.output.statedFreshnessAsOf),
  };

  const deterministic = runDeterministicChecks(claims, verifierContext);

  async function withhold(reason: unknown, modelVerdict: ModelVerificationVerdict | null): Promise<ResearchRun> {
    const ledger = buildClaimLedger({ runId, claims, ctx: verifierContext, modelVerdict });
    if (ledger.length > 0) await deps.repo.insertClaims(ledger);
    return finish('verification_failed', { prose: null, metrics, followups: [], abstentionReason: null }, reason);
  }

  if (!deterministic.allPassed) {
    const failing = deterministic.results.filter((result) => !result.passed).map((result) => result.id);
    run = await withhold(`deterministic check(s) failed: ${failing.join(', ')}`, null);
    return { outcome: 'ok', run };
  }

  const modelPass = await runModelVerificationPass(deps.model, claims, evidenceSummaryFor(gathered.pack), deps.clock, STAGE_BUDGET_MS.verification);
  if (modelPass.outcome !== 'ok') {
    run = await withhold(modelPass.outcome === 'error' ? modelPass.error : 'verification exceeded its 4s budget', null);
    return { outcome: 'ok', run };
  }

  const allSupported = claims.length === modelPass.verdict.verdicts.length && modelPass.verdict.verdicts.every((verdict) => verdict.supported);
  const ledger = buildClaimLedger({ runId, claims, ctx: verifierContext, modelVerdict: modelPass.verdict });
  const shapeIssues = validateLedgerShape(ledger);

  if (!allSupported || shapeIssues.length > 0) {
    if (ledger.length > 0) await deps.repo.insertClaims(ledger);
    run = await finish(
      'verification_failed',
      { prose: null, metrics, followups: [], abstentionReason: null },
      allSupported ? `claim ledger shape violation(s): ${shapeIssues.join('; ')}` : 'one or more claims were not supported by their cited evidence',
    );
    return { outcome: 'ok', run };
  }

  // ── Complete — the only branch that may ever set `prose` ───────────────────────────────────
  if (ledger.length > 0) await deps.repo.insertClaims(ledger);
  for (const claim of claims) {
    await emit(runId, 'complete', { kind: 'claim', section: claim.section, text: claim.text });
  }
  const followups = templateFollowups(gathered.pack, synthesis.output);

  run = await finish('complete', { prose: synthesis.output, metrics, followups, abstentionReason: null }, null);
  return { outcome: 'ok', run };
}
