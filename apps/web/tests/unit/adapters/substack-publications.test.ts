import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getSubstackDisclosureBasis,
  getSubstackPublications,
  loadSubstackPublicationSeed,
  SubstackPublicationListMissing,
} from '@/adapters/substack-publications';

describe('loadSubstackPublicationSeed', () => {
  it('loads the committed MT-15 list: 13 publications across 10 of 11 GICS sectors', async () => {
    const seed = await loadSubstackPublicationSeed();

    expect(seed.publications).toHaveLength(13);
    expect(seed.sectorsRepresented).toBe(10);
    expect(seed.sectorsTotal).toBe(11);
    expect(new Set(seed.publications.map((p) => p.sector)).size).toBe(10);
  });

  it('every publication slug is unique and shaped like a substack subdomain', async () => {
    const seed = await loadSubstackPublicationSeed();
    const slugs = seed.publications.map((p) => p.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it('discloses the Utilities gap rather than omitting it silently', async () => {
    const seed = await loadSubstackPublicationSeed();

    expect(seed.disclosedGaps).toHaveLength(1);
    expect(seed.disclosedGaps[0]?.sector).toBe('Utilities');
    expect(seed.disclosedGaps[0]?.reason.length).toBeGreaterThan(0);
  });

  it('throws SubstackPublicationListMissing rather than fabricating a list', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'substack-seed-missing-'));
    try {
      await expect(
        loadSubstackPublicationSeed(path.join(dir, 'does-not-exist.json')),
      ).rejects.toThrow(SubstackPublicationListMissing);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a list that fails the schema instead of silently accepting it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'substack-seed-invalid-'));
    const file = path.join(dir, 'bad.json');
    try {
      await writeFile(file, JSON.stringify({ confirmedAt: 'not-a-date' }));
      await expect(loadSubstackPublicationSeed(file)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('getSubstackPublications', () => {
  it('returns the flat list a dispatcher would iterate', async () => {
    const publications = await getSubstackPublications();
    expect(publications).toHaveLength(13);
    expect(publications[0]).toEqual(
      expect.objectContaining({ slug: expect.any(String), name: expect.any(String), sector: expect.any(String) }),
    );
  });
});

describe('getSubstackDisclosureBasis', () => {
  it('names the basis, confirmation date and coverage — the F10 §disclosure line', async () => {
    const basis = await getSubstackDisclosureBasis();
    expect(basis).toContain('sector coverage');
    expect(basis).toContain('2026-09-04');
    expect(basis).toContain('13 publications');
    expect(basis).toContain('10 of 11 GICS sectors');
  });
});
