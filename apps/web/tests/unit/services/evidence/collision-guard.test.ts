import { describe, expect, it } from 'vitest';
import { FixtureModelBackend } from '@/services/evidence/model-client';
import { runCollisionGuard, type CollisionCandidate } from '@/services/evidence/collision-guard';
import { COLLISION_GUARD_METHOD } from '@/services/evidence/method-registry';

const CONTEXT = { symbol: 'AI', companyName: 'C3.ai, Inc.' };
const ALWAYS_ALLOWED = () => Promise.resolve({ allowed: true });

const candidates: CollisionCandidate[] = [
  { itemId: 'i1', text: 'C3.ai, Inc. announced a new AI platform release today', token: 'AI' },
  { itemId: 'i2', text: 'C3.ai the parking lot company held a fundraiser; also, AI is scary', token: 'AI' },
];

describe('runCollisionGuard — F10 §4.4 entity.collision_guard', () => {
  it('never calls the backend for an empty candidate list', async () => {
    const backend = new FixtureModelBackend([{ kind: 'throw' }]);
    const outcome = await runCollisionGuard([], CONTEXT, { backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED });
    expect(outcome.records).toHaveLength(0);
  });

  it('confirms a genuine reference and rejects a coincidental one', async () => {
    const backend = new FixtureModelBackend([
      {
        kind: 'json',
        body: [
          { itemId: 'i1', aboutSecurity: true, rationale: 'Explicitly about the AI platform' },
          { itemId: 'i2', aboutSecurity: false, rationale: 'Unrelated company, coincidental mention' },
        ],
      },
    ]);
    const outcome = await runCollisionGuard(candidates, CONTEXT, { backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED });
    expect(outcome.admitted.get('i1')).toMatchObject({ aboutSecurity: true });
    expect(outcome.admitted.get('i2')).toMatchObject({ aboutSecurity: false });
  });

  it('excludes rather than guesses when the backend is unavailable', async () => {
    const backend = new FixtureModelBackend([{ kind: 'throw' }]);
    const outcome = await runCollisionGuard(candidates, CONTEXT, { backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED });
    expect(outcome.admitted.size).toBe(0);
    expect(outcome.rejected.get('i1')).toMatch(/unavailable/);
  });

  it('stamps every attempt with the registered method id and version', async () => {
    const backend = new FixtureModelBackend([
      { kind: 'json', body: [{ itemId: 'i1', aboutSecurity: true, rationale: 'x' }, { itemId: 'i2', aboutSecurity: true, rationale: 'y' }] },
    ]);
    const outcome = await runCollisionGuard(candidates, CONTEXT, { backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED });
    expect(outcome.records[0]).toMatchObject({
      methodId: COLLISION_GUARD_METHOD.methodId,
      methodVersion: COLLISION_GUARD_METHOD.version,
    });
  });

  it('never calls the backend when the budget is denied (lane-review finding 4)', async () => {
    const backend = new FixtureModelBackend([{ kind: 'throw', message: 'must not be called' }]);
    const outcome = await runCollisionGuard(candidates, CONTEXT, {
      backend,
      model: 'test-model',
      checkBudget: () => Promise.resolve({ allowed: false, message: 'ceiling reached' }),
    });
    expect(outcome.admitted.size).toBe(0);
    expect(outcome.rejected.get('i1')).toMatch(/budget denied/);
  });
});
