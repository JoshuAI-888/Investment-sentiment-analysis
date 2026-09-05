import { canonicalHash } from '../../calc/canonical';
import {
  replayCitedSynthesis,
  synthesizeCitedNarrative,
  type RniChallengerInferencePort,
  type RniCitedSynthesisArtifact,
  type RniCitedSynthesisRequest,
  type RniVerificationInferencePort,
} from '../agents';
import type {
  RniCitedSynthesisCommitResult,
  RniCitedSynthesisPersistencePort,
  RniCitedSynthesisPreparationRequest,
  RniStoredCitedSynthesis,
} from './types';

function assertPreparedRequestMatchesIntent(
  intent: RniCitedSynthesisPreparationRequest,
  request: RniCitedSynthesisRequest,
): void {
  if (
    request.convergenceArtifact.result.runId !== intent.runId ||
    request.convergenceArtifact.result.securityId !== intent.securityId ||
    canonicalHash(request.convergenceArtifact) !== intent.convergenceArtifactHash
  ) {
    throw new Error('RNI cited-synthesis preparation returned crossed durable lineage');
  }
}

function assertStoredIdentity(stored: RniStoredCitedSynthesis): void {
  if (canonicalHash(stored.artifact) !== stored.artifactHash) {
    throw new Error('RNI cited-synthesis storage returned a different canonical identity');
  }
}

async function replayStored(
  stored: RniStoredCitedSynthesis,
  persistence: RniCitedSynthesisPersistencePort,
): Promise<RniCitedSynthesisArtifact> {
  assertStoredIdentity(stored);
  const replayed = await replayCitedSynthesis(stored.artifact, persistence);
  if (canonicalHash(replayed) !== stored.artifactHash) {
    throw new Error('RNI cited-synthesis replay differs from its durable identity');
  }
  return replayed;
}

function assertCommitIdentity(
  artifact: RniCitedSynthesisArtifact,
  committed: RniCitedSynthesisCommitResult,
): void {
  if (
    committed.summaryId !== artifact.result.summary.id ||
    committed.artifactHash !== canonicalHash(artifact)
  ) {
    throw new Error('RNI cited-synthesis commit returned a different durable identity');
  }
}

export async function synthesizeAndCommitCitedNarrative(
  intent: RniCitedSynthesisPreparationRequest,
  persistence: RniCitedSynthesisPersistencePort,
  verifier: RniVerificationInferencePort,
  challenger: RniChallengerInferencePort,
): Promise<{
  readonly artifact: RniCitedSynthesisArtifact;
  readonly persistence: RniCitedSynthesisCommitResult;
}> {
  const preparation = await persistence.prepare(intent);
  if (preparation.status === 'accepted') {
    assertPreparedRequestMatchesIntent(intent, preparation.stored.artifact.requestSnapshot);
    const artifact = await replayStored(preparation.stored, persistence);
    return {
      artifact,
      persistence: {
        disposition: 'duplicate',
        summaryId: artifact.result.summary.id,
        artifactHash: preparation.stored.artifactHash,
      },
    };
  }

  assertPreparedRequestMatchesIntent(intent, preparation.request);
  const artifact = await synthesizeCitedNarrative(
    preparation.request,
    persistence,
    verifier,
    challenger,
  );
  const committed = await persistence.commitAccepted({
    preparationId: preparation.preparationId,
    artifact,
  });
  assertCommitIdentity(artifact, committed);
  return { artifact, persistence: committed };
}

export async function loadAndReplayAcceptedCitedSynthesis(
  summaryId: string,
  persistence: RniCitedSynthesisPersistencePort,
): Promise<RniCitedSynthesisArtifact> {
  const stored = await persistence.loadAccepted(summaryId);
  if (stored.artifact.result.summary.id !== summaryId) {
    throw new Error('RNI cited-synthesis load returned a different summary identity');
  }
  return replayStored(stored, persistence);
}
