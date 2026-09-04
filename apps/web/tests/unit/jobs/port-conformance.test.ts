import { describe, it } from 'vitest';
import { assertScorerHealthPortContract, assertScoringQueuePortContract } from './port-conformance';
import { fakeHealth, fakeQueue, type Trace } from './fakes';

/**
 * Runs the port contract against the in-memory fake.
 *
 * The value is not that the fake passes — it did before this file existed. It is that the rules
 * now live somewhere a real implementation can be pointed at, so that when SPINE writes
 * `repositories/scorer-health.ts` the same six assertions run against it unchanged. Until then
 * this at least keeps the fake honest, and keeps the rules from drifting away from the doc
 * comment that states them.
 */
describe('ScorerHealthPort — the contract every implementation must satisfy', () => {
  it('is satisfied by the in-memory fake', async () => {
    await assertScorerHealthPortContract(() => {
      const trace: Trace = [];
      return fakeHealth(trace).port;
    });
  });
});

/**
 * lane-review found this suite missing: `enqueue` idempotency and `release`'s order-preservation
 * were binding doc-comment rules with no executable form, enforced only by whichever fake
 * happened to implement them correctly.
 */
describe('ScoringQueuePort — the contract every implementation must satisfy', () => {
  it('is satisfied by the in-memory fake', async () => {
    await assertScoringQueuePortContract(() => {
      const trace: Trace = [];
      return fakeQueue(trace).port;
    });
  });
});
