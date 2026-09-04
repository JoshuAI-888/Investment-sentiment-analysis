/**
 * F15 §4.1 — the uniform admin mutation contract, built once as a reusable pipeline every
 * mutation goes through, rather than copy-pasted per surface:
 *
 *   1. authorize            — asserted here (defense in depth); the caller's route/action MUST
 *                              already have called `requireAdmin()` in its own body (F02 §4.4).
 *   2. validate              — zod, via `def.schema`. `reason` and `expectedVersion` are on
 *                              every mutation's input because every mutation needs them.
 *   3. optimistic-concurrency — `def.loadCurrent` reads the entity's current version inside the
 *                              transaction; a mismatch against `input.expectedVersion` throws
 *                              `AdminMutationConflictError` with a diff, never a silent overwrite.
 *   4. dry-run impact preview — `def.impactPreview`, computed from the same read, before anything
 *                              is written.
 *   5. capture reason        — already on validated `input.reason`; nothing to do here but not
 *                              skip it, which is why the schema, not this file, enforces it.
 *   6/7. write + activate    — `def.write`, one transaction (the same one steps 3–4 ran in).
 *   8. audit_event           — written in the same transaction as the write, so an audited
 *                              mutation and a persisted one are the same fact, never two.
 *
 * Then, once the transaction has committed: cache invalidation (best-effort, does not roll back
 * a successful write if it fails) and the rollback target are returned to the caller.
 *
 * **Every step above is unconditional** — there is no branch in this file that skips one for a
 * particular mutation. What varies per mutation is *what* is read, previewed, written and
 * invalidated (`def`), never *whether* the step runs. `tests/unit/admin/mutation-pipeline.test.ts`
 * asserts this generically, against a synthetic definition and a fake transaction/audit writer,
 * and `tests/unit/admin/registry.test.ts` asserts every registered mutation supplies all four
 * required callbacks.
 */
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Session } from '@/services/auth';
import { withTransaction as withTransactionReal, type Queryable } from '@/repositories/client';
import { insertAuditEvent as insertAuditEventReal, type NewAuditEvent } from '@/repositories/audit';
import type { AuditEvent } from '@/contracts/cost';
import { AdminMutationConflictError } from './errors';

/** Every mutation's input carries these two fields, whatever else it needs. */
export type AdminMutationBase = {
  readonly reason: string;
  /** `null` means "I believe nothing exists yet" — the correct expectation for a first write. */
  readonly expectedVersion: string | null;
};

export type LoadedCurrent = {
  readonly objectId: string;
  readonly version: string | null;
  readonly snapshot: unknown;
};

export type MutationDefinition<TInput extends AdminMutationBase> = {
  /** `audit_event.object_type`. */
  readonly objectType: string;
  /** `audit_event.action`. */
  readonly action: string;
  readonly environment: string;
  /** Step 2. */
  readonly schema: z.ZodType<TInput>;
  /**
   * Step 3's read. Returns `null` when no prior version of this object exists at all (a
   * from-scratch draft is legal only when `input.expectedVersion` is also `null`).
   */
  readonly loadCurrent: (input: TInput, tx: Queryable) => Promise<LoadedCurrent | null>;
  /** Step 4. Pure read; must not write. */
  readonly impactPreview: (
    input: TInput,
    current: LoadedCurrent | null,
    tx: Queryable,
  ) => Promise<Record<string, unknown>>;
  /** Steps 6–7, inside the same transaction as 3–4. */
  readonly write: (
    input: TInput,
    current: LoadedCurrent | null,
    tx: Queryable,
  ) => Promise<{
    readonly objectId: string;
    readonly afterValue: unknown;
    /** The version an operator can reactivate to undo this mutation, or `null` if none exists. */
    readonly rollbackTarget: string | null;
  }>;
  /** Runs after commit. Best-effort — a failure here is logged, never rolls back the write. */
  readonly invalidateCache?: (input: TInput) => Promise<void> | void;
};

export type MutationRequestMeta = {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly ipHash?: string | null;
  readonly userAgent?: string | null;
};

export type MutationOutcome =
  | {
      readonly ok: true;
      readonly objectId: string;
      readonly rollbackTarget: string | null;
      readonly impactPreview: Record<string, unknown>;
      readonly auditEventId: string;
    }
  | { readonly ok: false; readonly kind: 'validation'; readonly issues: z.ZodIssue[] }
  | {
      readonly ok: false;
      readonly kind: 'conflict';
      readonly objectId: string | null;
      readonly diff: { readonly expected: unknown; readonly actual: unknown };
      readonly message: string;
    };

/** Injectable so the orchestration can be unit-tested with a fake transaction and audit writer. */
export type MutationDeps = {
  readonly withTransaction: typeof withTransactionReal;
  readonly insertAuditEvent: (event: NewAuditEvent, db?: Queryable) => Promise<AuditEvent>;
};

