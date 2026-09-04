/**
 * The calculation service — where the kernel is composed (F05 §3).
 *
 * `calc/` is pure and `analytics/` is data; neither may reach `repositories/`
 * (`02-ARCHITECTURE-CONTRACTS.md` §3). So this is the only place the three meet: it binds each
 * registry descriptor to its arithmetic, persists an artifact, reads one back, and records a
 * replay.
 *
 * That layering is not incidental to the feature. `replay()` **cannot** write, because the
 * module it lives in cannot see a database — which is the structural form of §4.6's *"history
 * never repaired in place"*. Persisting a verdict is a separate, deliberate act, and it appends
 * a `calculation_validation_run` row; it never touches the artifact.
 */
import {
  buildArtifact,
  type CalculationArtifact,
  type CalculationInputValue,
  type CalculationStepRecord,
  type DerivedPoint,
  type ResolvedAssumption,
  type Scenario,
  type Subject,
} from '../calc/artifact';
import { canonicalHash } from '../calc/canonical';
import {
  computeAttentionRankChange,
  ATTENTION_RANK_CHANGE_ID,
  ATTENTION_RANK_CHANGE_VERSION,
} from '../calc/methods/attention-rank-change';
import {
  computeAttentionRankChangeV1_1,
  ATTENTION_RANK_CHANGE_V1_1_ID,
  ATTENTION_RANK_CHANGE_V1_1_VERSION,
} from '../calc/methods/attention-rank-change-v1_1';
import {
  computeAttentionMentionDelta,
  ATTENTION_MENTION_DELTA_ID,
  ATTENTION_MENTION_DELTA_VERSION,
} from '../calc/methods/attention-mention-delta';
import {
  computeAttentionMentionGrowth,
  ATTENTION_MENTION_GROWTH_ID,
  ATTENTION_MENTION_GROWTH_VERSION,
} from '../calc/methods/attention-mention-growth';
import {
  computeAttentionEngagementPerMention,
  ATTENTION_ENGAGEMENT_PER_MENTION_ID,
  ATTENTION_ENGAGEMENT_PER_MENTION_VERSION,
} from '../calc/methods/attention-engagement-per-mention';
import {
  computeAttentionMentionsZscore,
  ATTENTION_MENTIONS_ZSCORE_ID,
  ATTENTION_MENTIONS_ZSCORE_VERSION,
} from '../calc/methods/attention-mentions-zscore';
import { computeSocialStance, SOCIAL_STANCE_VERSION } from '../calc/methods/social-stance';
import { computeNewsSentiment, NEWS_SENTIMENT_ID, NEWS_SENTIMENT_VERSION } from '../calc/methods/news-sentiment';
import { computePriceRegime, PRICE_REGIME_ID, PRICE_REGIME_VERSION } from '../calc/methods/price-regime';
import {
  computePriceVolatility20,
  PRICE_VOLATILITY_20_ID,
  PRICE_VOLATILITY_20_VERSION,
} from '../calc/methods/price-volatility';
import {
  computeMarketSectorBreadth,
  MARKET_SECTOR_BREADTH_ID,
  MARKET_SECTOR_BREADTH_VERSION,
} from '../calc/methods/market-sector-breadth';
import {
  computeMarketComposite,
  MARKET_COMPOSITE_ID,
  MARKET_COMPOSITE_VERSION,
} from '../calc/methods/market-composite';
import {
  computeDivergenceState,
  MARKET_DIVERGENCE_STATE_ID,
  MARKET_DIVERGENCE_STATE_VERSION,
} from '../calc/methods/divergence-state';
import { computeTechnicalRsi14, TECHNICAL_RSI_14_ID, TECHNICAL_RSI_14_VERSION } from '../calc/methods/technical-rsi';
import {
  computeTechnicalMovingAverage20,
  computeTechnicalMovingAverage50,
  TECHNICAL_MOVING_AVERAGE_20_ID,
  TECHNICAL_MOVING_AVERAGE_50_ID,
  TECHNICAL_MOVING_AVERAGE_VERSION,
} from '../calc/methods/technical-moving-average';
import {
  computeTechnicalRecentHigh20,
  computeTechnicalRecentLow20,
  TECHNICAL_RECENT_HIGH_20_ID,
  TECHNICAL_RECENT_LOW_20_ID,
  TECHNICAL_RECENT_RANGE_VERSION,
} from '../calc/methods/technical-recent-range';
import { replay, type ReplayVerdict } from '../calc/replay';
import type { MethodCompute } from '../calc/artifact';
import {
  MethodRegistry,
  validateDescriptor,
  type MethodRegistryEntry,
} from '../calc/registry';
import { methods as METHOD_DESCRIPTORS } from '../analytics/registry';
import { insertArtifact, findCalculationSnapshot } from '../repositories/calculations';
import {
  findCalculationInputs,
  findCalculationSteps,
  findLatestValidationRun,
  insertValidationRun,
  insertReplayAuditEvent,
} from '../repositories/artifacts';
import type { Queryable } from '../repositories/client';
import { getPool, withTransaction } from '../repositories/client';

