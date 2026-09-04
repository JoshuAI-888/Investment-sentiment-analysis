import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCorpusPack, loadSeededErrorAnswer, CorpusValidationError } from '@/services/eval/corpus';

function corpusRootWithPack(id: string, body: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'f12-corpus-'));
  mkdirSync(join(root, 'packs'), { recursive: true });
  writeFileSync(join(root, 'packs', `${id}.json`), JSON.stringify(body));
  return root;
}

function corpusRootWithSeededError(id: string, body: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'f12-corpus-'));
  mkdirSync(join(root, 'seeded-errors'), { recursive: true });
  writeFileSync(join(root, 'seeded-errors', `${id}.json`), JSON.stringify(body));
  return root;
}

const VALID_PACK_META = {
  id: 'test-01',
  bucket: 'clear_stance',
  labelSource: 'llm_assisted_pending_human_audit',
  subjectSymbol: 'AAPL',
  metrics: [],
  labels: { perItem: [], expectedDirection: 'bullish', expectedAbstain: false, requiredAbstentions: [] },
  goldOutput: {
    summary: 'A summary.',
    statedFreshness: '2026-08-01',
    themes: [{ title: 'T', claims: [{ claimId: 'c1', text: 'x', kind: 'fact', evidenceIds: [], metricIds: [], relatedTickers: ['AAPL'], assertedDate: null }], singleSource: true }],
    bullishCase: [],
    bearishCase: [],
    whatChanged: [],
    whatToMonitor: [],
  },
};

const VALID_PACK = {
  securityId: 'sec-1',
  asOf: '2026-08-31T12:00:00.000Z',
  retrievalWindow: { from: null, to: null },
  retrievalQuery: 'q',
  items: [],
  excluded: [],
  retrievedCount: 0,
  usedCount: 0,
  truncatedByScanWindow: false,
  disclosures: [
    { axis: 'reddit', statement: 's', windowFrom: null, windowTo: null, retrievedCount: 0, usedCount: 0, exclusions: [], meta: { kind: 'reddit', collected: false, subredditsPolled: [], treeComplete: null } },
    { axis: 'x', statement: 's', windowFrom: null, windowTo: null, retrievedCount: 0, usedCount: 0, exclusions: [], meta: { kind: 'x', watchlistVersion: null, triggerEvent: null } },
    { axis: 'substack', statement: 's', windowFrom: null, windowTo: null, retrievedCount: 0, usedCount: 0, exclusions: [], meta: { kind: 'substack', publicationSetVersion: 'v1', selectionBasis: 'b' } },
  ],
};

describe('loadCorpusPack', () => {
  it('loads and validates a well-formed pack', async () => {
    const root = corpusRootWithPack('test-01', { meta: VALID_PACK_META, pack: VALID_PACK });
    const loaded = await loadCorpusPack('test-01', root);
    expect(loaded.meta.id).toBe('test-01');
    expect(loaded.pack.disclosures.map((d) => d.axis)).toEqual(['reddit', 'x', 'substack']);
  });

  it('rejects a pack file missing meta/pack', async () => {
    const root = corpusRootWithPack('broken', { meta: VALID_PACK_META });
    await expect(loadCorpusPack('broken', root)).rejects.toThrow(CorpusValidationError);
  });

  it('rejects a meta that fails zod validation', async () => {
    const root = corpusRootWithPack('broken', { meta: { ...VALID_PACK_META, bucket: 'not_a_real_bucket' }, pack: VALID_PACK });
    await expect(loadCorpusPack('broken', root)).rejects.toThrow(CorpusValidationError);
  });

  it('rejects a pack whose disclosures are not [reddit, x, substack] in order', async () => {
    const root = corpusRootWithPack('broken', {
      meta: VALID_PACK_META,
      pack: { ...VALID_PACK, disclosures: [VALID_PACK.disclosures[1], VALID_PACK.disclosures[0], VALID_PACK.disclosures[2]] },
    });
    await expect(loadCorpusPack('broken', root)).rejects.toThrow(CorpusValidationError);
  });

  it('rejects a pack with fewer than three disclosures', async () => {
    const root = corpusRootWithPack('broken', { meta: VALID_PACK_META, pack: { ...VALID_PACK, disclosures: [VALID_PACK.disclosures[0]] } });
    await expect(loadCorpusPack('broken', root)).rejects.toThrow(CorpusValidationError);
  });
});

describe('loadSeededErrorAnswer', () => {
  it('rejects a seeded-error file that fails schema validation', async () => {
    const root = corpusRootWithSeededError('broken', { meta: { id: 'broken' }, output: {} });
    await expect(loadSeededErrorAnswer('broken', root)).rejects.toThrow(CorpusValidationError);
  });
});
