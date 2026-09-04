import { describe, expect, it } from 'vitest';
import {
  architectureManifestSchema,
  ARCHITECTURE_MANIFEST,
  NO_BACKTEST_STATEMENT,
} from '@/services/architecture/manifest';

describe('architecture manifest schema', () => {
  it('the built manifest parses against its own schema', () => {
    expect(() => architectureManifestSchema.parse(ARCHITECTURE_MANIFEST)).not.toThrow();
  });

  it('rejects a manifest with an empty pipeline (a manifest with no topology is not a manifest)', () => {
    const invalid = { ...ARCHITECTURE_MANIFEST, pipeline: [] };
    expect(() => architectureManifestSchema.parse(invalid)).toThrow();
  });

  it('rejects a pipeline stage naming a provider outside the live providerId enum', () => {
    const invalid = {
      ...ARCHITECTURE_MANIFEST,
      pipeline: [
        {
          id: 'bogus',
          label: 'Bogus',
          description: 'not a real provider',
          providers: ['not_a_real_provider'],
          jobKeys: [],
        },
      ],
    };
    expect(() => architectureManifestSchema.parse(invalid)).toThrow();
  });

  it('the assumptions tab statement plainly states no backtest exists', () => {
    expect(NO_BACKTEST_STATEMENT.toLowerCase()).toContain('no metric');
    expect(NO_BACKTEST_STATEMENT.toLowerCase()).toContain('backtest');
    expect(ARCHITECTURE_MANIFEST.noBacktestStatement).toBe(NO_BACKTEST_STATEMENT);
  });

  it('every PoV component and every target component is present and distinct in id', () => {
    const povIds = ARCHITECTURE_MANIFEST.povComponents.map((c) => c.id);
    const targetIds = ARCHITECTURE_MANIFEST.targetComponents.map((c) => c.id);
    expect(new Set(povIds).size).toBe(povIds.length);
    expect(new Set(targetIds).size).toBe(targetIds.length);
    expect(ARCHITECTURE_MANIFEST.povComponents.every((c) => c.status === 'deployed')).toBe(true);
    expect(ARCHITECTURE_MANIFEST.targetComponents.every((c) => c.status === 'target_only')).toBe(true);
  });
});
