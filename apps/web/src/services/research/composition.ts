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
 */
import { env } from '@/env';
import { systemClock } from '@/adapters/ports';
import { checkGlobalBudget } from '@/services/dashboard/budget';
import { findSecurityById } from '@/repositories/security';
import { createInMemoryResearchRepository } from './testing';
import { createDevFixtureEvidencePort, createDevFixtureMetricsPort, createDevFixtureModelClient } from './dev-fixtures';
import { createGatewayModelClient } from './model-client';
import type { ModelClient } from './ports';
import type { RunResearchDeps } from './orchestrator';

/** One process-lifetime repository. See this module's docstring for exactly what that does and does not guarantee. */
const sharedRepository = createInMemoryResearchRepository();

function createModelClient(): ModelClient {
  if (env.PROVIDER_MODE !== 'live') return createDevFixtureModelClient();

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
  });
}

export function createResearchDeps(): RunResearchDeps {
  return {
    repo: sharedRepository,
    evidence: createDevFixtureEvidencePort(),
    metrics: createDevFixtureMetricsPort(),
    model: createModelClient(),
    clock: systemClock,
    checkBudget: (now) => checkGlobalBudget(now),
  };
}

/** `GET /api/research/:runId` and the stream route both need this; the repository is the shared instance above. */
export function researchRepository(): ReturnType<typeof createInMemoryResearchRepository> {
  return sharedRepository;
}

/** Read-only use of an existing SPINE repository query — not a new one (`repositories/security.ts` is untouched). */
export async function resolveSecuritySymbol(securityId: string): Promise<string | null> {
  const security = await findSecurityById(securityId);
  return security?.symbol ?? null;
}
