import { describe, expect, it } from 'vitest';

import type { RniOrchestrationTransaction } from '@/rni/orchestration/types';
import {
  PostgresRniSourceWorkflowCheckpointRepository,
  rniSourceWorkflowOutputManifestV2,
} from '@/rni/repositories/source-workflow-checkpoints';
import { rniSourceWorkflowDeliveryV2 } from '@/rni/workflow/checkpoint';

const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hash = (character: string): string => character.repeat(64);

const delivery = rniSourceWorkflowDeliveryV2.parse({
  version: 'rni-source-workflow-delivery-v2',
  subject: {
    version: 'rni-source-workflow-subject-v2',
    runId: uuid(1),
    planHash: hash('a'),
    runManifestHash: hash('b'),
    platform: 'reddit',
    outerAttempt: 1,
    outerToken: uuid(2),
    deadline: '2026-09-05T00:20:00.000Z',
    workflowPolicy: { leaseMs: 60_000, baseBackoffMs: 1_000, maxBackoffMs: 2_000 },
    sourceItemId: uuid(3),
    retrievalId: uuid(4),
    contentVersionId: uuid(5),
    outboxEventId: uuid(6),
    stage: 'interpret_source',
    stageVersion: 'rni-interpret-source-v2',
  },
  inputHash: hash('c'),
});

const inactiveTransaction = {} as RniOrchestrationTransaction;

describe('D-RNI-34 source workflow checkpoint repository boundary', () => {
  it('requires the exact manifest-bound output identity', () => {
    const manifest = {
      version: 'rni-source-workflow-output-v2',
      runId: delivery.subject.runId,
      runManifestHash: delivery.subject.runManifestHash,
      platform: delivery.subject.platform,
      sourceItemId: delivery.subject.sourceItemId,
      retrievalId: delivery.subject.retrievalId,
      contentVersionId: delivery.subject.contentVersionId,
      outboxEventId: delivery.subject.outboxEventId,
      semanticOutputHash: hash('d'),
    } as const;
    expect(rniSourceWorkflowOutputManifestV2.parse(manifest)).toEqual(manifest);
    expect(() =>
      rniSourceWorkflowOutputManifestV2.parse({ ...manifest, runManifestHash: 'not-a-hash' }),
    ).toThrow();
    expect(() => rniSourceWorkflowOutputManifestV2.parse({ ...manifest, extra: true })).toThrow();
  });

  it('cannot be used outside the caller-owned active orchestration transaction', async () => {
    const repository = new PostgresRniSourceWorkflowCheckpointRepository();
    await expect(repository.load('test', delivery, inactiveTransaction)).rejects.toThrow(
      'STALE_EXECUTION',
    );
  });
});
