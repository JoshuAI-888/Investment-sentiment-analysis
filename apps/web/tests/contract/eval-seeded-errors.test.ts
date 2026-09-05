import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSeededErrorsFromDir, reportSeededErrorCoverage } from '../../src/services/eval/seeded-errors';
import { seededErrorAnswer } from '../../src/services/eval/contracts';

const SEEDED_DIR = join(__dirname, '../../fixtures/eval/seeded-errors');

describe('seeded-error corpus format', () => {
  it('loads every committed answer and each satisfies the seededErrorAnswer schema', () => {
    const answers = loadSeededErrorsFromDir(SEEDED_DIR);
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(seededErrorAnswer.safeParse(answer).success).toBe(true);
    }
  });

  it('every answer carries a distinct id and a non-empty base/faulted pair', () => {
    const answers = loadSeededErrorsFromDir(SEEDED_DIR);
    const ids = new Set(answers.map((a) => a.id));
    expect(ids.size).toBe(answers.length);
    for (const answer of answers) {
      expect(answer.baseAnswer.length).toBeGreaterThan(0);
      expect(answer.answer.length).toBeGreaterThan(0);
      expect(answer.answer).not.toBe(answer.baseAnswer);
    }
  });

  it('reports coverage honestly: all nine fault classes represented at small scale, explicitly short of the ≥40-answer production minimum', () => {
    const answers = loadSeededErrorsFromDir(SEEDED_DIR);
    const report = reportSeededErrorCoverage(answers);
    expect(report.total).toBe(9);
    expect(report.totalFaultClasses).toBe(9);
    // Every fault class is represented at least once (incl. stale_date, added once JudgeInput
    // carried dates — lane-review round 1 finding 1) — but nine answers is still far short of
    // the ≥40-answer production minimum this report exists to be honest about.
    expect(report.classesRepresented).toBe(9);
    expect(report.meetsProductionMinimum).toBe(false);
  });
});
