/**
 * F20 §3's `ScoreResult`, as a zod schema — and its **parity with the service's own validator**.
 *
 * There are two implementations of this contract in the repository: `services/scorer/contract.py`
 * enforces it on the way out, `src/adapters/scorer.ts` enforces it on the way in. Two validators
 * of one contract is a drift hazard, and the drift would be silent in exactly the direction that
 * matters — a Python-side rule relaxed for a deploy would let a value through that the TypeScript
 * side had no reason to expect. So the parity block below reads `contract.py`'s own source and
 * compares the rules, rather than trusting that two files written on the same afternoon still
 * agree six months later.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { readFixture } from '@/adapters/fixtures';
import {
  SCORE_SUM_TOLERANCE,
  SCORER_IDS,
  SCORER_VERSION_PATTERN,
  scoreDistributionIssues,
  scoreResponseSchema,
  scoreResultSchema,
} from '@/adapters/scorer';
import { SCORER_PROVENANCES } from '@/services/jobs/ports';
import { stanceLabel } from '@/contracts/primitives';

const CONTRACT_PY = fileURLToPath(new URL('../../../../services/scorer/contract.py', import.meta.url));
const SCORING_PY = fileURLToPath(new URL('../../../../services/scorer/scoring.py', import.meta.url));

async function fixtureBody(name: string): Promise<unknown> {
  return (await readFixture('scorer', 'score', name)).body;
}

/** Python's `re` and JavaScript's `RegExp` escape `-` and `/` differently and mean the same. */
function normalisePattern(pattern: string): string {
  return pattern.replaceAll('\\-', '-').replaceAll('\\/', '/');
}

describe('ScoreResult — the zod schema', () => {
  it('accepts the recorded batch, produced by the service’s own scoring code', async () => {
    const parsed = scoreResponseSchema.safeParse(await fixtureBody('success'));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toHaveLength(3);
    expect(parsed.data[0]!.scores.bullish).toBe('0.900000');
    expect(parsed.data[1]!.truncated).toBe(true);
  });

  it('rejects a score sent as a JSON number', async () => {
    const parsed = scoreResponseSchema.safeParse(await fixtureBody('float_score'));

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]!.message).toContain('never JSON numbers');
  });

  it('rejects a scorerVersion that is a tag, a branch, or empty', async () => {
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    for (const version of ['ProsusAI/finbert@main', 'ProsusAI/finbert@v1.2.0', 'ProsusAI/finbert@', '', 'latest']) {
      const scorer = { ...(base.scorer as object), scorerVersion: version };
      expect(scoreResultSchema.safeParse({ ...base, scorer }).success).toBe(false);
    }
  });

  it('accepts only the two pinned scorer ids', async () => {
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    for (const scorerId of SCORER_IDS) {
      const scorer = {
        ...(base.scorer as Record<string, unknown>),
        scorerId,
        scorerVersion: `org/${scorerId}@${'0'.repeat(40)}`,
      };
      expect(scoreResultSchema.safeParse({ ...base, scorer }).success).toBe(true);
    }
    const rogue = { ...(base.scorer as object), scorerId: 'gpt-4o-mini' };
    expect(scoreResultSchema.safeParse({ ...base, scorer: rogue }).success).toBe(false);
  });

  it('rejects a label outside the three stances', async () => {
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    expect(scoreResultSchema.safeParse({ ...base, label: 'positive' }).success).toBe(false);
    expect(scoreResultSchema.safeParse({ ...base, label: 'unclear' }).success).toBe(false);
  });

  it('rejects a scoredAt that is not ISO-8601 UTC', async () => {
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    for (const scoredAt of ['2026-08-30T12:00:00+02:00', '2026-08-30 12:00:00Z', '30/08/2026', '']) {
      expect(scoreResultSchema.safeParse({ ...base, scoredAt }).success).toBe(false);
    }
    expect(scoreResultSchema.safeParse({ ...base, scoredAt: '2026-08-30T12:00:00Z' }).success).toBe(true);
  });

  it('rejects an inputHash that is not a sha256 digest', async () => {
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    for (const inputHash of ['', 'deadbeef', 'A'.repeat(64), 'z'.repeat(64)]) {
      expect(scoreResultSchema.safeParse({ ...base, inputHash }).success).toBe(false);
    }
  });

  it('rejects truncated sent as anything but a boolean', async () => {
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    for (const truncated of ['true', 1, null]) {
      expect(scoreResultSchema.safeParse({ ...base, truncated }).success).toBe(false);
    }
  });

  it('requires all three stance probabilities, not just the winning one', async () => {
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    expect(scoreResultSchema.safeParse({ ...base, scores: { bullish: '0.900000' } }).success).toBe(false);
  });

  it('does NOT reject an out-of-range score by shape alone — that is a separate check', async () => {
    // Stated rather than implied. `scoreResultSchema` is a *shape* contract: '12.34' is a
    // well-formed decimal string and passes it. The property that scores are a probability
    // distribution is `scoreDistributionIssues`, which `admitPerItem` runs on every row — see
    // the block below. Asserting the boundary here keeps the next reader from assuming the
    // schema covers more than it does, which is how lane-review finding 4 arose.
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    const skewed = { ...base, scores: { bullish: '12.34', bearish: '-0.5', neutral: '0' } };
    expect(scoreResultSchema.safeParse(skewed).success).toBe(true);
    expect(scoreDistributionIssues('bullish', skewed.scores).length).toBeGreaterThan(0);
  });
});