// ── Binding the two halves of the registry ────────────────────────────────────────────────────

/**
 * `methodId@version` → arithmetic. Keyed by version because §4.2's rule is that a numeric change
 * bumps the version: a compute function silently re-pointed at an old version is precisely the
 * `result_mismatch` §4.6 exists to catch, and it should be impossible rather than caught.
 */
const COMPUTE_BY_VERSION: Readonly<Record<string, MethodCompute>> = {
  [`${ATTENTION_RANK_CHANGE_ID}@${ATTENTION_RANK_CHANGE_VERSION}`]: computeAttentionRankChange,
  [`${ATTENTION_RANK_CHANGE_V1_1_ID}@${ATTENTION_RANK_CHANGE_V1_1_VERSION}`]:
    computeAttentionRankChangeV1_1,
  [`${ATTENTION_MENTION_DELTA_ID}@${ATTENTION_MENTION_DELTA_VERSION}`]: computeAttentionMentionDelta,
  [`${ATTENTION_MENTION_GROWTH_ID}@${ATTENTION_MENTION_GROWTH_VERSION}`]:
    computeAttentionMentionGrowth,
  [`${ATTENTION_ENGAGEMENT_PER_MENTION_ID}@${ATTENTION_ENGAGEMENT_PER_MENTION_VERSION}`]:
    computeAttentionEngagementPerMention,
  [`${ATTENTION_MENTIONS_ZSCORE_ID}@${ATTENTION_MENTIONS_ZSCORE_VERSION}`]:
    computeAttentionMentionsZscore,
  [`social.stance_reddit@${SOCIAL_STANCE_VERSION}`]: computeSocialStance,
  [`social.stance_x@${SOCIAL_STANCE_VERSION}`]: computeSocialStance,
  [`social.stance_substack@${SOCIAL_STANCE_VERSION}`]: computeSocialStance,
  [`${NEWS_SENTIMENT_ID}@${NEWS_SENTIMENT_VERSION}`]: computeNewsSentiment,
  [`${PRICE_REGIME_ID}@${PRICE_REGIME_VERSION}`]: computePriceRegime,
  [`${PRICE_VOLATILITY_20_ID}@${PRICE_VOLATILITY_20_VERSION}`]: computePriceVolatility20,
  [`${MARKET_SECTOR_BREADTH_ID}@${MARKET_SECTOR_BREADTH_VERSION}`]: computeMarketSectorBreadth,
  [`${MARKET_COMPOSITE_ID}@${MARKET_COMPOSITE_VERSION}`]: computeMarketComposite,
  [`${MARKET_DIVERGENCE_STATE_ID}@${MARKET_DIVERGENCE_STATE_VERSION}`]: computeDivergenceState,
  [`${TECHNICAL_RSI_14_ID}@${TECHNICAL_RSI_14_VERSION}`]: computeTechnicalRsi14,
  [`${TECHNICAL_MOVING_AVERAGE_20_ID}@${TECHNICAL_MOVING_AVERAGE_VERSION}`]: computeTechnicalMovingAverage20,
  [`${TECHNICAL_MOVING_AVERAGE_50_ID}@${TECHNICAL_MOVING_AVERAGE_VERSION}`]: computeTechnicalMovingAverage50,
  [`${TECHNICAL_RECENT_HIGH_20_ID}@${TECHNICAL_RECENT_RANGE_VERSION}`]: computeTechnicalRecentHigh20,
  [`${TECHNICAL_RECENT_LOW_20_ID}@${TECHNICAL_RECENT_RANGE_VERSION}`]: computeTechnicalRecentLow20,
};

