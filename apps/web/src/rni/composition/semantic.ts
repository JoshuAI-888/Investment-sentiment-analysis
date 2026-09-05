import { z } from 'zod';

import {
  classifyPersistedSecurityObservations,
  type RniClassifierEvidenceReader,
  type RniClassifierInferencePort,
  type RniObservationIdFactory,
  type RniPersistedClassificationRequest,
  type RniPersistedClassificationResult,
} from '../observations';
import type {
  RniSemanticCommitResult,
  RniSemanticPersistencePort,
} from './types';

const durableRunId = z.string().uuid();

function assertSourceBinding(
  sourceItemId: string,
  result: RniPersistedClassificationResult,
): void {
  const sourceIds = [
    ...result.observations.map(({ sourceItemId: id }) => id),
    ...result.claims.map(({ sourceItemId: id }) => id),
    ...result.themes.map(({ sourceItemId: id }) => id),
    ...result.noise.map(({ sourceItemId: id }) => id),
    ...result.citationProposals.map(({ sourceItemId: id }) => id),
  ];
  if (sourceIds.some((id) => id !== sourceItemId)) {
    throw new Error('RNI semantic commit refuses classification output from another source');
  }
}

export async function classifyAndCommitPersistedSource(
  input: {
    readonly runId: string;
    readonly classification: RniPersistedClassificationRequest;
  },
  deps: {
    readonly evidence: RniClassifierEvidenceReader;
    readonly inference: RniClassifierInferencePort;
    readonly observationIdFactory: RniObservationIdFactory;
    readonly persistence: RniSemanticPersistencePort;
  },
): Promise<{
  readonly classification: RniPersistedClassificationResult;
  readonly persistence: RniSemanticCommitResult;
}> {
  const runId = durableRunId.parse(input.runId);
  const classification = await classifyPersistedSecurityObservations(input.classification, {
    evidence: deps.evidence,
    inference: deps.inference,
    observationIdFactory: deps.observationIdFactory,
  });
  assertSourceBinding(input.classification.sourceItemId, classification);
  const persistence = await deps.persistence.commitClassification({
    runId,
    sourceItemId: input.classification.sourceItemId,
    classification,
  });
  return { classification, persistence };
}