const defaultDeps: MutationDeps = {
  withTransaction: withTransactionReal,
  insertAuditEvent: insertAuditEventReal,
};

/** A session as `requireAdmin()` returns it. Re-asserted here, never trusted from a raw object. */
function assertAuthorized(session: Session): void {
  if (session === null || session === undefined || typeof session.userId !== 'string' || session.userId.length === 0) {
    throw new Error(
      'runAdminMutation was called without an authorized session. Every call site must call ' +
        'requireAdmin() in its own body first (F02 §4.4) — this is the defense-in-depth check, ' +
        'not the authorization itself.',
    );
  }
}

export async function runAdminMutation<TInput extends AdminMutationBase>(
  def: MutationDefinition<TInput>,
  rawInput: unknown,
  session: Session,
  meta: MutationRequestMeta = {},
  deps: MutationDeps = defaultDeps,
): Promise<MutationOutcome> {
  // ── Step 1 — authorize (defense in depth) ──────────────────────────────────────────────────
  assertAuthorized(session);

  // ── Step 2 — validate ───────────────────────────────────────────────────────────────────────
  const parsed = def.schema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, kind: 'validation', issues: parsed.error.issues };
  }
  const input = parsed.data;

  const requestId = meta.requestId ?? randomUUID();
  const correlationId = meta.correlationId ?? requestId;

  try {
    const committed = await deps.withTransaction(async (tx) => {
      // ── Step 3 — optimistic concurrency ───────────────────────────────────────────────────
      const current = await def.loadCurrent(input, tx);
      const currentVersion = current?.version ?? null;
      if (currentVersion !== input.expectedVersion) {
        throw new AdminMutationConflictError(
          `${def.objectType} has changed since it was read (expected version ` +
            `${JSON.stringify(input.expectedVersion)}, found ${JSON.stringify(currentVersion)}). ` +
            `Reload and reapply your change.`,
          { objectId: current?.objectId ?? null, expected: input.expectedVersion, actual: current?.snapshot ?? null },
        );
      }

      // ── Step 4 — dry-run impact preview ───────────────────────────────────────────────────
      const impactPreview = await def.impactPreview(input, current, tx);

      // ── Step 5 — capture reason ────────────────────────────────────────────────────────────
      // `input.reason` was already required and non-empty by `def.schema` (step 2). Nothing to
      // do here but not skip it — which is why it is validated, not merely typed.
      const reason = input.reason;

      // ── Steps 6–7 — write the new version and activate it, same transaction ──────────────
      const written = await def.write(input, current, tx);

      // ── Step 8 — audit_event, same transaction ─────────────────────────────────────────────
      const audit = await deps.insertAuditEvent(
        {
          actorId: session.userId,
          actorRole: 'admin',
          action: def.action,
          objectType: def.objectType,
          objectId: written.objectId,
          environment: def.environment,
          reason,
          beforeValue: current?.snapshot ?? null,
          afterValue: written.afterValue,
          result: 'success',
          requestId,
          correlationId,
          ipHash: meta.ipHash ?? null,
          userAgent: meta.userAgent ?? null,
          approval: null,
          rollbackOf: null,
        },
        tx,
      );

      return {
        objectId: written.objectId,
        rollbackTarget: written.rollbackTarget,
        impactPreview,
        auditEventId: audit.id,
      };
    });

    // ── Step 9 — invalidate cache, after commit, best-effort ────────────────────────────────
    if (def.invalidateCache !== undefined) {
      try {
        await def.invalidateCache(input);
      } catch (error) {
        console.error(`admin mutation ${def.objectType}/${def.action}: cache invalidation failed`, error);
      }
    }

    // ── Return the rollback target ──────────────────────────────────────────────────────────
    return { ok: true, ...committed };
  } catch (error) {
    if (error instanceof AdminMutationConflictError) {
      // A rejected write is itself something an operator should be able to see happened — best
      // effort, outside the transaction that just rolled back.
      await deps
        .insertAuditEvent({
          actorId: session.userId,
          actorRole: 'admin',
          action: def.action,
          objectType: def.objectType,
          objectId: error.objectId ?? 'unknown',
          environment: def.environment,
          reason: input.reason,
          beforeValue: error.diff.actual,
          afterValue: null,
          result: 'rejected',
          requestId,
          correlationId,
          ipHash: meta.ipHash ?? null,
          userAgent: meta.userAgent ?? null,
          approval: null,
          rollbackOf: null,
        })
        .catch(() => undefined);

      return {
        ok: false,
        kind: 'conflict',
        objectId: error.objectId,
        diff: error.diff,
        message: error.message,
      };
    }
    throw error;
  }
}
