/**
 * The composition root `app/api/research/**` uses to build `RunResearchDeps`
 * (`orchestrator.ts`). Everything a route handler needs to run a real research request, wired
 * per `PROVIDER_MODE` — mirroring `services/jobs/scorer-client.ts`'s role for the scoring
 * worker: "the only file ... that knows [the external thing] is reached over HTTP."
 *
 * **What is genuinely wired here, and what is not (see `ports.ts` and this build's `CONTRACTS`
 * report for the full accounting):**
 *
 * - The repository is `createInMemoryResearchRepository()` (`testing.ts`) — module-level, so it
 *   survives across requests **within one running process** (a reload while the dev server or a
 *   single serverless instance stays warm), but not across a real process boundary. This is a
 *   named, temporary stand-in for `src/repositories/research.ts`, which this lane does not own
 *   and cannot write.
 * - The evidence and metrics ports are the dev fixtures (`dev-fixtures.ts`) — a real F10
 *   integration and a real "list this security's metrics" query do not exist yet.
 * - The `ModelClient` **is** real: `createGatewayModelClient` in `live` mode (D-34's two
 *   distinct model routes, read from `env.ts`, already boot-validated there), the fixture
 *   client in `fixture` mode. This is the one seam F11 owns outright.
 * - The budget check reuses `services/dashboard/budget.ts`'s `checkGlobalBudget` — the same
 *   global ceiling every priced feature checks against (D-20).
 * - Every synthesis/verify call now writes a `cost_event` via `cost.ts#recordModelCost`
 *   (lane-review finding 2) — `runId` is threaded in from the caller (`route.ts` mints it before
 *   calling this function) precisely so the very first model call can already attribute its
 *   cost to the run it belongs to.
 */
import { env } from '@/env';
import { systemClock } from '@/adapters/ports';
import { checkGlobalBudget } from '@/services/dashboard/budget';
import { findSecurityById } from '@/repositories/security';
import { createInMemoryResearchRepository } from './testing';
import { createDevFixtureEvidencePort, createDevFixtureMetricsPort, createDevFixtureModelClient } from './dev-fixtures';
import { createGatewayModelClient, type ModelUsageListener } from './model-client';
import { createCostAccumulator, estimateCostUsd, recordModelCost } from './cost';
import type { AuditEntry, AuditPort, ModelClient } from './ports';
import type { RunResearchDeps } from './orchestrator';

/** One process-lifetime repository. See this module's docstring for exactly what that does and does not guarantee. */
const sharedRepository = createInMemoryResearchRepository();

/**
 * No `audit_event` writer exists for `research_run` yet (`ports.ts`'s `AuditPort` docstring;
 * lane-review finding 8) — this is the same, disclosed kind of stand-in as the in-memory
 * repository above: real audit trail semantics (queryable, permanent, tied to the real
 * `audit_event` table) require `src/repositories/`, which this lane does not own. A structured
 * `console.error` at least makes a retraction attempt visible in server logs today rather than
 * silently absent, and every field a real writer would need is already shaped correctly
 * (`AuditEntry`) so swapping this for a real one is a one-line change in `createRetractionDeps`.
 */
function createConsoleAuditLog(): AuditPort {
  return {
    record(entry: AuditEntry): Promise<void> {
      console.error('[research] audit_event (not yet persisted — see CONTRACTS)', entry);
      return Promise.resolve();
    },
  };
}

function usageListenerFor(
  runId: string,
  userId: string,
  accumulator: ReturnType<typeof createCostAccumulator>,
): ModelUsageListener {
  return (info) => {
    // Accumulated synchronously so the run's own `costUsd` total is available the instant the
    // run finishes — independent of the fire-and-forget `cost_event` insert below, which is the
    // authoritative ledger for budget purposes but need not have landed yet for this total to
    // be correct (`cost.ts#createCostAccumulator`'s docstring).
    accumulator.add(estimateCostUsd(info.usage));

    // Fire-and-forget from the model client's perspective — cost recording must never block or
    // fail a research answer that otherwise succeeded. A failure here is logged, not thrown.
    void recordModelCost({
      runId,
      userId,
      task: info.task === 'verify' ? 'verify' : 'synthesis',
      model: info.model,
      usage: info.usage,
      requestId: crypto.randomUUID(),
      occurredAt: systemClock.now(),
    }).catch((error: unknown) => {
      // Matches the convention in services/{auth,dashboard}/*.ts — no logging port is injected
      // this deep, and a swallowed cost-recording failure would otherwise be silently invisible.
      console.error('[research] failed to record model cost_event', error);
    });
  };
}

function createModelClient(runId: string, userId: string, accumulator: ReturnType<typeof createCostAccumulator>): ModelClient {
  const onUsage = usageListenerFor(runId, userId, accumulator);

  if (env.PROVIDER_MODE !== 'live') return createDevFixtureModelClient(onUsage);

  if (env.AI_GATEWAY_API_KEY === undefined || env.AI_MODEL_SYNTHESIS === undefined || env.AI_MODEL_VERIFY === undefined || env.AI_MODEL_FAST === undefined) {
    // `env.ts` already fails boot in live mode without these — reachable only if that guard is
    // ever bypassed. Thrown, not silently degraded: a missing model route is not a condition
    // this feature may substitute anything for.
    throw new Error('PROVIDER_MODE=live requires AI_GATEWAY_API_KEY, AI_MODEL_SYNTHESIS, AI_MODEL_VERIFY and AI_MODEL_FAST (src/env.ts).');
  }

  return createGatewayModelClient({
    apiKey: env.AI_GATEWAY_API_KEY,
    synthesisModel: env.AI_MODEL_SYNTHESIS,
    verifyModel: env.AI_MODEL_VERIFY,
    fastModel: env.AI_MODEL_FAST,
    onUsage,
  });
}

export function createResearchDeps(input: { runId: string; userId: string }): RunResearchDeps {
  const accumulator = createCostAccumulator();
  return {
    repo: sharedRepository,
    evidence: createDevFixtureEvidencePort(),
    metrics: createDevFixtureMetricsPort(),
    model: createModelClient(input.runId, input.userId, accumulator),
    clock: systemClock,
    checkBudget: (now) => checkGlobalBudget(now),
    getAccumulatedCostUsd: accumulator.total,
  };
}

/** `GET /api/research/:runId` and the stream route both need this; the repository is the shared instance above. */
export function researchRepository(): ReturnType<typeof createInMemoryResearchRepository> {
  return sharedRepository;
}

/** `POST /api/research/:runId/retract` needs the repository, a clock, and the audit stand-in above. */
export function createRetractionDeps(): { repo: ReturnType<typeof createInMemoryResearchRepository>; clock: typeof systemClock; audit: AuditPort } {
  return { repo: sharedRepository, clock: systemClock, audit: createConsoleAuditLog() };
}

/** Read-only use of an existing SPINE repository query — not a new one (`repositories/security.ts` is untouched). */
export async function resolveSecuritySymbol(securityId: string): Promise<string | null> {
  const security = await findSecurityById(securityId);
  return security?.symbol ?? null;
}
