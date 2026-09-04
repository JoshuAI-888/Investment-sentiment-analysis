/**
 * MT-11's calibration script — F12 §4.4. Two subcommands:
 *
 *   pnpm exec tsx scripts/eval/sample-calibration.ts sample
 *     Samples `CALIBRATION_SAMPLE_SIZE` (20) answers from the frozen corpus's own recorded judge
 *     scores and writes them, with blank `human*` fields, to
 *     `fixtures/eval-corpus/calibration/sample.json` for the owner to hand-score on the same
 *     Tier C rubric (`services/eval/judge.ts#judgeSystemPrompt`).
 *
 *   pnpm exec tsx scripts/eval/sample-calibration.ts score <path-to-filled-sample.json>
 *     Reads the owner's filled-in file and reports the real Spearman correlation
 *     (`services/eval/spearman.ts`), or the disclosed pending status if any `human*` field is
 *     still blank.
 *
 * **This build's own run is `sample` only** — there is no owner in this sandbox to hand-score
 * anything, so `score` has never been run against real human input here. F12 §6 DoD's own
 * wording: "its result **or its pending status** is recorded" — the pending status is what this
 * feature's build report records, not a fabricated ρ.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCorpus } from '../../src/services/eval/corpus';
import { sampleForOwner, computeCalibration, type CalibrationCandidate, type HumanScore } from '../../src/services/eval/calibration';

const OUT_DIR = join(process.cwd(), 'fixtures', 'eval-corpus', 'calibration');
const SAMPLE_FILE = join(OUT_DIR, 'sample.json');

type SampleRow = {
  readonly answerId: string;
  readonly judgeC1: number;
  readonly judgeC2: number;
  readonly judgeC3: number;
  readonly judgeC4: number;
  readonly humanC1: number | null;
  readonly humanC2: number | null;
  readonly humanC3: number | null;
  readonly humanC4: number | null;
};

async function candidatesFromCorpus(): Promise<readonly CalibrationCandidate[]> {
  const packs = await loadCorpus();
  const candidates: CalibrationCandidate[] = [];
  for (const pack of packs) {
    const fixturePath = join(process.cwd(), 'fixtures', 'llm', 'judge', `${pack.meta.id}.json`);
    try {
      const raw = JSON.parse(await readFile(fixturePath, 'utf-8')) as { body: { content: string } };
      const scores = JSON.parse(raw.body.content) as { c1: number; c2: number; c3: number; c4: number; violations: string[]; rationale: string };
      candidates.push({ answerId: pack.meta.id, judgeScores: scores });
    } catch {
      // No recorded judge fixture for this pack — skip it rather than invent a score.
    }
  }
  return candidates;
}

async function runSample(): Promise<void> {
  const candidates = await candidatesFromCorpus();
  const sample = sampleForOwner(candidates);

  const rows: SampleRow[] = sample.map((c) => ({
    answerId: c.answerId,
    judgeC1: c.judgeScores.c1,
    judgeC2: c.judgeScores.c2,
    judgeC3: c.judgeScores.c3,
    judgeC4: c.judgeScores.c4,
    humanC1: null,
    humanC2: null,
    humanC3: null,
    humanC4: null,
  }));

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(SAMPLE_FILE, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`Sampled ${String(rows.length)} answers to ${SAMPLE_FILE}.`);
  console.log('Owner: fill in humanC1..humanC4 (1-5) for each row on the same rubric, then run:');
  console.log(`  pnpm exec tsx scripts/eval/sample-calibration.ts score ${SAMPLE_FILE}`);
  console.log('');
  console.log('Status: PENDING — no human scores have been recorded yet (MT-11, non-blocking).');
}

async function runScore(path: string): Promise<void> {
  const rows = JSON.parse(await readFile(path, 'utf-8')) as SampleRow[];
  const candidates: CalibrationCandidate[] = rows.map((r) => ({
    answerId: r.answerId,
    judgeScores: { c1: r.judgeC1, c2: r.judgeC2, c3: r.judgeC3, c4: r.judgeC4, violations: [], rationale: '' },
  }));
  const humanScores: HumanScore[] = rows
    .filter((r): r is SampleRow & { humanC1: number; humanC2: number; humanC3: number; humanC4: number } =>
      r.humanC1 !== null && r.humanC2 !== null && r.humanC3 !== null && r.humanC4 !== null,
    )
    .map((r) => ({ answerId: r.answerId, c1: r.humanC1, c2: r.humanC2, c3: r.humanC3, c4: r.humanC4 }));

  const outcome = computeCalibration(candidates, humanScores);
  if (outcome.status === 'pending') {
    console.log(`Status: PENDING — ${outcome.reason}`);
    process.exitCode = 0;
    return;
  }
  console.log(`Spearman ρ = ${outcome.spearmanRho} over n=${String(outcome.n)}`);
  console.log(outcome.meetsGate ? 'Meets the ≥0.7 calibration gate.' : 'Below the ≥0.7 calibration gate — F12 §4.4: raise the judge\'s thresholds rather than trusting it as-is, and record this in MEMORY.md.');
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  if (command === 'sample') {
    await runSample();
    return;
  }
  if (command === 'score') {
    if (arg === undefined) throw new Error('usage: sample-calibration.ts score <path-to-filled-sample.json>');
    await runScore(arg);
    return;
  }
  throw new Error('usage: sample-calibration.ts sample | score <path>');
}

void main();
