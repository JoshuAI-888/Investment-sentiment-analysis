/**
 * F15 §4.3/§5 — universe selector unit tests: the target-membership validator (cap, dedup,
 * non-empty) and the impact-preview arithmetic (`diffMembership`), both pure and DB-free.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { UNIVERSE_MAX_SYMBOLS } from '@/contracts/config';
import { diffMembership, universeMutationSchema } from '@/services/admin/universe';

function ids(n: number): string[] {
  return Array.from({ length: n }, () => randomUUID());
}

describe('universeMutationSchema — the 100-symbol cap and key-catalogue-style validation', () => {
  it('accepts a valid draft under the cap', () => {
    const result = universeMutationSchema.safeParse({
      reason: 'seed universe',
      expectedVersion: null,
      targetSecurityIds: ids(3),
      selectionSource: 'checkbox',
    });
    expect(result.success).toBe(true);
  });

  it('rejects exactly one symbol over the cap (DoD: hard cap of 100 active symbols, server-enforced)', () => {
    const result = universeMutationSchema.safeParse({
      reason: 'too many',
      expectedVersion: null,
      targetSecurityIds: ids(UNIVERSE_MAX_SYMBOLS + 1),
      selectionSource: 'bulk_filter',
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly the cap (boundary, not one under it)', () => {
    const result = universeMutationSchema.safeParse({
      reason: 'exactly at cap',
      expectedVersion: null,
      targetSecurityIds: ids(UNIVERSE_MAX_SYMBOLS),
      selectionSource: 'bulk_filter',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty target membership', () => {
    const result = universeMutationSchema.safeParse({
      reason: 'empty',
      expectedVersion: null,
      targetSecurityIds: [],
      selectionSource: 'checkbox',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate security id even when the count is under the cap', () => {
    const [one] = ids(1);
    const result = universeMutationSchema.safeParse({
      reason: 'dup',
      expectedVersion: null,
      targetSecurityIds: [one, one],
      selectionSource: 'checkbox',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid entry (an ineligible/malformed symbol is rejected with a stated reason)', () => {
    const result = universeMutationSchema.safeParse({
      reason: 'bad id',
      expectedVersion: null,
      targetSecurityIds: ['not-a-uuid'],
      selectionSource: 'checkbox',
    });
    expect(result.success).toBe(false);
  });
});

describe('diffMembership — impact-preview arithmetic', () => {
  it('the empty-set case: no current, no target', () => {
    const preview = diffMembership([], []);
    expect(preview).toMatchObject({ currentCount: 0, targetCount: 0, addedCount: 0, removedCount: 0 });
  });

  it('a from-scratch first activation: everything is added, nothing removed', () => {
    const target = ids(5);
    const preview = diffMembership([], target);
    expect(preview.addedCount).toBe(5);
    expect(preview.removedCount).toBe(0);
    expect(preview.added).toEqual(target);
  });

  it('an identical re-submission: zero added, zero removed, and says so', () => {
    const current = ids(3);
    const preview = diffMembership(current, current);
    expect(preview.addedCount).toBe(0);
    expect(preview.removedCount).toBe(0);
    expect(preview.costNote).toMatch(/No membership change/);
  });

  it('a genuine swap: added and removed sets are disjoint from the unchanged members', () => {
    const kept = ids(3);
    const removed = ids(2);
    const added = ids(2);
    const preview = diffMembership([...kept, ...removed], [...kept, ...added]);
    expect(preview.addedCount).toBe(2);
    expect(preview.removedCount).toBe(2);
    expect([...preview.added].sort()).toEqual([...added].sort());
    expect([...preview.removed].sort()).toEqual([...removed].sort());
  });

  it('X spend is never claimed to change with universe size (D-15)', () => {
    const preview = diffMembership(ids(1), ids(3));
    expect(preview.costNote).toMatch(/X reads are spent on the price trigger, not on universe size/);
    expect(preview.costNote).not.toMatch(/\$\d/); // no fabricated dollar figure
  });
});
