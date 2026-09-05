import { describe, expect, it } from 'vitest';
import {
  RniSourceWorkflowCheckpointError,
  claimRniSourceWorkflowCheckpoint,
  completeRniSourceWorkflowCheckpoint,
  failRniSourceWorkflowCheckpoint,
  heartbeatRniSourceWorkflowCheckpoint,
  retryRniSourceWorkflowCheckpoint,
  rniSourceWorkflowCheckpointV2,
  rniSourceWorkflowDeliveryV2,
  rniSourceWorkflowSubjectV2,
  stopRniSourceWorkflowForBudget,
  type RniSourceWorkflowAuthorityV2,
  type RniSourceWorkflowCheckpointErrorCode,
  type RniSourceWorkflowCheckpointV2,
  type RniSourceWorkflowDeliveryV2,
  type RniSourceWorkflowSubjectV2,
} from '@/rni/workflow/checkpoint';

const ids = {
  run: '00000000-0000-4000-8000-000000000101',
  outerToken: '00000000-0000-4000-8000-000000000102',
  source: '00000000-0000-4000-8000-000000000103',
  retrieval: '00000000-0000-4000-8000-000000000104',
  contentVersion: '00000000-0000-4000-8000-000000000105',
  outbox: '00000000-0000-4000-8000-000000000106',
  leaseOne: '00000000-0000-4000-8000-000000000107',
  leaseTwo: '00000000-0000-4000-8000-000000000108',
  leaseThree: '00000000-0000-4000-8000-000000000109',
};

const hashes = {
  plan: 'a'.repeat(64),
  input: 'b'.repeat(64),
  output: 'c'.repeat(64),
  changed: 'd'.repeat(64),
};

const baseTime = {
  acquired: '2026-09-05T00:00:00.000Z',
  firstClaim: '2026-09-05T00:01:00.000Z',
  outerExpiry: '2026-09-05T00:10:00.000Z',
  deadline: '2026-09-05T00:20:00.000Z',
};

const baseWorkflowPolicy = {
  leaseMs: 60_000,
  baseBackoffMs: 1_000,
  maxBackoffMs: 1_500,
} as const;

function subject(overrides: Partial<RniSourceWorkflowSubjectV2> = {}): RniSourceWorkflowSubjectV2 {
  return rniSourceWorkflowSubjectV2.parse({
    version: 'rni-source-workflow-subject-v2',
    runId: ids.run,
    planHash: hashes.plan,
    platform: 'reddit',
    outerAttempt: 1,
    outerToken: ids.outerToken,
    deadline: baseTime.deadline,
    workflowPolicy: baseWorkflowPolicy,
    sourceItemId: ids.source,
    retrievalId: ids.retrieval,
    contentVersionId: ids.contentVersion,
    outboxEventId: ids.outbox,
    stage: 'interpret_source',
    stageVersion: 'rni-interpret-source-v2',
    ...overrides,
  });
}

function delivery(subjectInput = subject(), inputHash = hashes.input): RniSourceWorkflowDeliveryV2 {
  return rniSourceWorkflowDeliveryV2.parse({
    version: 'rni-source-workflow-delivery-v2',
    subject: subjectInput,
    inputHash,
  });
}

function authority(
  subjectInput = subject(),
  overrides: Partial<RniSourceWorkflowAuthorityV2> = {},
): RniSourceWorkflowAuthorityV2 {
  return {
    runId: subjectInput.runId,
    planHash: subjectInput.planHash,
    platform: subjectInput.platform,
    outerAttempt: subjectInput.outerAttempt,
    outerToken: subjectInput.outerToken,
    deadline: subjectInput.deadline,
    workflowPolicy: subjectInput.workflowPolicy,
    outerLease: {
      acquiredAt: baseTime.acquired,
      expiresAt: baseTime.outerExpiry,
    },
    ...overrides,
  };
}

