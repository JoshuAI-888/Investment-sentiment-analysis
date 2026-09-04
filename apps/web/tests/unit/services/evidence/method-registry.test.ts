import { describe, expect, it } from 'vitest';
import {
  ClassificationMethodRegistry,
  DuplicateClassificationMethod,
  EVIDENCE_METHOD_REGISTRY,
  RELEVANCE_FILTER_METHOD,
  COLLISION_GUARD_METHOD,
} from '@/services/evidence/method-registry';

describe('EVIDENCE_METHOD_REGISTRY — D-21', () => {
  it('registers exactly the two v1 LLM methods named by D-21', () => {
    expect(EVIDENCE_METHOD_REGISTRY.all().map((e) => e.methodId).sort()).toEqual([
      'entity.collision_guard',
      'relevance.filter',
    ]);
  });

  it('finds each by exact id and version', () => {
    expect(EVIDENCE_METHOD_REGISTRY.get('relevance.filter', '1.0.0')).toBe(RELEVANCE_FILTER_METHOD);
    expect(EVIDENCE_METHOD_REGISTRY.get('entity.collision_guard', '1.0.0')).toBe(COLLISION_GUARD_METHOD);
  });

  it('resolves the latest version of a method', () => {
    expect(EVIDENCE_METHOD_REGISTRY.latest('relevance.filter').version).toBe('1.0.0');
  });

  it('both methods are pinned to temperature 0 and the AI_MODEL_FAST route (D-34)', () => {
    for (const entry of EVIDENCE_METHOD_REGISTRY.all()) {
      expect(entry.temperature).toBe(0);
      expect(entry.route).toBe('AI_MODEL_FAST');
    }
  });

  it('throws on a duplicate methodId@version registration', () => {
    expect(
      () => new ClassificationMethodRegistry([RELEVANCE_FILTER_METHOD, RELEVANCE_FILTER_METHOD]),
    ).toThrow(DuplicateClassificationMethod);
  });

  it('throws a named error for an unregistered method', () => {
    expect(() => EVIDENCE_METHOD_REGISTRY.get('not.a.method', '1.0.0')).toThrow(
      /No registered classification method/,
    );
  });
});
