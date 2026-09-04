import { describe, expect, it } from 'vitest';
import type { SubstackEntry } from '@/adapters/substack';
import {
  buildSubstackEvidenceInput,
  SUBSTACK_COVERAGE_CLASS,
  SUBSTACK_EVIDENCE_PROVIDER,
  SUBSTACK_LICENSE_CLASS,
} from '@/services/collect/substack-collector';
import type { SubstackPublication } from '@/services/collect/substack-publications';
import {
  SUBSTACK_PUBLICATION_COUNT,
  SUBSTACK_PUBLICATIONS,
  SUBSTACK_SELECTION_BASIS,
  SUBSTACK_UNCOVERED_SECTOR,
} from '@/services/collect/substack-publications';

const publication: SubstackPublication = {
  sector: 'Energy',
  publication: 'Example Sector Notes',
  subdomain: 'example',
};

function entry(overrides: Partial<SubstackEntry> = {}): SubstackEntry {
  return {
    guid: 'https://example.substack.com/p/q3-margins',
    title: 'Q3 margins across the sector & what changed',
    link: 'https://example.substack.com/p/q3-margins',
    publishedAt: '2025-08-25T13:00:00.000Z',
    contentHtml: '<p>Full body with <b>markup</b> &amp; an entity.</p>',
    ...overrides,
  };
}

describe('SUBSTACK_PUBLICATIONS — the disclosed MT-15/D-29 set', () => {
  it('matches the docs/DEPLOY.md-confirmed count exactly', () => {
    expect(SUBSTACK_PUBLICATIONS).toHaveLength(SUBSTACK_PUBLICATION_COUNT);
    expect(SUBSTACK_PUBLICATIONS).toHaveLength(13);
  });

  it('covers 10 distinct sectors, never the disclosed Utilities gap', () => {
    const sectors = new Set(SUBSTACK_PUBLICATIONS.map((p) => p.sector));
    expect(sectors.size).toBe(10);
    expect([...sectors]).not.toContain(SUBSTACK_UNCOVERED_SECTOR);
  });

  it('has no duplicate subdomain', () => {
    const subdomains = SUBSTACK_PUBLICATIONS.map((p) => p.subdomain);
    expect(new Set(subdomains).size).toBe(subdomains.length);
  });

  it('carries the D-29 basis verbatim, for the Inspector', () => {
    expect(SUBSTACK_SELECTION_BASIS).toBe(
      'One to two Substack publications per GICS sector represented in the seed universe, ' +
        'selected for sector coverage rather than readership, personal familiarity, or citation frequency.',
    );
  });

  it("matches docs/DEPLOY.md's confirmed table exactly, entry for entry", () => {
    // Transcribed from docs/DEPLOY.md's "Confirmed candidate list — signed off 2026-09-04" table.
    // A change to either file without the other is exactly the drift this test exists to catch.
    expect(SUBSTACK_PUBLICATIONS).toEqual([
      { sector: 'Energy', publication: 'Doomberg', subdomain: 'doomberg' },
      { sector: 'Financials', publication: 'Net Interest (Marc Rubinstein)', subdomain: 'netinterest' },
      {
        sector: 'Information Technology',
        publication: 'The Semiconductor Newsletter',
        subdomain: 'thesemiconductornewsletter',
      },
      { sector: 'Information Technology', publication: 'Bits and Bytes', subdomain: 'semiconductor' },
      { sector: 'Health Care', publication: 'Boutique Biotech', subdomain: 'boutiquebiotech' },
      { sector: 'Health Care', publication: 'Bio Brief', subdomain: 'thebiobrief' },
      {
        sector: 'Consumer Staples',
        publication: 'As the Consumer Turns (Adam Josephson)',
        subdomain: 'adamjosephson',
      },
      {
        sector: 'Consumer Staples',
        publication: 'Matt McClintock Retail/Consumer Research',
        subdomain: 'matthewmcclintock',
      },
      { sector: 'Real Estate', publication: 'REIT Dividends', subdomain: 'reits' },
      {
        sector: 'Industrials',
        publication: 'Industrial Tech Stock Analyst',
        subdomain: 'industrialanalyst',
      },
      { sector: 'Materials', publication: 'Metals and Miners', subdomain: 'metalsandminers' },
      {
        sector: 'Communication Services',
        publication: 'The Entertainment Strategy Guy',
        subdomain: 'entertainment',
      },
      { sector: 'Consumer Discretionary', publication: 'Consumer Spec', subdomain: 'consumerspec' },
    ]);
  });
});