function claimInput(
  deliveryInput = delivery(),
  overrides: Partial<Parameters<typeof claimRniSourceWorkflowCheckpoint>[1]> = {},
): Parameters<typeof claimRniSourceWorkflowCheckpoint>[1] {
  return {
    delivery: deliveryInput,
    authority: authority(deliveryInput.subject),
    at: baseTime.firstClaim,
    leaseOwner: 'worker-one',
    leaseToken: ids.leaseOne,
    leaseMs: deliveryInput.subject.workflowPolicy.leaseMs,
    ...overrides,
  };
}

function acquired(input = claimInput()): RniSourceWorkflowCheckpointV2 {
  const result = claimRniSourceWorkflowCheckpoint(null, input);
  expect(result.kind).toBe('acquired');
  if (result.kind !== 'acquired') throw new Error('Expected an acquired test checkpoint');
  return result.checkpoint;
}

function mutationInput(
  checkpoint: RniSourceWorkflowCheckpointV2,
  overrides: Partial<{
    authority: RniSourceWorkflowAuthorityV2;
    at: string;
    leaseOwner: string;
    leaseToken: string;
  }> = {},
) {
  if (checkpoint.lease === null) throw new Error('Expected a leased test checkpoint');
  return {
    authority: authority(checkpoint.delivery.subject),
    at: '2026-09-05T00:01:30.000Z',
    leaseOwner: checkpoint.lease.owner,
    leaseToken: checkpoint.lease.token,
    ...overrides,
  };
}

function expectCheckpointError(
  operation: () => unknown,
  code: RniSourceWorkflowCheckpointErrorCode,
): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RniSourceWorkflowCheckpointError);
    expect((error as RniSourceWorkflowCheckpointError).code).toBe(code);
  }
}

