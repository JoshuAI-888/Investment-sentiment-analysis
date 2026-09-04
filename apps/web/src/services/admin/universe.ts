/**
 * F15 §4.3 — the universe selector's mutation surface, built on the uniform pipeline
 * (`./mutation.ts`) and on `repositories/versions.ts`'s existing activation transaction, which
 * this file does not reimplement.
 *
 * Two mutations, both routed through `runAdminMutation`:
 *
 * - `draftUniverseMutation` — records a draft `universe_version` for the target membership the
 *   operator is considering, with the impact preview computed and returned so the UI can show
 *   it before anyone commits to activating.
 * - `activateUniverseMutation` — re-validates the same target membership against the *current*
 *   active version (closing the gap between "I drafted this" and "I am activating it now"),
 *   materialises membership, and activates — via `activateUniverseVersion`, which already
 *   writes its own `audit_event` atomically with the activation (F03 §4.3). This mutation's own
 *   pipeline-driven audit step (§4.1 step 8) still runs and writes a second, distinguishable
 *   row (`action: 'universe.activate'` vs the low-level `'activate'`) — deliberately not
 *   special-cased away, because a mutation whose audit trail depends on which shared helper it
 *   happened to call is exactly the kind of per-mutation exception the uniform contract exists
 *   to prevent. Reported in the PR body under Risks.
 *
 * Rollback (F15 §4.4) is `activateUniverseMutation` again, called with a prior version's
 * membership as the target — it creates a **new** version rather than rewinding the old one,
 * because `activateUniverseVersion` only ever inserts and activates, never updates a
 * superseded row's content (enforced by the `universe_version_append_only` trigger).
 */
import { z } from 'zod';
import type { Queryable } from '@/repositories/client';
import {
  activateUniverseVersion,
  findActiveConfigVersion,
  findActiveUniverseVersion,
  insertUniverseVersion,
  listUniverseMembers,
} from '@/repositories/versions';
import { UNIVERSE_MAX_SYMBOLS, selectionSource, type UniverseVersion } from '@/contracts/config';
import { ADMIN_ENVIRONMENT } from './constants';
import type { AdminMutationBase, LoadedCurrent, MutationDefinition } from './mutation';

const targetMembershipSchema = z
  .array(z.string().uuid())
  .min(1, 'a universe must contain at least one symbol')
  .max(UNIVERSE_MAX_SYMBOLS, `a universe may not exceed ${UNIVERSE_MAX_SYMBOLS} symbols (D-27)`)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicate security ids in the target membership');

export const universeMutationSchema = z.object({
  reason: z.string().min(3, 'a change reason is required'),
  expectedVersion: z.string().regex(/^\d+$/).nullable(),
  targetSecurityIds: targetMembershipSchema,
  selectionSource,
});
export type UniverseMutationInput = z.infer<typeof universeMutationSchema> & AdminMutationBase;

export type UniverseImpactPreview = {
  readonly currentCount: number;
  readonly targetCount: number;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly addedCount: number;
  readonly removedCount: number;
  /**
   * D-15: X reads are spent on trigger, not proportional to universe size — Reddit/Substack/
   * market data are flat-rate under D-15's own table. There is no per-symbol cost constant in
   * this codebase to multiply by (F04/F16a own that), so this preview reports real counts and
   * an honest qualitative note rather than a fabricated dollar figure.
   */
  readonly costNote: string;
};

async function loadCurrentUniverse(tx: Queryable): Promise<LoadedCurrent | null> {
  const active = await findActiveUniverseVersion(ADMIN_ENVIRONMENT, tx);
  if (active === null) return null;
  return { objectId: active.id, version: active.id, snapshot: active };
}

/**
 * Pure set-difference — no I/O — so the arithmetic itself (§5's "impact-preview arithmetic")
 * is unit-testable without a database. `computeImpactPreview` below is the thin I/O wrapper that
 * fetches `currentMembers` and hands off to this.
 */