export class MethodBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MethodBindingError';
  }
}

/** Validates every descriptor and pairs it with its arithmetic. Drift on either side throws. */
export function bindRegistry(
  descriptors: readonly unknown[],
  computeByVersion: Readonly<Record<string, MethodCompute>> = COMPUTE_BY_VERSION,
): MethodRegistry {
  const entries: MethodRegistryEntry[] = [];
  const bound = new Set<string>();

  for (const raw of descriptors) {
    const descriptor = validateDescriptor(raw);
    const key = `${descriptor.id}@${descriptor.version}`;
    const compute = computeByVersion[key];
    if (compute === undefined) {
      throw new MethodBindingError(
        `The registry describes ${key} but no arithmetic is bound to it. A described method that ` +
          'cannot run is a formula in the catalogue that produces nothing — and worse, an ' +
          'artifact recorded against it could never be replayed.',
      );
    }
    entries.push({ ...descriptor, compute });
    bound.add(key);
  }

  for (const key of Object.keys(computeByVersion)) {
    if (bound.has(key)) continue;
    throw new MethodBindingError(
      `${key} has arithmetic bound to it but no registry entry. The registry is the sole runtime ` +
        'description of a metric (§4.4); a method that runs without one has no formula, no ' +
        'bounds and no limitations to render.',
    );
  }

  return new MethodRegistry(entries);
}

/** The application's registry. Built once, at module load, so drift fails at startup. */
export const METHOD_REGISTRY = bindRegistry(METHOD_DESCRIPTORS);

// ── Persistence ───────────────────────────────────────────────────────────────────────────────

const STANDARD_RETENTION_DAYS = 90;

/** §4.2's `eligibility` onto F03's `calculation_snapshot.status` vocabulary. */
function statusFor(artifact: CalculationArtifact): string {
  switch (artifact.eligibility) {
    case 'ok':
      return 'complete';
    case 'stale':
      return 'stale';
    case 'not_applicable':
      return 'ineligible';
    case 'insufficient_data':
      return 'insufficient_data';
  }
}

function expiresAt(artifact: CalculationArtifact): Date | null {
  if (artifact.retentionClass === 'permanent') return null;
  const at = new Date(artifact.computedAt);
  at.setUTCDate(at.getUTCDate() + STANDARD_RETENTION_DAYS);
  return at;
}

function inputRow(input: CalculationInputValue, sequence: number): Record<string, unknown> {
  return {
    inputKey: input.key,
    sequence,
    // The decimal is stored as a string inside JSON. A JSON number is an IEEE 754 double the
    // moment it is parsed, and the result hash would then depend on the parser (migration 0004).
    normalizedValue: JSON.stringify({ value: input.value }),
    providerOriginalValue: null,
    dataType: input.dataType,
    unit: input.unit,
    currency: null,
    scale: null,
    provider: input.provenance.provider,
    providerRecordId: null,
    rawPayloadId: input.provenance.rawPayloadId,
    sourceUrl: input.provenance.sourceUrl,
    primarySourceRef: JSON.stringify({
      source: input.source,
      providerField: input.provenance.providerField,
    }),
    observedAt: input.provenance.observedAt,
    availableAt: input.provenance.availableAt,
    ingestedAt: input.provenance.ingestedAt,
    fiscalPeriod: null,
    normalizationRule: null,
    transformation: JSON.stringify({}),
    qualityStatus: input.quality,
    freshnessStatus: input.freshness,
    licenseClass: input.provenance.licenseClass,
    redactionClass: input.provenance.redactionClass,
    valueHash: canonicalHash(input),
  };
}