describe('D-RNI-34 source workflow checkpoint', () => {
  it('uses strict v2 subject, delivery and checkpoint schemas', () => {
    expect(() => rniSourceWorkflowSubjectV2.parse({ ...subject(), extra: true })).toThrow();
    expect(() => rniSourceWorkflowDeliveryV2.parse({ ...delivery(), extra: true })).toThrow();
    expect(() =>
      rniSourceWorkflowSubjectV2.parse({
        ...subject(),
        deadline: '2026-09-05T00:20:00.000001Z',
      }),
    ).toThrow('exact millisecond precision');

    const checkpoint = acquired();
    expect(() => rniSourceWorkflowCheckpointV2.parse({ ...checkpoint, extra: true })).toThrow();
    expect(() =>
      rniSourceWorkflowCheckpointV2.parse({
        ...checkpoint,
        status: 'completed',
        lease: null,
        outputHash: null,
        completedAt: null,
      }),
    ).toThrow();
  });

  it('claims once, reports busy, and recovers an expired source lease', () => {
    const first = acquired();
    expect(first).toMatchObject({
      status: 'running',
      attempt: 1,
      lease: {
        owner: 'worker-one',
        token: ids.leaseOne,
        acquiredAt: baseTime.firstClaim,
        expiresAt: '2026-09-05T00:02:00.000Z',
      },
    });

    const busy = claimRniSourceWorkflowCheckpoint(
      first,
      claimInput(first.delivery, {
        at: '2026-09-05T00:01:59.999Z',
        leaseOwner: 'worker-two',
        leaseToken: ids.leaseTwo,
      }),
    );
    expect(busy).toMatchObject({ kind: 'busy', retryAt: '2026-09-05T00:02:00.000Z' });

    const recovered = claimRniSourceWorkflowCheckpoint(
      first,
      claimInput(first.delivery, {
        at: '2026-09-05T00:02:00.000Z',
        leaseOwner: 'worker-two',
        leaseToken: ids.leaseTwo,
      }),
    );
    expect(recovered).toMatchObject({
      kind: 'acquired',
      checkpoint: {
        attempt: 2,
        startedAt: baseTime.firstClaim,
        lease: { owner: 'worker-two', token: ids.leaseTwo },
      },
    });
  });

  it('heartbeats only the current source lease and never extends beyond parent authority', () => {
    const checkpoint = acquired();
    const heartbeat = heartbeatRniSourceWorkflowCheckpoint(checkpoint, {
      ...mutationInput(checkpoint),
      leaseMs: 60_000,
    });
    expect(heartbeat.lease?.expiresAt).toBe('2026-09-05T00:02:30.000Z');
    expect(heartbeat.lease?.acquiredAt).toBe(baseTime.firstClaim);

    expectCheckpointError(
      () =>
        heartbeatRniSourceWorkflowCheckpoint(checkpoint, {
          ...mutationInput(checkpoint),
          leaseToken: ids.leaseTwo,
          leaseMs: 60_000,
        }),
      'STALE_LEASE',
    );
    expectCheckpointError(
      () =>
        heartbeatRniSourceWorkflowCheckpoint(checkpoint, {
          ...mutationInput(checkpoint, { at: '2026-09-05T00:00:59.000Z' }),
          leaseMs: 60_000,
        }),
      'TIME_REGRESSION',
    );

    const nearBoundary = acquired(
      claimInput(delivery(), {
        at: '2026-09-05T00:09:00.000Z',
        leaseMs: 60_000,
      }),
    );
    expect(nearBoundary.lease?.expiresAt).toBe(baseTime.outerExpiry);
  });

  it('schedules deterministic bounded exponential retry and enforces not-before', () => {
    const first = acquired();
    const retry = retryRniSourceWorkflowCheckpoint(first, {
      ...mutationInput(first),
      errorCode: 'PROVIDER_TIMEOUT',
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_500,
    });
    expect(retry).toMatchObject({
      kind: 'scheduled',
      checkpoint: {
        status: 'retry_wait',
        attempt: 1,
        notBefore: '2026-09-05T00:01:31.000Z',
        retry: { errorCode: 'PROVIDER_TIMEOUT', delayMs: 1_000 },
      },
    });
    if (retry.kind !== 'scheduled') throw new Error('Expected scheduled retry');

    const exactReplay = retryRniSourceWorkflowCheckpoint(retry.checkpoint, {
      ...mutationInput(first),
      errorCode: 'PROVIDER_TIMEOUT',
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_500,
    });
    expect(exactReplay).toEqual(retry);

    const deferred = claimRniSourceWorkflowCheckpoint(
      retry.checkpoint,
      claimInput(retry.checkpoint.delivery, {
        at: '2026-09-05T00:01:30.999Z',
        leaseToken: ids.leaseTwo,
      }),
    );
    expect(deferred).toMatchObject({
      kind: 'deferred',
      retryAt: '2026-09-05T00:01:31.000Z',
    });

    const second = claimRniSourceWorkflowCheckpoint(
      retry.checkpoint,
      claimInput(retry.checkpoint.delivery, {
        at: '2026-09-05T00:01:31.000Z',
        leaseToken: ids.leaseTwo,
      }),
    );
    expect(second).toMatchObject({ kind: 'acquired', checkpoint: { attempt: 2 } });
    if (second.kind !== 'acquired') throw new Error('Expected second attempt');

    const secondRetry = retryRniSourceWorkflowCheckpoint(second.checkpoint, {
      ...mutationInput(second.checkpoint, { at: '2026-09-05T00:01:40.000Z' }),
      errorCode: 'PROVIDER_TIMEOUT',
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_500,
    });
    expect(secondRetry).toMatchObject({
      kind: 'scheduled',
      checkpoint: { retry: { delayMs: 1_500 }, notBefore: '2026-09-05T00:01:41.500Z' },
    });
    if (secondRetry.kind !== 'scheduled') throw new Error('Expected second scheduled retry');
    expect(() =>
      rniSourceWorkflowCheckpointV2.parse({
        ...secondRetry.checkpoint,
        notBefore: '2026-09-05T00:01:41.501Z',
      }),
    ).toThrow('exactly equal failure time plus delay');
  });

  it('binds lease and retry timing to immutable parent-authority policy', () => {
    expectCheckpointError(
      () => claimRniSourceWorkflowCheckpoint(null, claimInput(delivery(), { leaseMs: 59_999 })),
      'POLICY_CONFLICT',
    );

    const checkpoint = acquired();
    expectCheckpointError(
      () =>
        heartbeatRniSourceWorkflowCheckpoint(checkpoint, {
          ...mutationInput(checkpoint),
          leaseMs: 59_999,
        }),
      'POLICY_CONFLICT',
    );
    expectCheckpointError(
      () =>
        retryRniSourceWorkflowCheckpoint(checkpoint, {
          ...mutationInput(checkpoint),
          errorCode: 'PROVIDER_TIMEOUT',
          baseBackoffMs: 1_000,
          maxBackoffMs: 1_501,
        }),
      'POLICY_CONFLICT',
    );
    expectCheckpointError(
      () =>
        completeRniSourceWorkflowCheckpoint(checkpoint, {
          ...mutationInput(checkpoint, {
            authority: {
              ...authority(checkpoint.delivery.subject),
              workflowPolicy: {
                ...checkpoint.delivery.subject.workflowPolicy,
                maxBackoffMs: 1_501,
              },
            },
          }),
          outputHash: hashes.output,
        }),
      'STALE_AUTHORITY',
    );
  });

  it('rejects a mutation timestamp before the current outer lease acquisition', () => {
    const checkpoint = acquired();
    expectCheckpointError(
      () =>
        completeRniSourceWorkflowCheckpoint(checkpoint, {
          ...mutationInput(checkpoint, {
            authority: authority(checkpoint.delivery.subject, {
              outerLease: {
                acquiredAt: '2026-09-05T00:01:45.000Z',
                expiresAt: baseTime.outerExpiry,
              },
            }),
          }),
          outputHash: hashes.output,
        }),
      'TIME_REGRESSION',
    );
  });

  it('terminalizes a crashed third attempt and a retry that cannot fit its authority window', () => {
    const crashSubject = subject({
      workflowPolicy: { leaseMs: 1_000, baseBackoffMs: 1_000, maxBackoffMs: 8_000 },
    });
    const first = acquired(claimInput(delivery(crashSubject)));
    const second = claimRniSourceWorkflowCheckpoint(
      first,
      claimInput(first.delivery, {
        at: '2026-09-05T00:01:01.000Z',
        leaseToken: ids.leaseTwo,
        leaseMs: 1_000,
      }),
    );
    if (second.kind !== 'acquired') throw new Error('Expected second attempt');
    const third = claimRniSourceWorkflowCheckpoint(
      second.checkpoint,
      claimInput(first.delivery, {
        at: '2026-09-05T00:01:02.000Z',
        leaseToken: ids.leaseThree,
        leaseMs: 1_000,
      }),
    );
    if (third.kind !== 'acquired') throw new Error('Expected third attempt');
    const thirdRetry = retryRniSourceWorkflowCheckpoint(third.checkpoint, {
      ...mutationInput(third.checkpoint, { at: '2026-09-05T00:01:02.500Z' }),
      errorCode: 'PROVIDER_TIMEOUT',
      baseBackoffMs: 1_000,
      maxBackoffMs: 8_000,
    });
    expect(thirdRetry).toMatchObject({
      kind: 'terminal',
      checkpoint: {
        status: 'permanent_failure',
        terminal: {
          errorCode: 'WORKFLOW_ATTEMPT_LIMIT',
          causeCode: 'PROVIDER_TIMEOUT',
        },
      },
    });

    const exhausted = claimRniSourceWorkflowCheckpoint(
      third.checkpoint,
      claimInput(first.delivery, {
        at: '2026-09-05T00:01:03.000Z',
        leaseToken: ids.leaseOne,
        leaseMs: 1_000,
      }),
    );
    expect(exhausted).toMatchObject({
      kind: 'terminal',
      checkpoint: {
        status: 'permanent_failure',
        terminal: { kind: 'permanent_failure', errorCode: 'WORKFLOW_ATTEMPT_LIMIT' },
      },
    });

    const shortSubject = subject({
      deadline: '2026-09-05T00:01:31.000Z',
      workflowPolicy: { leaseMs: 60_000, baseBackoffMs: 1_000, maxBackoffMs: 1_000 },
    });
    const shortDelivery = delivery(shortSubject);
    const shortAuthority = authority(shortSubject, {
      outerLease: {
        acquiredAt: baseTime.acquired,
        expiresAt: '2026-09-05T00:05:00.000Z',
      },
    });
    const short = acquired(claimInput(shortDelivery, { authority: shortAuthority }));
    const noWindow = retryRniSourceWorkflowCheckpoint(short, {
      ...mutationInput(short, { authority: shortAuthority }),
      errorCode: 'PROVIDER_TIMEOUT',
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_000,
    });
    expect(noWindow).toMatchObject({
      kind: 'terminal',
      checkpoint: {
        status: 'permanent_failure',
        terminal: {
          errorCode: 'WORKFLOW_RETRY_WINDOW_EXHAUSTED',
          causeCode: 'PROVIDER_TIMEOUT',
        },
      },
    });
  });

  it('returns expired without mutation when parent authority or deadline is over', () => {
    const outerExpired = claimRniSourceWorkflowCheckpoint(
      null,
      claimInput(delivery(), { at: baseTime.outerExpiry }),
    );
    expect(outerExpired).toEqual({ kind: 'expired', reason: 'outer_authority', checkpoint: null });

    const deadlineSubject = subject({ deadline: '2026-09-05T00:05:00.000Z' });
    const deadlineDelivery = delivery(deadlineSubject);
    const deadlineExpired = claimRniSourceWorkflowCheckpoint(
      null,
      claimInput(deadlineDelivery, {
        at: deadlineSubject.deadline,
        authority: authority(deadlineSubject, {
          outerLease: {
            acquiredAt: baseTime.acquired,
            expiresAt: '2026-09-05T00:06:00.000Z',
          },
        }),
      }),
    );
    expect(deadlineExpired).toEqual({ kind: 'expired', reason: 'deadline', checkpoint: null });
  });

  it('completes once and returns exact output on redelivery without live authority', () => {
    const checkpoint = acquired();
    const completed = completeRniSourceWorkflowCheckpoint(checkpoint, {
      ...mutationInput(checkpoint),
      outputHash: hashes.output,
    });
    expect(completed).toMatchObject({
      status: 'completed',
      outputHash: hashes.output,
      completedAt: '2026-09-05T00:01:30.000Z',
      lease: null,
    });

    const expiredAuthority = authority(completed.delivery.subject, {
      outerLease: {
        acquiredAt: baseTime.acquired,
        expiresAt: baseTime.outerExpiry,
      },
    });
    const duplicate = claimRniSourceWorkflowCheckpoint(
      completed,
      claimInput(completed.delivery, {
        authority: expiredAuthority,
        at: '2026-09-05T00:30:00.000Z',
      }),
    );
    expect(duplicate).toEqual({ kind: 'duplicate', checkpoint: completed });

    expect(
      completeRniSourceWorkflowCheckpoint(completed, {
        ...mutationInput(checkpoint, {
          authority: expiredAuthority,
          at: '2026-09-05T00:30:00.000Z',
        }),
        outputHash: hashes.output,
      }),
    ).toEqual(completed);
    expectCheckpointError(
      () =>
        completeRniSourceWorkflowCheckpoint(completed, {
          ...mutationInput(checkpoint, {
            authority: expiredAuthority,
            at: '2026-09-05T00:30:00.000Z',
          }),
          outputHash: hashes.changed,
        }),
      'OUTPUT_CONFLICT',
    );
  });

  it('persists permanent-failure and budget-stopped terminals for exact redelivery', () => {
    const failedRun = acquired();
    const failed = failRniSourceWorkflowCheckpoint(failedRun, {
      ...mutationInput(failedRun),
      errorCode: 'UNSUPPORTED_CONTENT',
    });
    expect(
      claimRniSourceWorkflowCheckpoint(
        failed,
        claimInput(failed.delivery, { at: '2026-09-05T00:30:00.000Z' }),
      ),
    ).toEqual({ kind: 'terminal', checkpoint: failed });
    expect(
      failRniSourceWorkflowCheckpoint(failed, {
        ...mutationInput(failedRun),
        errorCode: 'UNSUPPORTED_CONTENT',
      }),
    ).toEqual(failed);

    const budgetRun = acquired();
    const stopped = stopRniSourceWorkflowForBudget(budgetRun, {
      ...mutationInput(budgetRun),
      reason: 'input_tokens',
    });
    expect(
      claimRniSourceWorkflowCheckpoint(
        stopped,
        claimInput(stopped.delivery, { at: '2026-09-05T00:30:00.000Z' }),
      ),
    ).toEqual({ kind: 'terminal', checkpoint: stopped });
  });

  it('rejects every crossed immutable subject identity and input hash', () => {
    const checkpoint = acquired();
    const variants: Array<[string, RniSourceWorkflowDeliveryV2]> = [
      ['run', delivery(subject({ runId: '00000000-0000-4000-8000-000000000201' }))],
      ['plan', delivery(subject({ planHash: hashes.changed }))],
      ['platform', delivery(subject({ platform: 'x' }))],
      ['outer attempt', delivery(subject({ outerAttempt: 2 }))],
      ['outer token', delivery(subject({ outerToken: '00000000-0000-4000-8000-000000000202' }))],
      ['deadline', delivery(subject({ deadline: '2026-09-05T00:21:00.000Z' }))],
      ['source', delivery(subject({ sourceItemId: '00000000-0000-4000-8000-000000000203' }))],
      ['retrieval', delivery(subject({ retrievalId: '00000000-0000-4000-8000-000000000204' }))],
      [
        'content version',
        delivery(subject({ contentVersionId: '00000000-0000-4000-8000-000000000205' })),
      ],
      ['outbox', delivery(subject({ outboxEventId: '00000000-0000-4000-8000-000000000206' }))],
      ['stage version', delivery(subject({ stageVersion: 'rni-interpret-source-v3' }))],
      ['input hash', delivery(subject(), hashes.changed)],
    ];

    for (const [name, crossed] of variants) {
      expectCheckpointError(
        () =>
          claimRniSourceWorkflowCheckpoint(
            checkpoint,
            claimInput(crossed, { authority: authority(crossed.subject) }),
          ),
        'IDENTITY_CONFLICT',
      );
      expect(name).toBeTruthy();
    }

    expect(() =>
      rniSourceWorkflowSubjectV2.parse({ ...subject(), stage: 'persist_source' }),
    ).toThrow();
  });

  it('rejects crossed parent authority, inner lease tokens, and terminal detail changes', () => {
    const checkpoint = acquired();
    expectCheckpointError(
      () =>
        completeRniSourceWorkflowCheckpoint(checkpoint, {
          ...mutationInput(checkpoint, {
            authority: {
              ...authority(checkpoint.delivery.subject),
              outerToken: '00000000-0000-4000-8000-000000000202',
            },
          }),
          outputHash: hashes.output,
        }),
      'STALE_AUTHORITY',
    );
    expectCheckpointError(
      () =>
        completeRniSourceWorkflowCheckpoint(checkpoint, {
          ...mutationInput(checkpoint, { leaseToken: ids.leaseTwo }),
          outputHash: hashes.output,
        }),
      'STALE_LEASE',
    );

    const failed = failRniSourceWorkflowCheckpoint(checkpoint, {
      ...mutationInput(checkpoint),
      errorCode: 'UNSUPPORTED_CONTENT',
    });
    expectCheckpointError(
      () =>
        failRniSourceWorkflowCheckpoint(failed, {
          ...mutationInput(checkpoint),
          errorCode: 'CHANGED_FAILURE',
        }),
      'INVALID_TRANSITION',
    );
  });
});
