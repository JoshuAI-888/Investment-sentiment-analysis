import { describe, expect, it, vi } from 'vitest';

import { canonicalHash } from '../../../../src/calc/canonical';
import {
  calculateAndCommitPlatformAnalytics,
  convergeAndCommitPlatformFacts,
  type RniAnalyticsArtifactPersistencePort,
} from '../../../../src/rni/composition';
import type { RniConvergenceRequest } from '../../../../src/rni/convergence';
import {
  methodology,
  platformInput as analyticsInput,
} from '../../../unit/rni/analytics/fixtures';
import {
  convergenceRequest,
  platformInput as convergenceInput,
} from '../../../unit/rni/convergence/fixtures';

describe('I07 deterministic artifact composition', () => {
  it('persists Reddit and X independently before committing their convergence facts', async () => {
    const committedPlatforms = new Map<string, string>();
    const commitPlatformAnalytics = vi.fn(async (artifact) => {
      const artifactHash = canonicalHash(artifact);
      committedPlatforms.set(artifact.result.platform, artifactHash);
      return { disposition: 'inserted' as const, artifactHash };
    });
    const commitConvergence = vi.fn(async (artifact) => {
      expect(committedPlatforms.size).toBe(2);
      expect(artifact.inputSnapshot.reddit.analyticsArtifactHash).toBe(
        committedPlatforms.get('reddit'),
      );
      expect(artifact.inputSnapshot.x.analyticsArtifactHash).toBe(committedPlatforms.get('x'));
      return {
        disposition: 'inserted' as const,
        artifactHash: canonicalHash(artifact),
      };
    });
    const persistence: RniAnalyticsArtifactPersistencePort = {
      commitPlatformAnalytics,
      commitConvergence,
    };

    const reddit = await calculateAndCommitPlatformAnalytics(
      analyticsInput('reddit'),
      methodology(),
      persistence,
    );
    const x = await calculateAndCommitPlatformAnalytics(
      analyticsInput('x'),
      methodology(),
      persistence,
    );
    const request: RniConvergenceRequest = convergenceRequest({
      reddit: convergenceInput('reddit', {
        analyticsArtifactHash: reddit.persistence.artifactHash,
      }),
      x: convergenceInput('x', { analyticsArtifactHash: x.persistence.artifactHash }),
    });
    const convergence = await convergeAndCommitPlatformFacts(request, persistence);

    expect(commitPlatformAnalytics).toHaveBeenCalledTimes(2);
    expect(commitConvergence).toHaveBeenCalledOnce();
    expect(reddit.artifact.result.platform).toBe('reddit');
    expect(x.artifact.result.platform).toBe('x');
    expect(reddit.persistence.artifactHash).not.toBe(x.persistence.artifactHash);
    expect(convergence.artifact.result.platforms.reddit.analyticsArtifactHash).toBe(
      reddit.persistence.artifactHash,
    );
    expect(convergence.artifact.result.platforms.x.analyticsArtifactHash).toBe(
      x.persistence.artifactHash,
    );
  });

  it('fails closed when storage returns an identity for different artifact bytes', async () => {
    const persistence: RniAnalyticsArtifactPersistencePort = {
      commitPlatformAnalytics: async () => ({
        disposition: 'duplicate',
        artifactHash: 'f'.repeat(64),
      }),
      commitConvergence: async (artifact) => ({
        disposition: 'inserted',
        artifactHash: canonicalHash(artifact),
      }),
    };

    await expect(
      calculateAndCommitPlatformAnalytics(
        analyticsInput('reddit'),
        methodology(),
        persistence,
      ),
    ).rejects.toThrow('different canonical identity');
  });
});
