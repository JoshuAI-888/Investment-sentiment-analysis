/**
 * The seeded-error corpus loader and coverage report (F12 §4.2). Same discipline as `corpus.ts`:
 * frozen JSON fixtures under `fixtures/eval/seeded-errors/`, read and validated, never generated
 * at build time.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { faultClass, seededErrorAnswer, type FaultClass, type SeededErrorAnswer } from './contracts';

export function loadSeededErrorsFromDir(dir: string): SeededErrorAnswer[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  return files.map((file) => {
    const raw: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const parsed = seededErrorAnswer.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `loadSeededErrorsFromDir: ${file} failed the seededErrorAnswer schema — ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  });
}

/** F12 §4.2 / `05-TEST-STRATEGY.md` §5.2's production bar. */
export const PRODUCTION_SEEDED_ERROR_MINIMUM = 40;

export type SeededErrorCoverageReport = {
  countByFaultClass: Record<FaultClass, number>;
  total: number;
  classesRepresented: number;
  totalFaultClasses: number;
  /** False for the starter set by design — see the lane report's DEFERRED field. */
  meetsProductionMinimum: boolean;
};

export function reportSeededErrorCoverage(answers: readonly SeededErrorAnswer[]): SeededErrorCoverageReport {
  const countByFaultClass = Object.fromEntries(
    faultClass.options.map((fc) => [fc, 0]),
  ) as Record<FaultClass, number>;

  for (const answer of answers) countByFaultClass[answer.faultClass] += 1;

  const classesRepresented = faultClass.options.filter((fc) => countByFaultClass[fc] > 0).length;

  return {
    countByFaultClass,
    total: answers.length,
    classesRepresented,
    totalFaultClasses: faultClass.options.length,
    meetsProductionMinimum: answers.length >= PRODUCTION_SEEDED_ERROR_MINIMUM,
  };
}
