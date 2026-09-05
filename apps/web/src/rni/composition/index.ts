export { classifyAndCommitPersistedSource } from './semantic';
export {
  calculateAndCommitPlatformAnalytics,
  convergeAndCommitPlatformFacts,
} from './artifacts';
export {
  loadAndReplayAcceptedCitedSynthesis,
  synthesizeAndCommitCitedNarrative,
} from './cited-synthesis';
export type {
  RniAnalyticsArtifactPersistencePort,
  RniArtifactCommitResult,
  RniCitedSynthesisCommitResult,
  RniCitedSynthesisPersistencePort,
  RniCitedSynthesisPreparation,
  RniCitedSynthesisPreparationRequest,
  RniSemanticCommitRequest,
  RniSemanticCommitResult,
  RniSemanticPersistencePort,
  RniStoredCitedSynthesis,
} from './types';
