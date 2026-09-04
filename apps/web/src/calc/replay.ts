/**
 * Frozen replay (F05 §4.6).
 *
 * > `replay(calculationId)` re-runs the method against the artifact's **frozen** inputs and
 * > assumptions and compares hashes.
 *
 * | Outcome | Meaning | Behaviour |
 * |---|---|---|
 * | `match` | code and data agree | recorded in `calculation_validation_run` |
 * | `result_mismatch` | same inputs, different result ⇒ the code changed without a version bump | recorded, surfaced, **history never repaired in place** |
 * | `method_missing` | the method version no longer exists | recorded; the artifact stays readable |
 *
 * Two properties this module has, and must keep:
 *
 * 1. **It is pure.** It takes an artifact and a registry and returns a verdict. It cannot write,
 *    because `calc/` cannot reach `repositories/` — which is the structural version of
 *    *"history is never repaired in place"*. Persisting the verdict is a separate, deliberate
 *    act in the service layer.
 * 2. **Replay is an explicit validation action, never something that happens when a page opens**
 *    (source §18.2, implemented here). Nothing in this file runs on render.
 */
import { buildArtifact, type CalculationArtifact } from './artifact';
import type { MethodRegistry } from './registry';

export type ReplayOutcome = 'match' | 'result_mismatch' | 'method_missing';

export type ReplayDifference = {
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
};

export type ReplayVerdict = {
  readonly outcome: ReplayOutcome;
  readonly calculationId: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly inputHashExpected: string;
  readonly inputHashActual: string;
  readonly resultHashExpected: string;
  readonly resultHashActual: string;
  readonly differences: readonly ReplayDifference[];
  /** Legible to a non-engineer: it is what the Inspector's Validation section renders. */
  readonly explanation: string;
};

/**
 * Re-runs the artifact's method against the artifact's own frozen inputs and assumptions.
 *
 * The inputs come from the artifact, never from a provider. That is the whole idea: a replay
 * that re-fetched would be testing whether the world changed, when the question is whether the
 * *code* changed.
 */
export function replay(
  artifact: CalculationArtifact,
  registry: MethodRegistry,
): ReplayVerdict {
  const base = {
    calculationId: artifact.calculationId,
    methodId: artifact.methodId,
    methodVersion: artifact.methodVersion,
    inputHashExpected: artifact.inputHash,
    resultHashExpected: artifact.resultHash,
  };

  const entry = registry.find(artifact.methodId, artifact.methodVersion);
  if (entry === undefined) {
    return {
      ...base,
      outcome: 'method_missing',
      inputHashActual: artifact.inputHash,
      resultHashActual: artifact.resultHash,
      differences: [],
      explanation:
        `Version ${artifact.methodVersion} of ${artifact.methodId} is no longer in the ` +
        'registry, so this calculation cannot be re-run. The recorded inputs, steps and result ' +
        'are unchanged and remain readable — a method being retired does not make the numbers ' +
        'it produced untrue, it only makes them uncheckable from here.',
    };
  }

  const rerun = buildArtifact({
    method: {
      methodId: entry.id,
      version: entry.version,
      unit: entry.unit,
      roundingRule: entry.roundingRule,
      workingPrecision: entry.workingPrecision,
      compute: entry.compute,
    },
    subject: artifact.subject,
    asOf: artifact.asOf,
    // Frozen. Both of these come from the artifact, and nothing else is consulted.
    inputs: artifact.inputs,
    assumptions: artifact.assumptions,
    configVersion: artifact.configVersion,
    scenario: artifact.scenario,
    calculationId: artifact.calculationId,
    computedAt: artifact.computedAt,
    retentionClass: artifact.retentionClass,
    ...(artifact.eligibility === 'stale' ? { stale: true } : {}),
  });

  const differences: ReplayDifference[] = [];
  const compare = (field: string, expected: string, actual: string) => {
    if (expected !== actual) differences.push({ field, expected, actual });
  };

  compare('inputHash', artifact.inputHash, rerun.inputHash);
  compare('resultHash', artifact.resultHash, rerun.resultHash);
  compare('result.exact', artifact.result?.exact ?? '—', rerun.result?.exact ?? '—');
  compare('result.display', artifact.result?.display ?? '—', rerun.result?.display ?? '—');
  compare('eligibility', artifact.eligibility, rerun.eligibility);
  compare(
    'abstention.reason',
    artifact.abstention?.reason ?? '—',
    rerun.abstention?.reason ?? '—',
  );
  compare('steps.count', String(artifact.steps.length), String(rerun.steps.length));

  for (const [index, expectedStep] of artifact.steps.entries()) {
    const actualStep = rerun.steps[index];
    if (actualStep === undefined) continue;
    compare(`steps[${index}].key`, expectedStep.key, actualStep.key);
    compare(`steps[${index}].exactValue`, expectedStep.exactValue, actualStep.exactValue);
    compare(`steps[${index}].substituted`, expectedStep.substituted, actualStep.substituted);
  }

  if (differences.length === 0) {
    return {
      ...base,
      outcome: 'match',
      inputHashActual: rerun.inputHash,
      resultHashActual: rerun.resultHash,
      differences: [],
      explanation:
        'Re-running this method against the exact inputs and assumptions recorded here produced ' +
        'the same value, step for step. The number is reproducible from what is stored.',
    };
  }

  return {
    ...base,
    outcome: 'result_mismatch',
    inputHashActual: rerun.inputHash,
    resultHashActual: rerun.resultHash,
    differences,
    explanation:
      'Re-running this method against the exact inputs and assumptions recorded here produced a ' +
      `different result (${differences.map((d) => d.field).join(', ')}). The inputs did not ` +
      'change, so the calculation did — which means the method was edited without its version ' +
      'being bumped. The stored record is left exactly as it was: history is never repaired in ' +
      'place, because a record that gets corrected is a record nobody can rely on.',
  };
}