/**
 * What `step_hash` is taken over. `index` is stringified because canonicalization refuses a JS
 * number outright — correctly: admitting one "harmless" integer is how the first float gets in.
 */
function stepFingerprint(step: CalculationStepRecord): Record<string, unknown> {
  const { index, ...rest } = step;
  return { ...rest, index: String(index) };
}

function stepRow(step: CalculationStepRecord): Record<string, unknown> {
  return {
    sequence: step.index,
    stepKey: step.key,
    parentStepKey: step.parentKey,
    label: step.label,
    formulaSymbolic: step.expression,
    formulaSubstituted: step.substituted,
    operands: JSON.stringify(step.operands),
    exactOutput: JSON.stringify({ value: step.exactValue }),
    displayOutput: JSON.stringify({ value: step.displayValue }),
    unit: step.unit,
    roundingRule: step.roundingRule,
    status: step.status,
    notes: JSON.stringify(step.notes),
    stepHash: canonicalHash(stepFingerprint(step)),
  };
}

/**
 * Writes the artifact, its inputs and its steps in one transaction (F03's `insertArtifact`).
 * A half-written artifact is not inspectable, and an inspectable artifact is the only kind
 * product invariant §6.2 admits.
 */
export async function persistArtifact(artifact: CalculationArtifact): Promise<string> {
  const snapshot = await insertArtifact({
    snapshot: {
      id: artifact.calculationId,
      metricKey: artifact.methodId,
      subjectType: artifact.subject.kind,
      subjectId: artifact.subject.id,
      observationKey: null,
      scenarioType: artifact.scenario.kind,
      officialCalculationId: null,
      ownerUserId: artifact.scenario.kind === 'personal' ? artifact.scenario.userId : null,
      methodKey: artifact.methodId,
      methodVersion: artifact.methodVersion,
      configVersion: artifact.configVersion,
      universeVersion: null,
      assumptionProfileVersion: null,
      inputCutoff: new Date(artifact.asOf),
      status: statusFor(artifact) as never,
      exactResult: { exact: artifact.result?.exact ?? null, unit: artifact.result?.unit ?? null },
      displayResult: {
        display: artifact.result?.display ?? null,
        roundingRule: artifact.result?.roundingRule ?? null,
        unit: artifact.result?.unit ?? null,
        eligibility: artifact.eligibility,
        abstention: artifact.abstention,
      },
      points: artifact.points,
      assumptions: artifact.assumptions,
      warnings: artifact.warnings,
      inputHash: artifact.inputHash,
      resultHash: artifact.resultHash,
      predecessorCalculationId: null,
      retentionClass: artifact.retentionClass,
      expiresAt: expiresAt(artifact),
    },
    inputs: artifact.inputs.map((input, index) => inputRow(input, index)),
    steps: artifact.steps.map(stepRow),
  });

  return snapshot.id;
}

type StoredResultJson = {
  display: string | null;
  roundingRule: string | null;
  unit: string | null;
  eligibility: CalculationArtifact['eligibility'];
  abstention: CalculationArtifact['abstention'];
};

/**
 * Reads an artifact back into exactly the shape it was built in. The round trip is asserted
 * byte-for-byte on the decimals in `tests/contract/artifact-round-trip.test.ts` — a `numeric`
 * that survives `100.00` and loses `0.1` is not detectable any other way.
 */
