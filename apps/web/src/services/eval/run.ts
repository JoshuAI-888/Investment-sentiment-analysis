/**
 * Orchestrates one eval run and formats its report (F12 §4.6: "prints a per-axis table and the
 * Tier B/C verdicts, and fails the build on a gate breach"). The "fails the build" half is the
 * vitest assertions in `tests/eval/`, not this module — this module only computes and renders.
 */
import Decimal from 'decimal.js';
import type { CorpusJudgeResult } from './gate';
import { evaluateTierCGate } from './gate';
import type {
  CalibrationResult,
  CorpusPack,
  EvalModelRoute,
  EvalRunRecord,
  SeededErrorAnswer,
} from './contracts';
import { measureVerifier, type Verifier } from './verifier-harness';
import { computeStanceMacroF1 } from './stance-accuracy';

export type RunEvalHarnessInput = {
  runId: string;
  runAt: Date;
  corpusVersion: string;
  modelRoute: EvalModelRoute;
  judged: readonly CorpusJudgeResult[];
  tierBViolationCount: number;
  seeded?: readonly SeededErrorAnswer[];
  verify?: Verifier;
  calibration?: CalibrationResult | null;
  /** Tier D1 (`stance-accuracy.ts`) is computed from the same corpus packs, when supplied. */
  corpusPacks?: readonly CorpusPack[];
};

export function runEvalHarness(input: RunEvalHarnessInput): EvalRunRecord {
  const tierC = evaluateTierCGate(input.judged, input.tierBViolationCount);
  const verifier =
    input.seeded !== undefined && input.verify !== undefined
      ? measureVerifier(input.seeded, input.verify)
      : null;
  const stanceD1 = input.corpusPacks !== undefined ? computeStanceMacroF1(input.corpusPacks) : null;

  return {
    runId: input.runId,
    runAt: input.runAt,
    corpusVersion: input.corpusVersion,
    modelRoute: input.modelRoute,
    tierC,
    verifier,
    calibration: input.calibration ?? null,
    stanceD1,
  };
}

/** Renders a decimal string to a fixed number of places for display, never via a JS float round-trip. */
function fixed(value: string, places: number): string {
  return new Decimal(value).toFixed(places);
}

export function formatEvalReport(record: EvalRunRecord): string {
  const { tierC } = record;
  const lines: string[] = [
    `Eval run ${record.runId} — corpus ${record.corpusVersion} — judge ` +
      `${record.modelRoute.judgeModelId}@${record.modelRoute.judgeModelVersion} (temperature 0)`,
    '',
    'Axis     Mean',
    `C1       ${fixed(tierC.perAxisMean.c1, 2)}`,
    `C2       ${fixed(tierC.perAxisMean.c2, 2)}  (floor ${tierC.c2Floor} — no answer may score below this)`,
    `C3       ${fixed(tierC.perAxisMean.c3, 2)}`,
    `C4       ${fixed(tierC.perAxisMean.c4, 2)}`,
    `Overall  ${fixed(tierC.overallMean, 2)}  (threshold 4.00)`,
    '',
    `Tier C gate: ${tierC.passed ? 'PASS' : 'FAIL'}`,
  ];
  for (const reason of tierC.reasons) lines.push(`  - ${reason}`);

  if (record.verifier !== null) {
    lines.push('');
    lines.push(
      `Tier B verifier — B7 catch rate: ${record.verifier.catchRate} ` +
        `(>= ${record.verifier.catchRateThreshold}: ${record.verifier.catchRatePassed ? 'PASS' : 'FAIL'})`,
    );
    lines.push(
      `Tier B verifier — B8 false-positive rate: ${record.verifier.falsePositiveRate} ` +
        `(<= ${record.verifier.falsePositiveRateThreshold}: ${record.verifier.falsePositiveRatePassed ? 'PASS' : 'FAIL'})`,
    );
  }

  if (record.stanceD1 !== null) {
    lines.push('');
    lines.push('Tier D1 stance macro-F1 per axis (informational on this starter corpus — see DEFERRED):');
    for (const axis of ['reddit', 'x', 'substack'] as const) {
      const { macroF1, n } = record.stanceD1[axis];
      lines.push(`  ${axis.padEnd(9)} ${macroF1 === null ? 'no labelled items' : `${fixed(macroF1, 2)} (n=${n})`}`);
    }
  }

  if (record.calibration !== null) {
    lines.push('');
    if (record.calibration.status === 'pending') {
      lines.push(`Calibration (MT-11): pending — ${record.calibration.reason}`);
    } else {
      const verdict = record.calibration.trusted
        ? 'trusted'
        : 'BELOW THRESHOLD — raise the judge thresholds and record this in MEMORY.md';
      lines.push(
        `Calibration (MT-11): n=${record.calibration.n}, spearman=${record.calibration.spearman.toFixed(3)} (${verdict})`,
      );
    }
  }

  return lines.join('\n');
}
