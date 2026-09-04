/**
 * Assembling what the Inspector renders (F05 §4.8).
 *
 * Everything here is a projection of two things: the artifact, and the registry entry its method
 * names. Nothing is computed. **Replay is not called** — §4.6: *"Replay is an explicit validation
 * action, never something that happens when a page opens."* The Validation section reads the last
 * recorded outcome and nothing else, which is why this module reaches for
 * `findLatestValidationRun` and not for `runReplay`.
 */
import { ROUNDING_RULES } from '../calc/decimal';
import type { MethodRegistry } from '../calc/registry';
import { effectiveRetentionClass, findLatestValidationRun } from '../repositories/artifacts';
import type { Queryable } from '../repositories/client';
import { getPool } from '../repositories/client';
import { findSecurityById } from '../repositories/security';
import { loadArtifact, METHOD_REGISTRY } from './calculations';

/** The verdict vocabulary §4.6 names, recovered from the row a replay wrote. */
const STATUS_TO_OUTCOME: Readonly<Record<string, string>> = {
  pass: 'match',
  mismatch: 'result_mismatch',
  method_unavailable: 'method_missing',
  error: 'error',
};

const OUTCOME_EXPLANATION: Readonly<Record<string, string>> = {
  match:
    'Re-running this method against the inputs recorded here produced the same value, step for step.',
  result_mismatch:
    'Re-running this method against the inputs recorded here produced a different value. The inputs did not change, so the method did — it was edited without its version being bumped. This record has not been altered and will not be: history is never repaired in place.',
  method_missing:
    'The version of this method that produced the value is no longer in the registry, so it cannot be re-run. Everything recorded here remains readable.',
  error: 'The validation run did not complete. Nothing about this record was changed.',
};

/**
 * `null` when there is no artifact with this id. A missing artifact is a distinct state from an
 * abstaining one, and the page renders them differently.
 */
export async function loadInspectorView(
  calculationId: string,
  options: { readonly registry?: MethodRegistry; readonly pointIndex?: number | null } = {},
  db: Queryable = getPool(),
) {
  const artifact = await loadArtifact(calculationId, db);
  if (artifact === null) return null;

  const registry = options.registry ?? METHOD_REGISTRY;
  const entry = registry.find(artifact.methodId, artifact.methodVersion);
  const [retention, validation, subjectLabel] = await Promise.all([
    effectiveRetentionClass(calculationId, db),
    findLatestValidationRun(calculationId, db),
    resolveSubjectLabel(artifact.subject.kind, artifact.subject.id, db),
  ]);

  const outcome =
    validation === null ? null : (STATUS_TO_OUTCOME[validation.status] ?? validation.status);

  return {
    calculationId: artifact.calculationId,
    methodId: artifact.methodId,
    methodVersion: artifact.methodVersion,
    // The registry is the sole runtime description of a metric. If its version is gone, the
    // artifact is still readable — so the title falls back to the id rather than to nothing.
    title: entry?.title ?? artifact.methodId,
    subjectKind: artifact.subject.kind,
    subjectId: artifact.subject.id,
    subjectLabel,
    asOf: artifact.asOf,
    computedAt: artifact.computedAt,
    scenario: artifact.scenario.kind,
    configVersion: artifact.configVersion,
    eligibility: artifact.eligibility,
    eligibilityRules: entry?.eligibilityRules ?? [],
    abstentionReason: artifact.abstention?.message ?? null,
    exact: artifact.result?.exact ?? null,
    display: artifact.result?.display ?? null,
    unit: artifact.result?.unit ?? entry?.unit ?? '',
    roundingRule: artifact.result?.roundingRule ?? entry?.roundingRule ?? '',
    roundingRuleDescription:
      ROUNDING_RULES[artifact.result?.roundingRule ?? entry?.roundingRule ?? '']?.description ??
      'no rounding rule recorded',
    symbolicFormula:
      entry?.symbolicFormula ??
      'The registry no longer carries this method version, so its symbolic formula cannot be shown.',
    inputs: artifact.inputs.map((input) => ({
      key: input.key,
      value: input.value,
      unit: input.unit,
      dataType: input.dataType,
      source: input.source,
      provider: input.provenance.provider,
      providerField: input.provenance.providerField,
      sourceUrl: input.provenance.sourceUrl,
      observedAt: input.provenance.observedAt,
      availableAt: input.provenance.availableAt,
      freshness: input.freshness,
      quality: input.quality,
      rawPayloadId: input.provenance.rawPayloadId,
    })),
    assumptions: artifact.assumptions.map((assumption) => ({
      key: assumption.key,
      value: assumption.value,
      officialValue: assumption.officialValue,
      unit: assumption.unit,
      source: assumption.source,
      min: assumption.min,
      max: assumption.max,
      editable: assumption.editable,
    })),
    steps: artifact.steps.map((step) => ({
      index: step.index,
      key: step.key,
      label: step.label,
      expression: step.expression,
      substituted: step.substituted,
      exactValue: step.exactValue,
      displayValue: step.displayValue,
      unit: step.unit,
      status: step.status,
    })),
    points: artifact.points === null ? null : artifact.points.map((point) => ({ ...point })),
    // F-03's selection-bias disclosure. Not optional copy (§4.4), so an empty list is itself
    // reported rather than rendering as a clean bill of health.
    limitations:
      entry === undefined || entry.limitations.length === 0
        ? ['The limitations for this method version are not available from the registry.']
        : entry.limitations,
    warnings: artifact.warnings,
    inputHash: artifact.inputHash,
    resultHash: artifact.resultHash,
    retentionStored: retention?.stored ?? artifact.retentionClass,
    retentionEffective: retention?.effective ?? artifact.retentionClass,
    retentionReasons: (retention?.references ?? []).map(
      (reference) => `${reference.kind.replace('_', ' ')} — ${reference.detail}`,
    ),
    validation:
      validation === null || outcome === null
        ? null
        : {
            status: validation.status,
            outcome,
            triggerType: validation.triggerType,
            requestedBy: validation.requestedBy,
            startedAt: validation.startedAt.toISOString(),
            explanation: OUTCOME_EXPLANATION[outcome] ?? 'No explanation was recorded.',
          },
    validationActionNote:
      'Running a validation is a signed-in action. Sign-in is not built yet (F02), so the ' +
      'button is inactive rather than open — an unauthenticated write is not a smaller problem ' +
      'than a missing button.',
    highlightPointIndex: options.pointIndex ?? null,
  };
}

/**
 * The subject's display label, resolved **now** rather than frozen into the artifact.
 *
 * F03 §5: *"a symbol is reassignable"*, so `security.id` is the identity and the symbol is an
 * attribute with history. Storing the ticker on the artifact would show the symbol as it was,
 * which is the wrong one to show a reader looking at the record today — and the record already
 * carries the id that resolves to the right answer. `null` when the subject is not a security we
 * hold, which the Inspector renders as the id.
 */
async function resolveSubjectLabel(
  kind: string,
  subjectId: string,
  db: Queryable,
): Promise<string | null> {
  if (kind !== 'security') return null;
  // A subject id that is not a uuid belongs to no `security` row; asking would be a type error
  // in Postgres rather than an empty result.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) {
    return null;
  }
  const security = await findSecurityById(subjectId, db);
  return security?.symbol ?? null;
}

export type InspectorViewData = NonNullable<Awaited<ReturnType<typeof loadInspectorView>>>;
