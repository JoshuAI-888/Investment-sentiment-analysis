import { canonicalHash } from '../../calc/canonical';
import {
  calculatePlatformAnalytics,
  type RniAnalyticsMethodology,
  type RniPlatformAnalyticsArtifact,
  type RniPlatformAnalyticsInput,
} from '../analytics';
import {
  convergePlatformFacts,
  type RniConvergenceArtifact,
  type RniConvergenceRequest,
} from '../convergence';
import type {
  RniAnalyticsArtifactPersistencePort,
  RniArtifactCommitResult,
} from './types';

function requireCommittedIdentity(
  artifact: RniPlatformAnalyticsArtifact | RniConvergenceArtifact,
  committed: RniArtifactCommitResult,
): void {
  if (committed.artifactHash !== canonicalHash(artifact)) {
    throw new Error('RNI artifact persistence returned a different canonical identity');
  }
}

export async function calculateAndCommitPlatformAnalytics(
  input: RniPlatformAnalyticsInput,
  methodology: RniAnalyticsMethodology,
  persistence: RniAnalyticsArtifactPersistencePort,
): Promise<{
  readonly artifact: RniPlatformAnalyticsArtifact;
  readonly persistence: RniArtifactCommitResult;
}> {
  const artifact = calculatePlatformAnalytics(input, methodology);
  const committed = await persistence.commitPlatformAnalytics(artifact);
  requireCommittedIdentity(artifact, committed);
  return { artifact, persistence: committed };
}

export async function convergeAndCommitPlatformFacts(
  request: RniConvergenceRequest,
  persistence: RniAnalyticsArtifactPersistencePort,
): Promise<{
  readonly artifact: RniConvergenceArtifact;
  readonly persistence: RniArtifactCommitResult;
}> {
  const artifact = convergePlatformFacts(request);
  const committed = await persistence.commitConvergence(artifact);
  requireCommittedIdentity(artifact, committed);
  return { artifact, persistence: committed };
}
