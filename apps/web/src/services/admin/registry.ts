/**
 * F15 §5/§4.1 — "enumerate every mutation and assert each performs all eight steps." This is
 * that enumeration: every `MutationDefinition` this feature built, in one place, so a review or
 * a test can iterate the whole set rather than trusting that every call site remembered to route
 * through `runAdminMutation`. A mutation defined but not added here is invisible to
 * `tests/unit/admin/registry.test.ts` — the review step (F15 PR review step 1) is "does this
 * list match the diff", not just "does the list pass its own test".
 */
import type { AdminMutationBase, MutationDefinition } from './mutation';
import { activateUniverseMutation, draftUniverseMutation } from './universe';
import { rollbackSettingsMutation, updateSettingMutation } from './settings';
import { resolveCalculationIssueMutation } from './calculation-issues';

/** Loosened to `AdminMutationBase` for the registry only — each export above keeps its real type. */
export const ADMIN_MUTATIONS: Readonly<Record<string, MutationDefinition<AdminMutationBase>>> = {
  'universe.draft': draftUniverseMutation as unknown as MutationDefinition<AdminMutationBase>,
  'universe.activate': activateUniverseMutation as unknown as MutationDefinition<AdminMutationBase>,
  'settings.update': updateSettingMutation as unknown as MutationDefinition<AdminMutationBase>,
  'settings.rollback': rollbackSettingsMutation as unknown as MutationDefinition<AdminMutationBase>,
  'calculation_issue.resolve': resolveCalculationIssueMutation as unknown as MutationDefinition<AdminMutationBase>,
};

export type AdminMutationKey = keyof typeof ADMIN_MUTATIONS;