export async function loadArtifact(
  calculationId: string,
  db: Queryable = getPool(),
): Promise<CalculationArtifact | null> {
  const snapshot = await findCalculationSnapshot(calculationId, db);
  if (snapshot === null) return null;

  const [inputRows, stepRows] = await Promise.all([
    findCalculationInputs(calculationId, db),
    findCalculationSteps(calculationId, db),
  ]);

  const exactResult = snapshot.exactResult as { exact: string | null; unit: string | null };
  const displayResult = snapshot.displayResult as StoredResultJson;

  const inputs: CalculationInputValue[] = inputRows.map((row) => ({
    key: row.inputKey,
    value: (row.normalizedValue as { value: string }).value,
    unit: row.unit,
    dataType: row.dataType as CalculationInputValue['dataType'],
    source: (row.primarySourceRef as { source: string }).source,
    provenance: {
      provider: row.provider,
      providerField: (row.primarySourceRef as { providerField: string | null }).providerField,
      sourceUrl: row.sourceUrl,
      // Already microsecond-precision ISO text from the query (StoredInputRow's own doc
      // comment) — passed through as-is rather than round-tripped via a JS `Date`, which would
      // silently truncate to millisecond precision (lane-review finding 6).
      observedAt: row.observedAt,
      availableAt: row.availableAt,
      ingestedAt: row.ingestedAt,
      rawPayloadId: row.rawPayloadId,
      licenseClass: row.licenseClass,
      redactionClass: row.redactionClass,
    },
    quality: row.qualityStatus as CalculationInputValue['quality'],
    freshness: row.freshnessStatus as CalculationInputValue['freshness'],
  }));

  const steps: CalculationStepRecord[] = stepRows.map((row) => ({
    index: row.sequence,
    key: row.stepKey,
    parentKey: row.parentStepKey,
    label: row.label,
    expression: row.formulaSymbolic,
    substituted: row.formulaSubstituted,
    exactValue: (row.exactOutput as { value: string }).value,
    displayValue: (row.displayOutput as { value: string }).value,
    unit: row.unit ?? '',
    roundingRule: row.roundingRule ?? '',
    status: row.status as CalculationStepRecord['status'],
    operands: row.operands as Readonly<Record<string, string>>,
    notes: row.notes as readonly string[],
  }));

  return {
    calculationId: snapshot.id,
    methodId: snapshot.methodKey,
    methodVersion: snapshot.methodVersion,
    subject: {
      kind: snapshot.subjectType as Subject['kind'],
      id: snapshot.subjectId,
      label: null,
    },
    asOf: snapshot.inputCutoff.toISOString(),
    inputs,
    assumptions: snapshot.assumptions as ResolvedAssumption[],
    steps,
    result:
      exactResult.exact === null
        ? null
        : {
            exact: exactResult.exact,
            display: displayResult.display ?? '',
            roundingRule: displayResult.roundingRule ?? '',
            unit: displayResult.unit ?? '',
          },
    abstention: displayResult.abstention,
    eligibility: displayResult.eligibility,
    inputHash: snapshot.inputHash,
    resultHash: snapshot.resultHash,
    configVersion: snapshot.configVersion,
    scenario:
      snapshot.scenarioType === 'personal' && snapshot.ownerUserId !== null
        ? { kind: 'personal', userId: snapshot.ownerUserId, profileId: '' }
        : { kind: 'official' },
    points: (snapshot.points as DerivedPoint[] | null) ?? null,
    warnings: snapshot.warnings,
    retentionClass: snapshot.retentionClass,
    computedAt: snapshot.computedAt.toISOString(),
  };
}

// ── Replay (§4.6) ─────────────────────────────────────────────────────────────────────────────

const VERDICT_TO_STATUS = {
  match: 'pass',
  result_mismatch: 'mismatch',
  method_missing: 'method_unavailable',
} as const;

export type RunReplayArgs = {
  readonly calculationId: string;
  readonly requestedBy: string;
  readonly triggerType?: 'user_replay' | 'scheduled_sample' | 'release_test' | 'issue_review';
  readonly registry?: MethodRegistry;
};

