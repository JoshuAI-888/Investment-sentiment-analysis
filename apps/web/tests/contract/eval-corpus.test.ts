/**
 * Corpus format validation (F12 §5 test plan: "corpus format validation").
 *
 * Loads the committed starter corpus under `fixtures/eval/corpus/` and checks it against the
 * `corpusPack` schema, plus the honesty check that matters most here: this is a 10-pack starter
 * corpus, and the coverage report must say so rather than imply it is the ≥30-pack production
 * corpus D-35/F12 §4.1 describe.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCorpusFromDir, reportCorpusCoverage } from '../../src/services/eval/corpus';
import { corpusPack } from '../../src/services/eval/contracts';

const CORPUS_DIR = join(__dirname, '../../fixtures/eval/corpus');

describe('corpus format', () => {
  it('loads every committed pack and each one satisfies the corpusPack schema', () => {
    const packs = loadCorpusFromDir(CORPUS_DIR);
    expect(packs.length).toBeGreaterThan(0);
    for (const pack of packs) {
      expect(corpusPack.safeParse(pack).success).toBe(true);
    }
  });

  it('every pack is frozen and carries at least one acceptable claim and one stored metric', () => {
    const packs = loadCorpusFromDir(CORPUS_DIR);
    for (const pack of packs) {
      expect(pack.frozen).toBe(true);
      expect(pack.acceptableClaims.length).toBeGreaterThan(0);
      expect(pack.storedMetrics.length).toBeGreaterThan(0);
    }
  });

  it('every item in every pack carries exactly one human label', () => {
    const packs = loadCorpusFromDir(CORPUS_DIR);
    for (const pack of packs) {
      const itemIds = pack.pack.items.map((i) => i.item.id).sort();
      const labelIds = pack.labels.map((l) => l.itemId).sort();
      expect(labelIds).toEqual(itemIds);
    }
  });

  it('the thin_evidence bucket genuinely has n < 5 relevant items per pack', () => {
    const packs = loadCorpusFromDir(CORPUS_DIR).filter((p) => p.bucket === 'thin_evidence');
    expect(packs.length).toBeGreaterThan(0);
    for (const pack of packs) {
      const relevantCount = pack.pack.items.filter((i) => i.relevant).length;
      expect(relevantCount).toBeLessThan(5);
      expect(pack.expectedOutcome).toBe('abstained');
    }
  });

  it('the ticker_collision bucket has at least one item labelled expectedRelevant: false', () => {
    const packs = loadCorpusFromDir(CORPUS_DIR).filter((p) => p.bucket === 'ticker_collision');
    expect(packs.length).toBeGreaterThan(0);
    for (const pack of packs) {
      expect(pack.labels.some((l) => !l.expectedRelevant)).toBe(true);
    }
  });

  it('reports coverage honestly: two packs per bucket, ten total, and explicitly short of the production ≥30-pack minimum', () => {
    const packs = loadCorpusFromDir(CORPUS_DIR);
    const report = reportCorpusCoverage(packs);
    expect(report.total).toBe(10);
    expect(report.countsByBucket).toEqual({
      clear_stance: 2,
      sarcasm_ambiguity: 2,
      ticker_collision: 2,
      conflicting_source: 2,
      thin_evidence: 2,
    });
    expect(report.meetsProductionMinimum).toBe(false);
    expect(report.shortfalls.length).toBe(5);
  });
});
