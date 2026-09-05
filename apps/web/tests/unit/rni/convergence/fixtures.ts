import {
  RNI_CONVERGENCE_CODE_VERSION,
  type RniConvergencePlatformInput,
  type RniConvergenceRequest,
} from '../../../../src/rni/convergence';
import type { RniPlatform, RniSliceStatus, RniStance } from '../../../../src/rni/contracts';

export const RUN_ID = '00000000-0000-4000-8000-000000000701';
export const SECURITY_ID = '00000000-0000-4000-8000-000000000702';
export const REDDIT_SLICE_ID = '00000000-0000-4000-8000-000000000703';
export const X_SLICE_ID = '00000000-0000-4000-8000-000000000704';

const dimensionKeys = [
  'company_fundamentals',
  'market_trading',
  'catalyst_event',
  'retail_narrative',
] as const;

export function dimensions(stance: RniStance, score: string | null) {
  return dimensionKeys.map((dimension) => ({ dimension, stance, score }));
}

export function platformInput(
  platform: RniPlatform,
  overrides: Partial<RniConvergencePlatformInput> = {},
): RniConvergencePlatformInput {
  const isReddit = platform === 'reddit';
  return {
    platform,
    runId: RUN_ID,
    runSourceSliceId: isReddit ? REDDIT_SLICE_ID : X_SLICE_ID,
    securityId: SECURITY_ID,
    methodologyVersion: 'rni-methodology-v1',
    windowStart: '2026-09-04T12:00:00Z',
    windowEnd: '2026-09-05T12:00:00Z',
    status: 'complete',
    stance: 'bullish',
    stanceScore: isReddit ? '0.6' : '0.5',
    dimensions: dimensions('bullish', isReddit ? '0.6' : '0.5'),
    effectiveAttention: isReddit ? '4' : '2',
    dataThroughAt: '2026-09-05T11:30:00Z',
    analyticsArtifactHash: (isReddit ? 'a' : 'b').repeat(64),
    ...overrides,
  };
}

export function nonPublishablePlatform(
  platform: RniPlatform,
  status: Extract<RniSliceStatus, 'pending' | 'running' | 'failed' | 'unavailable'>,
): RniConvergencePlatformInput {
  return platformInput(platform, {
    status,
    stance: 'insufficient',
    stanceScore: null,
    dimensions: dimensions('insufficient', null),
    effectiveAttention: '0',
    dataThroughAt: null,
  });
}

export function convergenceRequest(
  overrides: Partial<RniConvergenceRequest> = {},
): RniConvergenceRequest {
  return {
    asOf: '2026-09-05T12:00:00Z',
    reddit: platformInput('reddit'),
    x: platformInput('x'),
    policy: {
      version: 'rni-convergence-policy-v1',
      codeVersion: RNI_CONVERGENCE_CODE_VERSION,
      dimensionDivergenceMinimum: '0.4',
      scaleImbalanceRatioThreshold: '3',
      staleAfterHours: '24',
    },
    ...overrides,
  };
}