describe('buildSubstackEvidenceInput', () => {
  const now = new Date('2026-09-05T00:00:00.000Z');

  it('builds a valid input from a well-formed entry', () => {
    const result = buildSubstackEvidenceInput(publication, entry(), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      securityId: null,
      evidenceType: 'news',
      provider: SUBSTACK_EVIDENCE_PROVIDER,
      title: 'Q3 margins across the sector & what changed',
      sourceUrl: 'https://example.substack.com/p/q3-margins',
      publisher: 'Example Sector Notes',
      authorRef: null,
      stanceLabel: null,
      stanceScore: null,
      relevanceScore: null,
      availability: 'available',
      licenseClass: SUBSTACK_LICENSE_CLASS,
      coverageClass: SUBSTACK_COVERAGE_CLASS,
    });
  });

  // D-17 / this feature's own DoD: the persisted content is the real content:encoded HTML, never
  // truncated and never re-summarized. This is the one assertion that would fail if a future edit
  // swapped `snippet` for a shortened excerpt.
  it('retains the full content:encoded HTML as the snippet — never truncated', () => {
    const longHtml = `<p>${'A'.repeat(5000)}</p><p>with <b>markup</b> and an entity &amp; more text after it.</p>`;
    const result = buildSubstackEvidenceInput(publication, entry({ contentHtml: longHtml }), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.snippet).toBe(longHtml);
    expect(result.input.snippet).toHaveLength(longHtml.length);
  });

  it('sets publishedAt and availableAt from the entry, and lastCheckedAt from the collection clock', () => {
    const result = buildSubstackEvidenceInput(publication, entry(), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.publishedAt).toEqual(new Date('2025-08-25T13:00:00.000Z'));
    expect(result.input.availableAt).toEqual(new Date('2025-08-25T13:00:00.000Z'));
    expect(result.input.lastCheckedAt).toEqual(now);
  });

  it('records sector and publicationSlug in metadata, for downstream security matching', () => {
    const result = buildSubstackEvidenceInput(publication, entry(), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.metadata).toMatchObject({
      sector: 'Energy',
      publicationSlug: 'example',
      guid: entry().guid,
    });
  });

  it('rejects an empty guid', () => {
    const result = buildSubstackEvidenceInput(publication, entry({ guid: '' }), now);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('guid') });
  });

  it('rejects an empty title', () => {
    const result = buildSubstackEvidenceInput(publication, entry({ title: '' }), now);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('title') });
  });

  it('rejects an unparseable publishedAt', () => {
    const result = buildSubstackEvidenceInput(publication, entry({ publishedAt: 'not-a-date' }), now);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('publishedAt') });
  });

  it('rejects a link that is not a valid URL', () => {
    const result = buildSubstackEvidenceInput(publication, entry({ link: 'not a url' }), now);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('link') });
  });

  // Dedup identity: two calls for the same (publication, guid) must produce the same rawHash
  // regardless of any other field, since identity here is deliberately guid-scoped, not
  // content-scoped — see the module doc's "Dedup is on guid, not on content" section.
  it('produces the same rawHash for the same (publication, guid) even when title/content differ', () => {
    const first = buildSubstackEvidenceInput(publication, entry(), now);
    const second = buildSubstackEvidenceInput(
      publication,
      entry({ title: 'A retitled version', contentHtml: '<p>Edited body.</p>' }),
      now,
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.input.rawHash).toBe(second.input.rawHash);
  });

  it('produces a different rawHash for a different guid on the same publication', () => {
    const first = buildSubstackEvidenceInput(publication, entry({ guid: 'guid-a' }), now);
    const second = buildSubstackEvidenceInput(publication, entry({ guid: 'guid-b' }), now);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.input.rawHash).not.toBe(second.input.rawHash);
  });

  it('produces a different rawHash for the same guid on two different publications', () => {
    const otherPublication: SubstackPublication = {
      sector: 'Materials',
      publication: 'A Different Publication',
      subdomain: 'different',
    };
    const first = buildSubstackEvidenceInput(publication, entry({ guid: 'shared-guid' }), now);
    const second = buildSubstackEvidenceInput(otherPublication, entry({ guid: 'shared-guid' }), now);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.input.rawHash).not.toBe(second.input.rawHash);
  });
});
