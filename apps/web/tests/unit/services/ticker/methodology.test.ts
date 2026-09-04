import { describe, expect, it } from 'vitest';
import { methodologyEntryFor } from '../../../../src/services/ticker/methodology';

describe('methodologyEntryFor', () => {
  it('projects the registry entry — title, version, thresholds and limitations', () => {
    const entry = methodologyEntryFor({
      axis: 'stance_reddit',
      methodId: 'social.stance_reddit',
      source: 'Reddit',
      window: 'evidence retrieved this render',
      calculationId: 'calc-1',
    });

    expect(entry.methodId).toBe('social.stance_reddit');
    expect(entry.methodVersion).toBe('1.0.0');
    expect(entry.thresholds.map((t) => t.key).sort()).toEqual(['display_floor', 'min_items']);
    expect(entry.limitations.length).toBeGreaterThan(0);
    // F-03: the selection-bias disclosure is reproduced from the registry verbatim.
    expect(entry.limitations.some((l) => l.includes('reddit.com'))).toBe(true);
    expect(entry.inspectorHref).toBe('/calculations/calc-1');
  });

  it('renders a null inspectorHref when no artifact was computed this render', () => {
    const entry = methodologyEntryFor({
      axis: 'news',
      methodId: 'news.sentiment',
      source: 'news',
      window: 'articles retrieved this render',
    });
    expect(entry.inspectorHref).toBeNull();
  });

  it('picks the latest registered version (attention.rank_change 1.1.0, not 1.0.0)', () => {
    const entry = methodologyEntryFor({
      axis: 'attention',
      methodId: 'attention.rank_change',
      source: 'reddit',
      window: '24 h',
    });
    expect(entry.methodVersion).toBe('1.1.0');
  });
});
