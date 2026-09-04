/**
 * The corpus loader and format validator (F12 §4.1). Packs are frozen JSON fixtures, committed
 * under `fixtures/eval/corpus/` — this module reads and validates them; it never generates or
 * mutates one. "A pack is regenerated only by a deliberate, reviewed PR that also re-labels it."
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { corpusBucket, corpusPack, type CorpusBucket, type CorpusPack } from './contracts';

export function loadCorpusFromDir(dir: string): CorpusPack[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  return files.map((file) => {
    const raw: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const parsed = corpusPack.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `loadCorpusFromDir: ${file} failed the corpusPack schema — ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  });
}

/** F12 §4.1 / `05-TEST-STRATEGY.md` §5.1's production bar — the ≥30-pack corpus, per bucket. */
export const PRODUCTION_CORPUS_MINIMUM_PER_BUCKET: Readonly<Record<CorpusBucket, number>> = {
  clear_stance: 10,
  sarcasm_ambiguity: 5,
  ticker_collision: 5,
  conflicting_source: 5,
  thin_evidence: 5,
};

export type CorpusCoverageReport = {
  countsByBucket: Record<CorpusBucket, number>;
  total: number;
  /** False for the starter corpus by design — see the lane report's DEFERRED field. */
  meetsProductionMinimum: boolean;
  shortfalls: string[];
};

/**
 * Reports coverage honestly rather than gating on it. A starter corpus of 2-per-bucket is
 * exactly enough to prove the harness machinery works; it is not, and must never be reported
 * as, the production ≥30-pack corpus F12 §4.1 requires.
 */
export function reportCorpusCoverage(packs: readonly CorpusPack[]): CorpusCoverageReport {
  const countsByBucket = Object.fromEntries(
    corpusBucket.options.map((bucket) => [bucket, 0]),
  ) as Record<CorpusBucket, number>;

  for (const pack of packs) countsByBucket[pack.bucket] += 1;

  const shortfalls: string[] = [];
  for (const bucket of corpusBucket.options) {
    const need = PRODUCTION_CORPUS_MINIMUM_PER_BUCKET[bucket];
    const have = countsByBucket[bucket];
    if (have < need) {
      shortfalls.push(`${bucket}: have ${have}, need ${need} for the production corpus (F12 §4.1)`);
    }
  }

  return {
    countsByBucket,
    total: packs.length,
    meetsProductionMinimum: shortfalls.length === 0,
    shortfalls,
  };
}
