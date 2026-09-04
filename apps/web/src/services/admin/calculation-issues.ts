/**
 * F15 §4.6 — "the calculation-issue queue with resolution that produces a successor artifact
 * and never mutates the original." The DoD line and §4.6's body both keep this queue; the D-11
 * amendment banner at the top of the F15 spec also lists "the issue queue" among what D-11 cuts.
 * Read together with `calculation_issue` already existing as merged F05 schema (`0004_
 * calculations.sql`), with real repository callers (`retention.ts`, `artifacts.ts`) — the tree
 * already carries this table as kept, and per this repo's own rule ("if the package and the
 * tree disagree, the tree wins"), that is what this feature builds against. Reported to the
 * coordinator as a scope note, not silently resolved.
 *
 * This mutation does **not** compute a resolution calculation itself — that is F05's replay
 * machinery (`services/calculations.ts#runReplay`), out of this file's scope. It requires the
 * admin to supply an already-computed, different `calculation_snapshot` id and verifies it both
 * exists and is not the original before accepting the resolution.
 */
import { z } from 'zod';
import type { Queryable } from '@/repositories/client';
import { findCalculationSnapshot } from '@/repositories/calculations';
import { findCalculationIssueById, resolveCalculationIssue } from '@/repositories/calculation-issues';
import { ADMIN_ENVIRONMENT } from './constants';
import type { AdminMutationBase, LoadedCurrent, MutationDefinition } from './mutation';

export const resolveIssueSchema = z
  .object({
    reason: z.string().min(3, 'a change reason is required'),
    expectedVersion: z.string().nullable(),
    issueId: z.string().uuid(),
    status: z.enum(['resolved', 'rejected']),
    resolutionSummary: z.string().min(3),
    resolutionCalculationId: z.string().uuid().nullable(),
  })
  .refine((input) => (input.status === 'resolved') === (input.resolutionCalculationId !== null), {
    message:
      'resolutionCalculationId is required when status is "resolved" and must be null when "rejected" — a rejected issue has nothing to point at.',
    path: ['resolutionCalculationId'],
  });
export type ResolveIssueInput = z.infer<typeof resolveIssueSchema> & AdminMutationBase;

async function loadCurrentIssue(input: ResolveIssueInput, tx: Queryable): Promise<LoadedCurrent | null> {
  const issue = await findCalculationIssueById(input.issueId, tx);
  if (issue === null) return null;
  return { objectId: issue.id, version: issue.updatedAt.toISOString(), snapshot: issue };
}

export const resolveCalculationIssueMutation: MutationDefinition<ResolveIssueInput> = {
  objectType: 'calculation_issue',
  action: 'calculation_issue.resolve',
  environment: ADMIN_ENVIRONMENT,
  schema: resolveIssueSchema,
  loadCurrent: loadCurrentIssue,
  impactPreview: async (input, _current, tx) => {
    if (input.resolutionCalculationId === null) {
      return { status: input.status, resolutionCalculationId: null, resolutionExists: null, isDifferentCalculation: null };
    }
    const resolution = await findCalculationSnapshot(input.resolutionCalculationId, tx);
    const issue = await findCalculationIssueById(input.issueId, tx);
    return {
      status: input.status,
      resolutionCalculationId: input.resolutionCalculationId,
      resolutionExists: resolution !== null,
      isDifferentCalculation:
        issue === null ? null : issue.calculationId !== input.resolutionCalculationId,
    };
  },
  write: async (input, current, tx) => {
    if (current === null) {
      throw new Error(`calculation_issue ${input.issueId} does not exist.`);
    }
    const issue = current.snapshot as { calculationId: string; updatedAt: Date };

    if (input.resolutionCalculationId !== null) {
      if (input.resolutionCalculationId === issue.calculationId) {
        throw new Error(
          'resolutionCalculationId must reference a different calculation than the one the ' +
            'issue was raised against — resolution never mutates the original (F15 §4.6).',
        );
      }
      const resolution = await findCalculationSnapshot(input.resolutionCalculationId, tx);
      if (resolution === null) {
        throw new Error(`resolutionCalculationId ${input.resolutionCalculationId} does not exist.`);
      }
    }

    const updated = await resolveCalculationIssue(
      input.issueId,
      issue.updatedAt,
      {
        status: input.status,
        adminNotes: input.reason,
        resolutionSummary: input.resolutionSummary,
        resolutionCalculationId: input.resolutionCalculationId,
      },
      tx,
    );
    if (updated === null) {
      throw new Error(
        `calculation_issue ${input.issueId} was modified concurrently (updated_at no longer matches).`,
      );
    }

    return { objectId: updated.id, afterValue: updated, rollbackTarget: null };
  },
};
