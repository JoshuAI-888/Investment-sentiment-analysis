import { describe, expect, it, vi } from 'vitest';

import { canonicalHash } from '../../../../src/calc/canonical';
import {
  synthesizeCitedNarrative,
  type RniChallengerInferencePort,
  type RniVerificationInferencePort,
} from '../../../../src/rni/agents';
import {
  loadAndReplayAcceptedCitedSynthesis,
  synthesizeAndCommitCitedNarrative,
  type RniCitedSynthesisPersistencePort,
  type RniCitedSynthesisPreparationRequest,
} from '../../../../src/rni/composition';
import {
  evidenceReader,
  NO_MATERIAL_CHALLENGE,
  RUN_ID,
  SECURITY_ID,
  SUPPORTED_ASSESSMENTS,
  synthesisRequest,
} from '../../../unit/rni/agents/fixtures';

const IDEMPOTENCY_KEY = 'rni-i07-cited-synthesis';
const PREPARATION_ID = '00000000-0000-4000-8000-000000008901';

function inferencePorts(): {
  readonly verifier: RniVerificationInferencePort;
  readonly challenger: RniChallengerInferencePort;
} {
  return {
    verifier: { verify: vi.fn(async () => ({ assessments: SUPPORTED_ASSESSMENTS })) },
    challenger: { challenge: vi.fn(async () => NO_MATERIAL_CHALLENGE) },
  };
}

function intentFor(request = synthesisRequest()): RniCitedSynthesisPreparationRequest {
  return {
    runId: RUN_ID,
    securityId: SECURITY_ID,
    convergenceArtifactHash: canonicalHash(request.convergenceArtifact),
    idempotencyKey: IDEMPOTENCY_KEY,
    createdAt: request.createdAt,
  };
}

function persistencePort(
  request = synthesisRequest(),
  overrides: Partial<RniCitedSynthesisPersistencePort> = {},
): RniCitedSynthesisPersistencePort {
  return {
    ...evidenceReader({ request }),
    prepare: async () => ({ status: 'ready', preparationId: PREPARATION_ID, request }),
    commitAccepted: async ({ artifact }) => ({
      disposition: 'inserted',
      summaryId: artifact.result.summary.id,
      artifactHash: canonicalHash(artifact),
    }),
    loadAccepted: async () => {
      throw new Error('no accepted synthesis fixture');
    },
    ...overrides,
  };
}