export function diffMembership(
  currentMembers: readonly string[],
  targetSecurityIds: readonly string[],
): UniverseImpactPreview {
  const currentSet = new Set(currentMembers);
  const targetSet = new Set(targetSecurityIds);

  const added = targetSecurityIds.filter((id) => !currentSet.has(id));
  const removed = currentMembers.filter((id) => !targetSet.has(id));

  return {
    currentCount: currentMembers.length,
    targetCount: targetSecurityIds.length,
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    costNote:
      added.length === 0 && removed.length === 0
        ? 'No membership change. No effect on provider call volume.'
        : `${added.length} added, ${removed.length} removed. Reddit, Substack and market-data ` +
          'polling are flat-rate per D-15 and scale with universe size only marginally; X reads ' +
          'are spent on the price trigger, not on universe size, and are unaffected by this change.',
  };
}

async function computeImpactPreview(
  targetSecurityIds: readonly string[],
  current: LoadedCurrent | null,
  tx: Queryable,
): Promise<UniverseImpactPreview> {
  const currentMembers =
    current === null ? [] : await listUniverseMembers((current.snapshot as UniverseVersion).id, tx);
  return diffMembership(currentMembers, targetSecurityIds);
}

export const draftUniverseMutation: MutationDefinition<UniverseMutationInput> = {
  objectType: 'universe_version',
  action: 'universe.draft',
  environment: ADMIN_ENVIRONMENT,
  schema: universeMutationSchema,
  loadCurrent: (_input, tx) => loadCurrentUniverse(tx),
  impactPreview: (input, current, tx) => computeImpactPreview(input.targetSecurityIds, current, tx),
  write: async (input, _current, tx) => {
    const activeConfig = await findActiveConfigVersion(ADMIN_ENVIRONMENT, tx);
    if (activeConfig === null) {
      throw new Error(
        'No active config_version for this environment. A universe draft must reference one — ' +
          'seed a config_version before drafting a universe (F03 §4.3).',
      );
    }
    const draft = await insertUniverseVersion(
      {
        environment: ADMIN_ENVIRONMENT,
        configVersion: activeConfig.id,
        createdBy: 'admin',
        changeReason: input.reason,
        status: 'draft',
        selectionQuery: { targetSecurityIds: input.targetSecurityIds, selectionSource: input.selectionSource },
      },
      tx,
    );
    return { objectId: draft.id, afterValue: draft, rollbackTarget: null };
  },
};

export const activateUniverseMutation: MutationDefinition<
  UniverseMutationInput & { readonly draftVersionId: string }
> = {
  objectType: 'universe_version',
  action: 'universe.activate',
  environment: ADMIN_ENVIRONMENT,
  schema: universeMutationSchema.extend({ draftVersionId: z.string().regex(/^\d+$/) }),
  loadCurrent: (_input, tx) => loadCurrentUniverse(tx),
  impactPreview: (input, current, tx) => computeImpactPreview(input.targetSecurityIds, current, tx),
  write: async (input, current, _tx) => {
    // `activateUniverseVersion` (repositories/versions.ts) opens its own transaction and writes
    // its own atomic audit_event — it does not accept an external `tx`, so it is deliberately
    // *not* nested inside this mutation's outer transaction. See the module docstring for why
    // this pipeline's own step-8 audit write (below, via the outer transaction) still runs
    // rather than being special-cased away.
    const previousActiveId = current === null ? null : (current.snapshot as UniverseVersion).id;
    const activated = await activateUniverseVersion(
      ADMIN_ENVIRONMENT,
      input.draftVersionId,
      input.targetSecurityIds.map((securityId) => ({
        securityId,
        addedBy: 'admin',
        selectionSource: input.selectionSource,
      })),
      { actorId: 'admin', actorRole: 'admin', reason: input.reason, requestId: 'pipeline', correlationId: 'pipeline' },
    );
    return { objectId: activated.id, afterValue: activated, rollbackTarget: previousActiveId };
  },
};