describe('scores are a probability distribution, not three decimal strings', () => {
  it('holds for every row of the recorded batch', async () => {
    for (const row of scoreResponseSchema.parse(await fixtureBody('success'))) {
      expect(scoreDistributionIssues(row.label, row.scores)).toEqual([]);
    }
  });

  it('holds for the re-scored batch too', async () => {
    for (const row of scoreResponseSchema.parse(await fixtureBody('success_rescored'))) {
      expect(scoreDistributionIssues(row.label, row.scores)).toEqual([]);
    }
  });

  it('is derived from the service, not chosen: the tolerance matches its own precision', async () => {
    // `scoring.py` formats to six places (`f"{value:.6f}"`), so three rounded values can miss
    // an exact 1 by at most 3 × 5e-7. If that formatting ever changes this assertion should
    // fail — it is a contract change, and it should not pass quietly.
    const source = await readFile(SCORING_PY, 'utf-8');
    expect(source).toContain('f"{value:.6f}"');
    expect(new Decimal(SCORE_SUM_TOLERANCE).greaterThan('0.0000015')).toBe(true);
  });
});

describe('parity with services/scorer/contract.py', () => {
  it('pins scorerVersion with the same pattern at both ends of the wire', async () => {
    const source = await readFile(CONTRACT_PY, 'utf-8');
    const match = /SCORER_VERSION = re\.compile\(r"([^"]+)"\)/.exec(source);

    expect(match, 'contract.py no longer declares SCORER_VERSION as a raw-string regex').not.toBeNull();
    expect(normalisePattern(match![1]!)).toBe(normalisePattern(SCORER_VERSION_PATTERN.source));
  });

  it('agrees on the decimal-string pattern', async () => {
    const source = await readFile(CONTRACT_PY, 'utf-8');
    const match = /DECIMAL_STRING = re\.compile\(r"([^"]+)"\)/.exec(source);

    expect(match).not.toBeNull();
    // `contracts/primitives.ts` owns the TypeScript side; this asserts the two are the same
    // rule, not that either is a particular string.
    const python = new RegExp(match![1]!);
    for (const value of ['0.900000', '1', '0', '-0.5', '12.34']) {
      expect(python.test(value), `python accepts ${value}`).toBe(true);
    }
    for (const value of ['.9', '0.', '1e-3', 'NaN', '', '0,9']) {
      expect(python.test(value), `python rejects ${value}`).toBe(false);
    }
    // And the TypeScript side answers identically on the same corpus.
    const [base] = (await fixtureBody('success')) as [Record<string, unknown>];
    const scoresOf = (bullish: unknown) => ({ ...(base.scores as object), bullish });
    for (const value of ['0.900000', '1', '0', '-0.5', '12.34']) {
      expect(scoreResultSchema.safeParse({ ...base, scores: scoresOf(value) }).success).toBe(true);
    }
    for (const value of ['.9', '0.', '1e-3', 'NaN', '', '0,9']) {
      expect(scoreResultSchema.safeParse({ ...base, scores: scoresOf(value) }).success).toBe(false);
    }
  });

  it('agrees on the three stance labels', async () => {
    const source = await readFile(CONTRACT_PY, 'utf-8');
    const match = /LABELS = frozenset\(\{([^}]+)\}\)/.exec(source);

    expect(match).not.toBeNull();
    const python = [...match![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).sort();
    expect(python).toEqual([...stanceLabel.options].sort());
  });

  it('agrees on the two scorer_provenance values, with pinned the only one v1 writes', async () => {
    const source = await readFile(CONTRACT_PY, 'utf-8');
    const match = /PROVENANCE = frozenset\(\{([^}]+)\}\)/.exec(source);

    expect(match).not.toBeNull();
    const python = [...match![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).sort();
    expect(python).toEqual([...SCORER_PROVENANCES].sort());
  });
});
