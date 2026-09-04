import { describe, expect, it } from 'vitest';
import {
  ClassificationMethodRegistry,
  DuplicateClassificationMethod,
  EVIDENCE_METHOD_REGISTRY,
  RELEVANCE_FILTER_METHOD,
  COLLISION_GUARD_METHOD,
  DETERMINISTIC_CANDIDACY_METHOD,
} from '@/services/evidence/method-registry';

describe('EVIDENCE_METHOD_REGISTRY — D-21', () => {
  it('registers the two v1 LLM methods named by D-21, plus the deterministic sentinel', () => {
    expect(EVIDENCE_METHOD_REGISTRY.all().map((e) => e.methodId).sort()).toEqual([
      'candidacy.deterministic',
      'entity.collision_guard',
      'relevance.filter',
    ]);
  });

  it('finds each by exact id and version', () => {
    expect(EVIDENCE_METHOD_REGISTRY.get('relevance.filter', '1.0.0')).toBe(RELEVANCE_FILTER_METHOD);
    expect(EVIDENCE_METHOD_REGISTRY.get('entity.collision_guard', '1.0.0')).toBe(COLLISION_GUARD_METHOD);
    expect(EVIDENCE_METHOD_REGISTRY.get('candidacy.deterministic', '1.0.0')).toBe(DETERMINISTIC_CANDIDACY_METHOD);
  });

  it('resolves the latest version of a method', () => {
    expect(EVIDENCE_METHOD_REGISTRY.latest('relevance.filter').version).toBe('1.0.0');
  });

  it('both LLM methods are pinned to temperature 0 and the AI_MODEL_FAST route (D-34)', () => {
    for (const entry of [RELEVANCE_FILTER_METHOD, COLLISION_GUARD_METHOD]) {
      expect(entry.temperature).toBe(0);
      expect(entry.route).toBe('AI_MODEL_FAST');
    }
  });

  it('the deterministic sentinel carries no LLM route, prompt version or temperature — it never calls a model', () => {
    expect(DETERMINISTIC_CANDIDACY_METHOD.route).toBeNull();
    expect(DETERMINISTIC_CANDIDACY_METHOD.promptVersion).toBeNull();
    expect(DETERMINISTIC_CANDIDACY_METHOD.temperature).toBeNull();
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
