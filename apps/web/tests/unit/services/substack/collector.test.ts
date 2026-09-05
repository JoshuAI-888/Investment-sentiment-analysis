import { describe, expect, it } from 'vitest';
import type { SubstackEntry } from '@/adapters/substack';
import type { SubstackPublication } from '@/adapters/substack-publications';
import {
  availableAtFor,
  rowsForEntry,
  SUBSTACK_COVERAGE_CLASS,
  SUBSTACK_LICENSE_CLASS,
} from '@/services/substack/collector';

const OBSERVED_AT = new Date('2026-09-05T12:00:00.000Z');

const PUBLICATION: SubstackPublication = {
  slug: 'example',
  name: 'Example Letter',
  sector: 'Information Technology',
};

function entry(overrides: Partial<SubstackEntry> = {}): SubstackEntry {
  return {
    guid: 'https://example.substack.com/p/one',
    title: 'Tesla had a strong quarter',
    link: 'https://example.substack.com/p/one',
    publishedAt: '2026-09-04T09:00:00.000Z',
    contentHtml: '<p>Tesla shipped a lot of cars.</p>',
    ...overrides,
  };
}

const MATCH = {
  securityId: '11111111-1111-1111-1111-111111111111',
  symbol: 'TSLA',
  basis: { kind: 'company_name' as const, matched: 'Tesla' },
};

describe('availableAtFor', () => {
  it('uses publishedAt when it is in the past', () => {
    expect(availableAtFor(entry(), OBSERVED_AT)).toEqual(new Date('2026-09-04T09:00:00.000Z'));
  });

  // A scheduled Substack post routinely carries a future pubDate. Trusting it would write an
  // available_at this collector could not possibly have observed, which is a look-ahead hole in
  // the one column F22's as-of guard bounds this table on.
  it('clamps a future publishedAt to the observation instant', () => {
    const future = entry({ publishedAt: '2026-12-25T00:00:00.000Z' });
    expect(availableAtFor(future, OBSERVED_AT)).toEqual(OBSERVED_AT);
  });

  it('falls back to the observation instant on an unparseable date', () => {
    expect(availableAtFor(entry({ publishedAt: 'not a date' }), OBSERVED_AT)).toEqual(OBSERVED_AT);
  });
});

describe('rowsForEntry', () => {
  it('writes one row per attributed security, sharing one content hash', () => {
    const rows = rowsForEntry(
      entry(),
      PUBLICATION,
      {
        matches: [
          MATCH,
          { securityId: '22222222-2222-2222-2222-222222222222', symbol: 'NVDA', basis: { kind: 'company_name', matched: 'NVIDIA' } },
        ],
        pending: [],
      },
      'Tesla shipped a lot of cars.',
      OBSERVED_AT,
    );

    expect(rows).toHaveLength(2);
    // One hash per entry is what makes a re-poll a no-op per security while keeping two
    // securities named in one post as two genuinely distinct rows.
    expect(rows[0]?.rawHash).toBe(rows[1]?.rawHash);
    expect(rows.map((r) => r.securityId)).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
  });

  it('writes exactly one securityId:null row when nothing is attributed', () => {
    const rows = rowsForEntry(entry(), PUBLICATION, { matches: [], pending: [] }, 'body', OBSERVED_AT);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.securityId).toBeNull();
  });

  it('carries pending ambiguous candidates into metadata for later resolution', () => {
    const pending = [{ securityId: '33333333-3333-3333-3333-333333333333', symbol: 'AI', token: 'AI' }];
    const rows = rowsForEntry(entry(), PUBLICATION, { matches: [], pending }, 'body', OBSERVED_AT);
    expect((rows[0]?.metadata as { pendingEntityCandidates: unknown }).pendingEntityCandidates).toEqual(pending);
    expect((rows[0]?.metadata as { attributionBasis: unknown }).attributionBasis).toBeNull();
  });

  it('stores the full body, not a truncated preview (D-17)', () => {
    const body = 'x'.repeat(50_000);
    const rows = rowsForEntry(entry(), PUBLICATION, { matches: [MATCH], pending: [] }, body, OBSERVED_AT);
    expect(rows[0]?.snippet).toBe(body);
  });

  it('never guesses a stance — that is the scorer’s successor row to write', () => {
    const rows = rowsForEntry(entry(), PUBLICATION, { matches: [MATCH], pending: [] }, 'body', OBSERVED_AT);
    expect(rows[0]?.stanceLabel).toBeNull();
    expect(rows[0]?.stanceScore).toBeNull();
  });

  it('stores no author reference', () => {
    // `authorRef` permits hashed or pseudonymous only, and a Substack byline is a real name.
    const rows = rowsForEntry(entry(), PUBLICATION, { matches: [MATCH], pending: [] }, 'body', OBSERVED_AT);
    expect(rows[0]?.authorRef).toBeNull();
  });

  it('labels the frame as the curated set, never as “Substack”', () => {
    const rows = rowsForEntry(entry(), PUBLICATION, { matches: [MATCH], pending: [] }, 'body', OBSERVED_AT);
    expect(rows[0]?.coverageClass).toBe(SUBSTACK_COVERAGE_CLASS);
    expect(rows[0]?.licenseClass).toBe(SUBSTACK_LICENSE_CLASS);
    expect(SUBSTACK_COVERAGE_CLASS).toBe('curated_publication_set');
  });

  it('changes the hash when the body changes, so an edited post supersedes rather than no-ops', () => {
    const original = rowsForEntry(entry(), PUBLICATION, { matches: [MATCH], pending: [] }, 'body', OBSERVED_AT);
    const edited = rowsForEntry(
      entry({ contentHtml: '<p>Tesla shipped even more cars.</p>' }),
      PUBLICATION,
      { matches: [MATCH], pending: [] },
      'body',
      OBSERVED_AT,
    );
    expect(edited[0]?.rawHash).not.toBe(original[0]?.rawHash);
  });
});
