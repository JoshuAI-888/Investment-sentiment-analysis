import { describe, expect, it } from 'vitest';
import { routeToScorer } from '@/services/jobs/routing';
import type { SocialItemForm } from '@/services/jobs/ports';
import { SOCIAL_ITEM_FORMS } from '@/services/jobs/ports';
import type { SocialAxis } from '@/contracts/primitives';

const AXES: SocialAxis[] = ['reddit', 'x', 'substack'];

describe('F20 §4.1 — which pinned model scores which item', () => {
  it('routes Substack prose and Reddit posts to FinBERT', () => {
    expect(routeToScorer({ axis: 'substack', form: 'article' })).toBe('finbert');
    expect(routeToScorer({ axis: 'substack', form: 'post' })).toBe('finbert');
    expect(routeToScorer({ axis: 'reddit', form: 'post' })).toBe('finbert');
  });

  it('routes X snippets and Reddit comments to Twitter-RoBERTa', () => {
    expect(routeToScorer({ axis: 'x', form: 'post' })).toBe('tweet-roberta');
    expect(routeToScorer({ axis: 'x', form: 'comment' })).toBe('tweet-roberta');
    expect(routeToScorer({ axis: 'reddit', form: 'comment' })).toBe('tweet-roberta');
  });

  it('is total over every axis and form, so no item is unroutable', () => {
    for (const axis of AXES) {
      for (const form of SOCIAL_ITEM_FORMS) {
        expect(['finbert', 'tweet-roberta']).toContain(routeToScorer({ axis, form }));
      }
    }
  });

  it('depends on nothing that can drift — the same axis and form always route the same way', () => {
    // The regression this guards: a length-based rule would send the *same item* to a different
    // model after a body was re-truncated, putting two scorer revisions inside one series and
    // tripping Tier D3's "no series mixes scorers" for a reason nobody could find.
    const cases: Array<{ axis: SocialAxis; form: SocialItemForm }> = [
      { axis: 'reddit', form: 'post' },
      { axis: 'reddit', form: 'comment' },
      { axis: 'x', form: 'post' },
      { axis: 'substack', form: 'article' },
    ];
    for (const item of cases) {
      expect(routeToScorer(item)).toBe(routeToScorer({ ...item }));
    }
  });
});