describe('I07 trusted cited-synthesis composition', () => {
  it('uses a persistence-built request and commits only the exact accepted E08 artifact', async () => {
    const request = synthesisRequest();
    const intent = intentFor(request);
    const prepare = vi.fn(async () => ({
      status: 'ready' as const,
      preparationId: PREPARATION_ID,
      request,
    }));
    const commitAccepted = vi.fn(async ({ artifact }) => ({
      disposition: 'inserted' as const,
      summaryId: artifact.result.summary.id,
      artifactHash: canonicalHash(artifact),
    }));
    const persistence = persistencePort(request, { prepare, commitAccepted });
    const { verifier, challenger } = inferencePorts();

    const result = await synthesizeAndCommitCitedNarrative(
      intent,
      persistence,
      verifier,
      challenger,
    );

    expect(prepare).toHaveBeenCalledWith(intent);
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(challenger.challenge).toHaveBeenCalledOnce();
    expect(commitAccepted).toHaveBeenCalledOnce();
    expect(commitAccepted).toHaveBeenCalledWith({
      preparationId: PREPARATION_ID,
      artifact: result.artifact,
    });
    expect(result.persistence).toEqual({
      disposition: 'inserted',
      summaryId: request.summaryId,
      artifactHash: canonicalHash(result.artifact),
    });
  });

  it('replays an already accepted artifact without model calls or another commit', async () => {
    const request = synthesisRequest();
    const reader = evidenceReader({ request });
    const initialPorts = inferencePorts();
    const artifact = await synthesizeCitedNarrative(
      request,
      reader,
      initialPorts.verifier,
      initialPorts.challenger,
    );
    const stored = { artifact, artifactHash: canonicalHash(artifact) };
    const commitAccepted = vi.fn();
    const persistence = persistencePort(request, {
      prepare: async () => ({ status: 'accepted', stored }),
      commitAccepted,
      loadAccepted: async () => stored,
    });
    const verifier = { verify: vi.fn() };
    const challenger = { challenge: vi.fn() };

    const duplicate = await synthesizeAndCommitCitedNarrative(
      intentFor(request),
      persistence,
      verifier,
      challenger,
    );
    const loaded = await loadAndReplayAcceptedCitedSynthesis(request.summaryId, persistence);

    expect(duplicate).toEqual({
      artifact,
      persistence: {
        disposition: 'duplicate',
        summaryId: request.summaryId,
        artifactHash: stored.artifactHash,
      },
    });
    expect(loaded).toEqual(artifact);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(challenger.challenge).not.toHaveBeenCalled();
    expect(commitAccepted).not.toHaveBeenCalled();
  });

  it('rejects crossed prepared lineage before inference or publication', async () => {
    const request = synthesisRequest();
    const crossedRequest = {
      ...request,
      convergenceArtifact: {
        ...request.convergenceArtifact,
        result: {
          ...request.convergenceArtifact.result,
          securityId: '00000000-0000-4000-8000-000000009999',
        },
      },
    };
    const commitAccepted = vi.fn();
    const persistence = persistencePort(request, {
      prepare: async () => ({
        status: 'ready',
        preparationId: PREPARATION_ID,
        request: crossedRequest,
      }),
      commitAccepted,
    });
    const { verifier, challenger } = inferencePorts();

    await expect(
      synthesizeAndCommitCitedNarrative(
        intentFor(request),
        persistence,
        verifier,
        challenger,
      ),
    ).rejects.toThrow('crossed durable lineage');
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(challenger.challenge).not.toHaveBeenCalled();
    expect(commitAccepted).not.toHaveBeenCalled();
  });

  it('rejects a crossed identity returned after the atomic commit', async () => {
    const request = synthesisRequest();
    const persistence = persistencePort(request, {
      commitAccepted: async ({ artifact }) => ({
        disposition: 'duplicate',
        summaryId: artifact.result.summary.id,
        artifactHash: 'f'.repeat(64),
      }),
    });
    const { verifier, challenger } = inferencePorts();

    await expect(
      synthesizeAndCommitCitedNarrative(
        intentFor(request),
        persistence,
        verifier,
        challenger,
      ),
    ).rejects.toThrow('different durable identity');
  });

  it('accepts an exact concurrent commit loser only when storage returns the same identity', async () => {
    const request = synthesisRequest();
    const persistence = persistencePort(request, {
      commitAccepted: async ({ artifact }) => ({
        disposition: 'duplicate',
        summaryId: artifact.result.summary.id,
        artifactHash: canonicalHash(artifact),
      }),
    });
    const { verifier, challenger } = inferencePorts();

    const result = await synthesizeAndCommitCitedNarrative(
      intentFor(request),
      persistence,
      verifier,
      challenger,
    );
    expect(result.persistence.disposition).toBe('duplicate');
  });

  it('rejects a stored artifact whose replay normalizes to different bytes', async () => {
    const request = synthesisRequest();
    const reader = evidenceReader({ request });
    const ports = inferencePorts();
    const artifact = await synthesizeCitedNarrative(
      request,
      reader,
      ports.verifier,
      ports.challenger,
    );
    const reordered = {
      ...artifact,
      requestSnapshot: {
        ...artifact.requestSnapshot,
        citationIds: [...artifact.requestSnapshot.citationIds].reverse(),
      },
    };
    const stored = { artifact: reordered, artifactHash: canonicalHash(reordered) };
    const persistence = persistencePort(request, {
      prepare: async () => ({ status: 'accepted', stored }),
    });

    await expect(
      synthesizeAndCommitCitedNarrative(
        intentFor(request),
        persistence,
        { verify: vi.fn() },
        { challenge: vi.fn() },
      ),
    ).rejects.toThrow('replay differs from its durable identity');
  });

  it.each(['verifier', 'challenger'] as const)(
    'does not publish when the %s inference fails',
    async (failureStage) => {
      const request = synthesisRequest();
      const commitAccepted = vi.fn();
      const persistence = persistencePort(request, { commitAccepted });
      const verifier = {
        verify: vi.fn(async () => {
          if (failureStage === 'verifier') throw new Error('verifier failed');
          return { assessments: SUPPORTED_ASSESSMENTS };
        }),
      };
      const challenger = {
        challenge: vi.fn(async () => {
          if (failureStage === 'challenger') throw new Error('challenger failed');
          return NO_MATERIAL_CHALLENGE;
        }),
      };

      await expect(
        synthesizeAndCommitCitedNarrative(
          intentFor(request),
          persistence,
          verifier,
          challenger,
        ),
      ).rejects.toThrow(`${failureStage} failed`);
      expect(commitAccepted).not.toHaveBeenCalled();
    },
  );
});
