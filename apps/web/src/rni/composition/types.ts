import type { RniPersistedClassificationResult } from '../observations';

export type RniSemanticCommitRequest = {
  /** Durable run selected by server-side orchestration. */
  readonly runId: string;
  /** Durable source identity already committed before classification begins. */
  readonly sourceItemId: string;
  readonly classification: RniPersistedClassificationResult;
};

export type RniSemanticCommitResult = {
  readonly disposition: 'inserted' | 'duplicate';
  readonly observationIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly citationIds: readonly string[];
};

/**
 * CR-DATA-002's deliberately narrow cross-lane boundary. Implementations must commit the complete
 * E05 result atomically and return the durable identities selected by storage on exact replay.
 * Storage-shaped rows remain private to the DATA adapter.
 */
export interface RniSemanticPersistencePort {
  commitClassification(input: RniSemanticCommitRequest): Promise<RniSemanticCommitResult>;
}