/**
 * §4.6, and its most easily-lost clause: *"Replay is an explicit validation action, never
 * something that happens when a page opens."* Nothing calls this on render. The Inspector shows
 * the **last recorded** outcome and a button.
 *
 * It appends a `calculation_validation_run` row and returns the verdict. It never writes to
 * `calculation_snapshot`, `calculation_input` or `calculation_step` — and could not: migration
 * `0012` rejects an UPDATE on all three, unconditionally.
 *
 * **Authorization is not enforced here, and cannot be yet** — there is no identity system to
 * check against until F02 lands (lane-review finding 7). What this function does own now,
 * because neither needs F02: an `audit_event` row for every run, and `requestedBy` recorded on
 * both rows rather than trusted only in one place. The caller F02 eventually wires up is where
 * "is this caller allowed to replay this calculation" has to be answered — this function still
 * cannot answer it for them.
 *
 * The validation run and its audit event are written inside one transaction — a second
 * lane-review pass on finding 7 caught that they were not, which meant a crash between the two
 * writes could leave a durable, retention-protecting validation run with no audit trail. Same
 * standard `repositories/retention.ts`'s `purgeArtifacts` already holds itself to: "an audited
 * deletion is the only kind that commits."
 */
export async function runReplay(
  args: RunReplayArgs,
  db: Queryable = getPool(),
): Promise<{ verdict: ReplayVerdict; validationRunId: string } | null> {
  const artifact = await loadArtifact(args.calculationId, db);
  if (artifact === null) return null;

  const verdict = replay(artifact, args.registry ?? METHOD_REGISTRY);

  const run = await withTransaction(async (tx) => {
    const inserted = await insertValidationRun(
      {
        calculationId: artifact.calculationId,
        requestedBy: args.requestedBy,
        triggerType: args.triggerType ?? 'user_replay',
        methodVersion: artifact.methodVersion,
        inputHashExpected: verdict.inputHashExpected,
        inputHashActual: verdict.inputHashActual,
        resultHashExpected: verdict.resultHashExpected,
        resultHashActual: verdict.resultHashActual,
        status: VERDICT_TO_STATUS[verdict.outcome],
        differences: { outcome: verdict.outcome, explanation: verdict.explanation, fields: verdict.differences },
      },
      tx,
    );

    await insertReplayAuditEvent(
      {
        calculationId: artifact.calculationId,
        requestedBy: args.requestedBy,
        triggerType: args.triggerType ?? 'user_replay',
        outcome: verdict.outcome,
        validationRunId: inserted.id,
      },
      tx,
    );

    return inserted;
  });

  return { verdict, validationRunId: run.id };
}

export { findLatestValidationRun };

// ── Computing one ─────────────────────────────────────────────────────────────────────────────

export type ComputeArtifactArgs = {
  readonly methodId: string;
  readonly methodVersion?: string;
  readonly subject: Subject;
  readonly asOf: string;
  readonly inputs: readonly CalculationInputValue[];
  readonly assumptions: readonly ResolvedAssumption[];
  readonly configVersion: string;
  readonly scenario?: Scenario;
  readonly calculationId: string;
  readonly computedAt?: string;
  readonly registry?: MethodRegistry;
  readonly retentionClass?: 'standard' | 'permanent';
};

/** Builds an artifact against the registry. Pure — persistence is a separate call. */
export function computeArtifact(args: ComputeArtifactArgs): CalculationArtifact {
  const registry = args.registry ?? METHOD_REGISTRY;
  const entry =
    args.methodVersion === undefined
      ? registry.latest(args.methodId)
      : registry.get(args.methodId, args.methodVersion);

  const asOf = new Date(args.asOf);
  const computedAt = args.computedAt ?? new Date().toISOString();
  const freshest = args.inputs
    .map((input) => input.provenance.observedAt)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1);

  const stale =
    entry.stalenessMinutes !== null &&
    freshest !== undefined &&
    asOf.getTime() - new Date(freshest).getTime() > entry.stalenessMinutes * 60_000;

  return buildArtifact({
    method: {
      methodId: entry.id,
      version: entry.version,
      unit: entry.unit,
      roundingRule: entry.roundingRule,
      workingPrecision: entry.workingPrecision,
      compute: entry.compute,
    },
    subject: args.subject,
    asOf: args.asOf,
    inputs: args.inputs,
    assumptions: args.assumptions,
    configVersion: args.configVersion,
    scenario: args.scenario ?? { kind: 'official' },
    calculationId: args.calculationId,
    computedAt,
    ...(args.retentionClass === undefined ? {} : { retentionClass: args.retentionClass }),
    ...(stale ? { stale: true } : {}),
  });
}
