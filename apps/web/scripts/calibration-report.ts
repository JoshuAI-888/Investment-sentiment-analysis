/**
 * MT-11 calibration script (F12 §4.4, `DEPLOY.md` MT-11, DoD item 7).
 *
 * **Review finding (lane-review round 1 finding 7).** F12's calibration story previously had
 * the library functions (`sampleForCalibration`, `computeCalibration`) but no entry point and
 * no function reducing a four-axis `JudgeResponse` to the scalar the Spearman correlation
 * actually needs — so DoD item 7 ("a calibration script exists") could not be honestly checked.
 * This is that script.
 *
 * Usage:
 *   pnpm --filter web run calibration-report
 *     → samples up to 20 corpus answers (fixture-judged, `PROVIDER_MODE=fixture`) and prints
 *       them for the owner to hand-score 1-5 on the same C1-C4 rubric (F12 §4.3), then average.
 *
 *   pnpm --filter web run calibration-report -- <path-to-human-scores.json>
 *     → reads a `{ "<packId>": <1-5> }` file the owner saved after hand-scoring, and reports
 *       the Spearman correlation between the human and judge scores (F12 §4.4).
 *
 * Non-blocking to the build loop (`04-BUILD-LOOP.md`); blocking to any claim that the Tier C
 * gate means something (`01-PRODUCT-SPEC.md` §4 Tier C).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpusFromDir } from '../src/services/eval/corpus';
import { createFixtureJudgeClient, loadJudgeResponseMap } from '../src/services/eval/fixture-judge-client';
import { buildJudgeInput, runJudge } from '../src/services/eval/judge';
import {
  CALIBRATION_SAMPLE_SIZE,
  computeCalibration,
  reduceToScalar,
  sampleForCalibration,
} from '../src/services/eval/calibration';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(here, '../fixtures/eval/corpus');
const JUDGE_RESPONSES_PATH = path.join(here, '../fixtures/eval/judge-responses/corpus.json');

// `pnpm run <script> -- <arg>` forwards the literal `--` into argv (unlike `npm run`), so it is
// filtered out here rather than trusted to be absent.
const humanScoresPath = process.argv.slice(2).filter((arg) => arg !== '--')[0];

const packs = loadCorpusFromDir(CORPUS_DIR);
const sample = sampleForCalibration(packs, CALIBRATION_SAMPLE_SIZE);

const responses = loadJudgeResponseMap(JUDGE_RESPONSES_PATH);
const client = createFixtureJudgeClient(responses);

const judged: { packId: string; judgeScore: number }[] = [];
for (const pack of sample) {
  const input = buildJudgeInput({
    answerText: pack.referenceAnswer,
    items: pack.pack.items,
    storedMetrics: pack.storedMetrics,
  });
  const response = await runJudge(client, input);
  judged.push({ packId: pack.id, judgeScore: reduceToScalar(response) });
}

if (humanScoresPath === undefined || !existsSync(humanScoresPath)) {
  process.stdout.write(
    `MT-11 calibration — ${judged.length} answer(s) sampled for hand-scoring.\n` +
      'Owner: score each 1-5 on the C1-C4 rubric (docs/features/F12-evaluation-harness.md §4.3), ' +
      'average the four axes, and save your scores as JSON: {"<packId>": <1-5>, ...}\n\n',
  );
  for (const j of judged) {
    process.stdout.write(`  ${j.packId.padEnd(24)} judge=${j.judgeScore.toFixed(2)}   human=____\n`);
  }
  process.stdout.write(
    '\nRe-run this script with the saved JSON file as its first argument to compute the ' +
      'Spearman correlation once hand-scoring is done:\n' +
      '  pnpm --filter web run calibration-report -- <path-to-human-scores.json>\n\n',
  );
  const pending = computeCalibration([]);
  process.stdout.write(`Calibration status: ${pending.status} — ${pending.status === 'pending' ? pending.reason : ''}\n`);
  process.exit(0);
}

const humanScores = JSON.parse(readFileSync(humanScoresPath, 'utf8')) as Record<string, number>;
const samples = judged
  .filter((j) => humanScores[j.packId] !== undefined)
  .map((j) => ({ id: j.packId, judgeScore: j.judgeScore, humanScore: humanScores[j.packId]! }));

if (samples.length < judged.length) {
  process.stderr.write(
    `Warning: ${judged.length - samples.length} sampled pack(s) have no matching human score in ${humanScoresPath}.\n`,
  );
}

const result = computeCalibration(samples);
if (result.status === 'pending') {
  process.stdout.write(`Calibration status: pending — ${result.reason}\n`);
} else {
  const verdict = result.trusted
    ? 'TRUSTED'
    : 'BELOW THRESHOLD — raise the judge thresholds and record this in docs/MEMORY.md';
  process.stdout.write(
    `Calibration (MT-11): n=${result.n}, spearman=${result.spearman.toFixed(3)} (threshold ${result.threshold}) — ${verdict}\n`,
  );
}
