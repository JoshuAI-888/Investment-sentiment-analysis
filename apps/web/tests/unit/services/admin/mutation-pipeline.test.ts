/**
 * F15 §4.1/§5 — the uniform mutation contract's orchestration, tested against a synthetic
 * `MutationDefinition` and fake `withTransaction`/`insertAuditEvent` dependencies. No database
 * needed: what is under test is step *order* and step *unconditionality*, not any one
 * repository's SQL. Real per-mutation DB behaviour (constraint enforcement, activation
 * transactions) is covered by `tests/integration/*` and `tests/contract/admin-mutations.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Session } from '@/services/auth';
import { runAdminMutation, type MutationDefinition, type MutationDeps } from '@/services/admin/mutation';
import { AdminMutationConflictError } from '@/services/admin/errors';

const SESSION: Session = {
  userId: 'admin-1',
  email: 'admin@example.com',
  sessionId: 'sess-1',
  expiresAt: new Date().toISOString(),
  mustChangePassword: false,
};

const schema = z.object({
  reason: z.string().min(3),
  expectedVersion: z.string().nullable(),
  value: z.number(),
});
type Input = z.infer<typeof schema>;

function makeDeps(): MutationDeps & { calls: string[] } {
  const calls: string[] = [];
  const fakeTx = { query: () => Promise.reject(new Error('this fake transaction never queries')) };
  const withTransaction: MutationDeps['withTransaction'] = async (fn) => {
    calls.push('transaction:start');
    const result = await fn(fakeTx as unknown as Parameters<typeof fn>[0]);
    calls.push('transaction:commit');
    return result;
  };
  const insertAuditEvent: MutationDeps['insertAuditEvent'] = async (event) => {
    calls.push(`audit:${event.action}:${event.result}`);
    return {
      id: 'audit-1',
      occurredAt: new Date(),
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      objectType: event.objectType,
      objectId: event.objectId,
      environment: event.environment,
      reason: event.reason,
      beforeValue: event.beforeValue ?? null,
      afterValue: event.afterValue ?? null,
      result: event.result,
      requestId: event.requestId,
      correlationId: event.correlationId,
      ipHash: null,
      userAgent: null,
      approval: null,
      rollbackOf: null,
    };
  };
  return { calls, withTransaction, insertAuditEvent };
}

function makeDefinition(overrides: Partial<MutationDefinition<Input>> = {}, calls: string[]): MutationDefinition<Input> {
  return {
    objectType: 'widget',
    action: 'widget.update',
    environment: 'test',
    schema,
    loadCurrent: async () => {
      calls.push('loadCurrent');
      return { objectId: 'widget-1', version: 'v1', snapshot: { value: 1 } };
    },
    impactPreview: async () => {
      calls.push('impactPreview');
      return { delta: 1 };
    },
    write: async () => {
      calls.push('write');
      return { objectId: 'widget-1', afterValue: { value: 2 }, rollbackTarget: 'v1' };
    },
    invalidateCache: async () => {
      calls.push('invalidateCache');
    },
    ...overrides,
  };
}

describe('runAdminMutation — the eight-step pipeline', () => {
  it('runs every step, in order, for a valid mutation with a matching version', async () => {
    const deps = makeDeps();
    const orderedCalls: string[] = [];
    const def = makeDefinition({}, orderedCalls);

    const outcome = await runAdminMutation(
      def,
      { reason: 'because', expectedVersion: 'v1', value: 2 },
      SESSION,
      {},
      deps,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.objectId).toBe('widget-1');
    expect(outcome.rollbackTarget).toBe('v1');
    expect(outcome.impactPreview).toEqual({ delta: 1 });

    // Step order: transaction opens, loadCurrent (3), impactPreview (4), write (6-7),
    // audit (8) inside the transaction, transaction commits, then invalidateCache (9).
    expect(deps.calls[0]).toBe('transaction:start');
    expect(orderedCalls).toEqual(['loadCurrent', 'impactPreview', 'write', 'invalidateCache']);
    expect(deps.calls).toContain('audit:widget.update:success');
    expect(deps.calls.indexOf('transaction:commit')).toBeGreaterThan(deps.calls.indexOf('audit:widget.update:success'));
  });

  it('step 1 — rejects a call with no authorized session before touching the transaction', async () => {
    const deps = makeDeps();
    const def = makeDefinition({}, []);

    await expect(
      runAdminMutation(def, { reason: 'because', expectedVersion: 'v1', value: 2 }, null as unknown as Session, {}, deps),
    ).rejects.toThrow(/authorized session/);
    expect(deps.calls).toHaveLength(0);
  });

  it('step 2 — a schema-invalid input is rejected before any read, write or audit', async () => {
    const deps = makeDeps();
    const orderedCalls: string[] = [];
    const def = makeDefinition({}, orderedCalls);

    const outcome = await runAdminMutation(def, { reason: 'x', expectedVersion: 'v1', value: 2 }, SESSION, {}, deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected invalid');
    expect(outcome.kind).toBe('validation');
    expect(deps.calls).toHaveLength(0);
    expect(orderedCalls).toHaveLength(0);
  });

  it('step 3 — a version mismatch returns a conflict with a diff and never calls write', async () => {
    const deps = makeDeps();
    const orderedCalls: string[] = [];
    const def = makeDefinition({}, orderedCalls);

    const outcome = await runAdminMutation(
      def,
      { reason: 'because', expectedVersion: 'stale-version', value: 2 },
      SESSION,
      {},
      deps,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'conflict') throw new Error('expected conflict');
    expect(outcome.diff.expected).toBe('stale-version');
    expect(outcome.diff.actual).toEqual({ value: 1 });
    expect(orderedCalls).toEqual(['loadCurrent']); // never reached impactPreview or write
    expect(deps.calls).toContain('audit:widget.update:rejected');
  });

  it('step 3 — first-ever version (expectedVersion null, no current row) is not a conflict', async () => {
    const deps = makeDeps();
    const orderedCalls: string[] = [];
    const def = makeDefinition({ loadCurrent: async () => null }, orderedCalls);

    const outcome = await runAdminMutation(
      def,
      { reason: 'because', expectedVersion: null, value: 2 },
      SESSION,
      {},
      deps,
    );

    expect(outcome.ok).toBe(true);
  });

  it('a genuine race the app-level check missed (caught inside write) still surfaces as a conflict, never a silent overwrite', async () => {
    const deps = makeDeps();
    const orderedCalls: string[] = [];
    const def = makeDefinition(
      {
        write: async () => {
          orderedCalls.push('write');
          throw new AdminMutationConflictError('activated by someone else meanwhile', {
            objectId: 'widget-1',
            expected: 'v1',
            actual: { value: 99 },
          });
        },
      },
      orderedCalls,
    );

    const outcome = await runAdminMutation(
      def,
      { reason: 'because', expectedVersion: 'v1', value: 2 },
      SESSION,
      {},
      deps,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected conflict');
    expect(outcome.kind).toBe('conflict');
    expect(deps.calls).toContain('audit:widget.update:rejected');
  });

  it('invalidateCache failing does not roll back an already-committed, successful mutation', async () => {
    const deps = makeDeps();
    const orderedCalls: string[] = [];
    const def = makeDefinition(
      {
        invalidateCache: async () => {
          orderedCalls.push('invalidateCache');
          throw new Error('redis unreachable');
        },
      },
      orderedCalls,
    );

    const outcome = await runAdminMutation(
      def,
      { reason: 'because', expectedVersion: 'v1', value: 2 },
      SESSION,
      {},
      deps,
    );

    expect(outcome.ok).toBe(true);
  });

  it('a mutation with no invalidateCache callback still completes (step 9 is optional per-mutation, never skipped silently when present)', async () => {
    const deps = makeDeps();
    const orderedCalls: string[] = [];
    const { invalidateCache: _omit, ...withoutCache } = makeDefinition({}, orderedCalls);
    const def: MutationDefinition<Input> = withoutCache;

    const outcome = await runAdminMutation(
      def,
      { reason: 'because', expectedVersion: 'v1', value: 2 },
      SESSION,
      {},
      deps,
    );

    expect(outcome.ok).toBe(true);
    expect(orderedCalls).not.toContain('invalidateCache');
  });
});

describe('AdminMutationConflictError', () => {
  it('carries the object id and the expected/actual diff', () => {
    const error = new AdminMutationConflictError('conflict', { objectId: 'x', expected: 1, actual: 2 });
    expect(error.objectId).toBe('x');
    expect(error.diff).toEqual({ expected: 1, actual: 2 });
    expect(error.name).toBe('AdminMutationConflictError');
  });
});
