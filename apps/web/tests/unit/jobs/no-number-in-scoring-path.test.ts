/**
 * F20 §7 step 5: *"Confirm no raw JS `number` touches a score anywhere in the path."*
 *
 * That is a review instruction, and a review instruction is a check that stops being run. Two
 * assertions replace it here, and they fail for different reasons on purpose:
 *
 * 1. A **behavioural** one — a score whose decimal string a float round-trip would rewrite
 *    survives the whole queue → worker → store path byte-for-byte. This catches an actual
 *    conversion wherever it hides, including inside a dependency.
 * 2. A **source scan** over the scoring modules for the constructs that produce a JS number from
 *    a string. This catches a conversion added on a branch nothing yet exercises, which is
 *    precisely where the first assertion is blind.
 *
 * `no-float-in-analytics` does not cover this path: it is armed over `calc/` and `analytics/`,
 * and `services/jobs/` is neither.
 *
 * **`SCANNED` names F20's scoring files explicitly, not `readdir`'d — corrected 2026-09-05,
 * F16a.** `services/jobs/` stopped being F20-only the moment F16a's dispatch core landed
 * alongside it (`schedule.ts`, `heartbeat.ts`, `x-ceiling.ts`, ...) — an ordinary `readdir` over
 * the whole directory swept those files into a check whose own doc, one paragraph up, says its
 * subject is "the scoring modules." None of F16a's files touch a sentiment score: `schedule.ts`
 * parses cron fields and calendar components, `heartbeat.ts` formats a duration for a log line,
 * `x-ceiling.ts` parses an operator-set read-count ceiling from an environment variable — every
 * one of those is exactly the kind of ordinary integer parsing this test was never meant to
 * forbid, and F20's own `Trace`-based behavioural assertion above (unaffected by this change)
 * remains the test that actually proves a score survives the path unmangled. Enumerating F20's
 * real scoring files by name is what keeps this test testing what its own doc says it tests,
 * regardless of what else `services/jobs/` grows into later.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ProviderMeta, ProviderResult } from '@/contracts/provider';
import type { ScoreBatchOutcome, ScoreResult } from '@/adapters/scorer';
import { enqueueForScoring } from '@/services/jobs/scoring-queue';
import { runScoringWorkerOnce } from '@/services/jobs/scoring-worker';
import { stanceGate } from '@/services/jobs/stance-availability';
import { fakeClock } from '../adapters/fakes';
import {
  batchOutcome,
  fakeHealth,
  fakeItems,
  fakeQueue,
  fakeScoreIds,
  fakeScoreStore,
  type Trace,
} from './fakes';

const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCORING_JOB_FILES = [
  'index.ts',
  'ports.ts',
  'rescore.ts',
  'routing.ts',
  'scorer-client.ts',
  'scores.ts',
  'scoring-queue.ts',
  'scoring-worker.ts',
  'stance-availability.ts',
];
const SCANNED = [
  ...SCORING_JOB_FILES.map((name) => path.join(WEB_ROOT, 'src/services/jobs', name)),
  path.join(WEB_ROOT, 'src/adapters/scorer.ts'),
];

/**
 * Values chosen so a float round-trip is *visible*. `String(Number('0.100000'))` is `'0.1'`;
 * `String(Number('0.30000000000000004'))` keeps its tail but `0.1 + 0.2` produces it, which is
 * the classic way a "harmless" sum appears where a passthrough belonged.
 */
const FRAGILE = {
  bullish: '0.100000',
  bearish: '0.30000000000000004',
  neutral: '0.599999999999999978',
} as const;

const META: ProviderMeta = {
  provider: 'scorer',
  endpoint: 'score',
  requestedAt: '2026-08-30T12:00:00.000Z',
  latencyMs: 3,
  cache: 'miss',
  quotaRemaining: null,
  costUsd: null,
  payloadRef: null,
};

describe('no raw JS number touches a score (F20 §7 step 5)', () => {
  it('carries a float-fragile decimal string through the whole path unchanged', async () => {
    const trace: Trace = [];
    const queue = fakeQueue(trace);
    const items = fakeItems(trace, { 'item-1': 'a body' });
    const store = fakeScoreStore(trace);
    const health = fakeHealth(trace);
    const { clock } = fakeClock();

    await enqueueForScoring(
      { items: [{ itemId: 'item-1', axis: 'reddit', form: 'post' }], at: new Date('2026-08-30T12:00:00.000Z') },
      { queue: queue.port },
    );

    await runScoringWorkerOnce({
      queue: queue.port,
      items: items.port,
      store: store.port,
      health: health.port,
      clock,
      newScoreId: fakeScoreIds(),
      score: async (batch): Promise<ProviderResult<ScoreBatchOutcome>> => ({
        ok: true,
        data: batchOutcome(
          batch.map(
          (item): ScoreResult => ({
            itemId: item.itemId,
            label: 'neutral',
            scores: { ...FRAGILE },
            scorer: {
              scorerId: item.kind,
              scorerVersion: `ProsusAI/finbert@${'4'.repeat(40)}`,
              runtimeVersion: 'sha256:aaaa',
            },
            scoredAt: '2026-08-30T12:00:00.000000Z',
            inputHash: 'e'.repeat(64),
            truncated: false,
          }),
          ),
        ),
        meta: META,
      }),
    });

    expect(store.rows[0]!.scores).toEqual(FRAGILE);

    // And out the other end, through the read gate.
    const gated = stanceGate({
      itemIds: ['item-1'],
      scores: store.rows,
      unscoreable: [],
      health: { state: 'ok', since: '2026-08-30T00:00:00.000Z' },
    });
    expect(gated.kind).toBe('ok');
    if (gated.kind !== 'ok') return;
    expect(gated.scores[0]!.scores).toEqual(FRAGILE);
  });

  it('contains no string-to-number conversion in any scoring module', async () => {
    const files = await scannedFiles();
    expect(files.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf-8');
      source.split('\n').forEach((line, index) => {
        // `Date.parse` and `.getTime()` are deliberately not here: they produce epoch
        // milliseconds for queue-age counters, which are durations and not scores. Nothing in
        // this path may turn a *decimal string* into a number, and these are the ways to do it.
        if (/\bparseFloat\s*\(|\bparseInt\s*\(|\bNumber\s*\(|\.toFixed\s*\(|\+\s*Number\b/.test(line)) {
          offenders.push(`${path.relative(WEB_ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

async function scannedFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const target of SCANNED) {
    let entries;
    try {
      entries = await readdir(target, { withFileTypes: true });
    } catch {
      found.push(target); // a single file, not a directory
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.ts')) found.push(path.join(target, entry.name));
    }
  }
  return found;
}
