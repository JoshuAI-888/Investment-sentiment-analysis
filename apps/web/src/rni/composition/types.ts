import type { RniPersistedClassificationResult } from '../observations';
import type { RniPlatformAnalyticsArtifact } from '../analytics';
import type { RniConvergenceArtifact } from '../convergence';
import type {
  RniCitedSynthesisArtifact,
  RniCitedSynthesisRequest,
  RniSynthesisEvidenceReader,
} from '../agents';

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

export type RniArtifactCommitResult = {
  readonly disposition: 'inserted' | 'duplicate';
  /** SHA-256 identity of the complete canonical artifact, not merely its result payload. */
  readonly artifactHash: string;
};

/** D-RNI-19 lineage boundary between deterministic E06/E07 artifacts and durable storage. */
export interface RniAnalyticsArtifactPersistencePort {
  commitPlatformAnalytics(
    artifact: RniPlatformAnalyticsArtifact,
  ): Promise<RniArtifactCommitResult>;
  commitConvergence(artifact: RniConvergenceArtifact): Promise<RniArtifactCommitResult>;
}

export type RniCitedSynthesisPreparationRequest = {
  readonly runId: string;
  readonly securityId: string;
  readonly convergenceArtifactHash: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
};

export type RniStoredCitedSynthesis = {
  readonly artifact: RniCitedSynthesisArtifact;
  readonly artifactHash: string;
};

export type RniCitedSynthesisPreparation =
  | {
      readonly status: 'ready';
      /** Opaque durable claim returned by storage; callers cannot construct publication lineage. */
      readonly preparationId: string;
      readonly request: RniCitedSynthesisRequest;
    }
  | { readonly status: 'accepted'; readonly stored: RniStoredCitedSynthesis };

export type RniCitedSynthesisCommitResult = RniArtifactCommitResult & {
  readonly summaryId: string;
};

/**
 * D-RNI-19's trusted storage boundary. Callers supply only intent and durable identities; the
 * adapter constructs claims, cutoffs, evidence roles and model descriptors from persisted state.
 */
export interface RniCitedSynthesisPersistencePort extends RniSynthesisEvidenceReader {
  prepare(
    input: RniCitedSynthesisPreparationRequest,
  ): Promise<RniCitedSynthesisPreparation>;
  commitAccepted(input: {
    readonly preparationId: string;
    readonly artifact: RniCitedSynthesisArtifact;
  }): Promise<RniCitedSynthesisCommitResult>;
  loadAccepted(summaryId: string): Promise<RniStoredCitedSynthesis>;
}
