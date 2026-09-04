/**
 * The artifact builder (F05 §4.2). **The one job this feature exists to do.**
 *
 * > The compute function *emits its steps as it computes* — the trace is a byproduct of the
 * > calculation, not a parallel narration written afterwards. This is the only way the number
 * > and its explanation cannot diverge, and it is the invariant this whole feature exists to
 * > protect.
 *
 * A comment cannot enforce that, so the types do. There is exactly one way to obtain a value
 * inside a computation — `ctx.step(...)` — and `ctx.step` computes the value itself and records
 * the step in the same call. The value it hands back is branded and registered in a private
 * `WeakSet`, and `buildArtifact` refuses any result that is not one of the values it saw a step
 * produce. So:
 *
 * - a step cannot be recorded without evaluating it, because `step()` *is* the evaluation; and
 * - a result cannot be returned that no step produced, because there is no other way to mint one.
 *
 * The awkwardness of writing a method this way is the point (§8). Every later method inherits
 * the pattern, and none of them can quietly grow a `steps` array that describes something other
 * than what was returned.
 */
import type { InsufficiencyReason } from '../contracts/primitives';
import { computeInputHash, computeResultHash } from './canonical';
import { applyRounding, D, dec, exact, type Dec, type DecimalString } from './decimal';

// ── The pieces of an artifact ─────────────────────────────────────────────────────────────────

/** Where a resolved assumption came from. Mirrors §6's precedence chain, top to bottom. */
export type AssumptionSource =
  | 'code_invariant'
  | 'official_default'
  | 'account_default'
  | 'subject_override';

export type ResolvedAssumption = {
  readonly key: string;
  readonly value: DecimalString;
  readonly unit: string;
  readonly source: AssumptionSource;
  /** The official value, kept beside an override so the Inspector can show both. */
  readonly officialValue: DecimalString;
  readonly min: DecimalString | null;
  readonly max: DecimalString | null;
  readonly editable: boolean;
};

/** §4.8 §3: every input renders with its normalized value, provider field, source and staleness. */
export type InputProvenance = {
  readonly provider: string | null;
  readonly providerField: string | null;
  readonly sourceUrl: string | null;
  /** When the fact was true. */
  readonly observedAt: string | null;
  /** When we could first have seen it — F22's as-of bound. */
  readonly availableAt: string | null;
  /** When we learned it. */
  readonly ingestedAt: string | null;
  readonly rawPayloadId: string | null;
  readonly licenseClass: string;
  readonly redactionClass: string;
};

export type CalculationInputValue = {
  readonly key: string;
  /** A decimal string for anything arithmetic touches; free text only for an identity. */
  readonly value: string;
  readonly unit: string | null;
  readonly dataType: 'decimal' | 'identity' | 'instant';
  readonly source: string;
  readonly provenance: InputProvenance;
  readonly quality: 'ok' | 'estimated' | 'imputed' | 'missing';
  readonly freshness: 'fresh' | 'stale' | 'unknown';
};

export type StepStatus = 'applied' | 'excluded' | 'clamped' | 'missing' | 'warning';

/** §4.2: `{ index, label, expression, substituted, exactValue, unit }`, plus the audit fields. */
export type CalculationStepRecord = {
  readonly index: number;
  readonly key: string;
  readonly parentKey: string | null;
  readonly label: string;
  readonly expression: string;
  readonly substituted: string;
  readonly exactValue: DecimalString;
  readonly displayValue: DecimalString;
  readonly unit: string;
  readonly roundingRule: string;
  readonly status: StepStatus;
  readonly operands: Readonly<Record<string, DecimalString>>;
  readonly notes: readonly string[];
};

/** F-07: a chart point is addressed `{calculationId, pointIndex}` and resolved from here. */
export type DerivedPoint = {
  readonly pointIndex: number;
  readonly observationKey: string;
  readonly exactValue: DecimalString;
  readonly displayValue: DecimalString;
};

export type Eligibility = 'ok' | 'insufficient_data' | 'not_applicable' | 'stale';

export type ArtifactResult = {
  readonly exact: DecimalString;
  readonly display: string;
  readonly roundingRule: string;
  readonly unit: string;
};

export type Scenario =
  | { readonly kind: 'official' }
  | { readonly kind: 'personal'; readonly userId: string; readonly profileId: string };

export type Subject = {
  readonly kind: 'security' | 'market' | 'sector';
  readonly id: string;
  /** For display only. A symbol is reassignable and is never an identity (F03 §5). */
  readonly label: string | null;
};

/**
 * Why a number is absent, when it is. Product invariant §6.3: abstention is a value, not an
 * absent one — so it is carried in the artifact, hashed, and replayed like any other outcome.
 */
export type Abstention = {
  readonly reason: InsufficiencyReason;
  /** Written for a non-engineer: §7.5 asks a reviewer to read exactly this. */
  readonly message: string;
};

export type CalculationArtifact = {
  readonly calculationId: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly subject: Subject;
  readonly asOf: string;
  readonly inputs: readonly CalculationInputValue[];
  readonly assumptions: readonly ResolvedAssumption[];
  readonly steps: readonly CalculationStepRecord[];
  readonly result: ArtifactResult | null;
  readonly abstention: Abstention | null;
  readonly eligibility: Eligibility;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly configVersion: string;
  readonly scenario: Scenario;
  readonly points: readonly DerivedPoint[] | null;
  readonly warnings: readonly string[];
  readonly retentionClass: 'standard' | 'permanent';
  readonly computedAt: string;
};

// ── The compute context ───────────────────────────────────────────────────────────────────────

/**
 * The brand. Module-private, so a `StepValue` cannot be written down outside this file — and
 * the `WeakSet` below closes the remaining gap for anyone who reaches the symbol anyway.
 */
declare const STEP_VALUE: unique symbol;

/** A value that a recorded step produced. The only currency a computation deals in. */
export type StepValue = {
  readonly [STEP_VALUE]: true;
  readonly stepKey: string;
  readonly unit: string;
  /** Read-only view for building the next step's operands. */
  readonly decimal: Dec;
};

/** Resolves a declared operand by name. Throws, rather than returning `undefined`, on a typo. */
export type OperandLookup = (name: string) => Dec;

export type StepSpec = {
  readonly key: string;
  readonly label: string;
  /**
   * Symbolic, with operand names in braces: `'{rank_prior} - {rank_now}'`. The substituted form
   * the Inspector renders is generated from this and the operand values, so the two cannot say
   * different things.
   */
  readonly expression: string;
  readonly operands: Readonly<Record<string, Dec | StepValue | DecimalString>>;
  readonly unit: string;
  /**
   * The arithmetic. Its return value *is* the step's exact value; there is no other channel.
   *
   * Operands arrive through a lookup rather than a record so that naming one the step did not
   * declare is an error at the point of use, with the name in the message — a `Dec | undefined`
   * threaded through three lines of decimal arithmetic reports as something else entirely.
   */
  readonly evaluate: (operand: OperandLookup) => Dec;
  readonly parentKey?: string;
  readonly status?: StepStatus;
  readonly roundingRule?: string;
  readonly notes?: readonly string[];
};

export type PointSpec = {
  readonly observationKey: string;
  readonly value: StepValue;
  readonly roundingRule?: string;
};

export interface ComputeContext {
  /** A declared input, as a decimal. Throws if it was never declared or is not numeric. */
  input(key: string): Dec;
  /**
   * A declared, non-arithmetic input, as raw text — F06's addition to F05's context. An
   * `identity` input (a methodology version, a quote-kind tag) enters no arithmetic but a
   * compute function still has to *read* it to gate on it, and `input()` deliberately refuses
   * anything that is not `dataType: 'decimal'` (§4.1). This is the same freeze-before-compute
   * discipline applied to a value nothing sums or divides.
   */
  identity(key: string): string;
  /**
   * Whether a key was declared at all, without throwing. F06's market composite renormalizes
   * over whichever components a caller actually supplied — `hasInput` is how a method tells
   * "this component was omitted for inadequate coverage" from "this component is present and
   * happens to be zero", which are different facts (§4.5's renormalization, never a zero fill).
   */
  hasInput(key: string): boolean;
  /** A resolved assumption, as a decimal. Throws if the method did not declare it. */
  assumption(key: string): Dec;
  /** Evaluate and record, in one call. The only way to produce a value. */
  step(spec: StepSpec): StepValue;
  /** F-07: one point of a series artifact. Its value must have come from a step. */
  point(spec: PointSpec): void;
  /** Product invariant §6.3. Ends the computation with a stated reason, never a zero. */
  abstain(abstention: Abstention): never;
  /** A caveat that belongs on the artifact but does not stop it. */
  warn(note: string): void;
}

export type ComputeResult = { readonly value: StepValue };
export type MethodCompute = (ctx: ComputeContext) => ComputeResult;

class AbstentionSignal extends Error {
  constructor(readonly abstention: Abstention) {
    super(abstention.message);
    this.name = 'AbstentionSignal';
  }
}

export class ArtifactBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactBuildError';
  }
}

/** Substitutes `{name}` for the operand's exact value. Unknown placeholders are an error. */
function substitute(expression: string, operands: Readonly<Record<string, DecimalString>>): string {
  return expression.replace(/\{([A-Za-z0-9_.]+)\}/g, (_, name: string) => {
    const value = operands[name];
    if (value === undefined) {
      throw new ArtifactBuildError(
        `The expression references {${name}}, which is not one of its operands ` +
          `(${Object.keys(operands).join(', ') || 'none'}). A substituted form that does not ` +
          'correspond to the operands is exactly the divergence §4.2 forbids.',
      );
    }
    return value;
  });
}

// ── The builder ───────────────────────────────────────────────────────────────────────────────

/** What the builder needs from the registry. Kept structural so `calc/` owns no registry data. */
export type BuilderMethod = {
  readonly methodId: string;
  readonly version: string;
  readonly unit: string;
  readonly roundingRule: string;
  readonly workingPrecision: number;
  readonly compute: MethodCompute;
};

export type BuildArtifactArgs = {
  readonly method: BuilderMethod;
  readonly subject: Subject;
  readonly asOf: string;
  readonly inputs: readonly CalculationInputValue[];
  readonly assumptions: readonly ResolvedAssumption[];
  readonly configVersion: string;
  readonly scenario: Scenario;
  readonly calculationId: string;
  readonly computedAt: string;
  readonly retentionClass?: 'standard' | 'permanent';
  /** Set by the caller when the freshest input is past its method's staleness window. */
  readonly stale?: boolean;
};

export function buildArtifact(args: BuildArtifactArgs): CalculationArtifact {
  const { method } = args;

  const inputsByKey = new Map(args.inputs.map((input) => [input.key, input]));
  const assumptionsByKey = new Map(args.assumptions.map((a) => [a.key, a]));

  const steps: CalculationStepRecord[] = [];
  const points: DerivedPoint[] = [];
  const warnings: string[] = [];
  const stepKeys = new Set<string>();
  /** Identity, not shape. A forged object with the right fields is still not one of these. */
  const minted = new WeakSet<object>();

  const mint = (stepKey: string, unit: string, decimal: Dec): StepValue => {
    // `decimal` is a live `Dec` — decimal.js instances aren't frozen, and nothing stops a
    // method's own arithmetic from mutating one in place after the fact. Snapshotting the exact
    // string *now* and deriving a fresh `Dec` from it on every `.decimal` read (rather than
    // storing and returning the mutable instance itself) is what makes a later mutation of an
    // operand unable to change what this step already recorded and hashed — a `WeakSet` on
    // identity alone catches a forged object, not a genuine one mutated after minting.
    const exactAtMint = exact(decimal);
    const value = {
      stepKey,
      unit,
      get decimal(): Dec {
        return dec(exactAtMint);
      },
    } as unknown as StepValue;
    // Frozen before it is registered, not after: an un-frozen, legitimately-minted object is
    // still configurable, and `Object.defineProperty(value, 'decimal', { value: ... })`
    // replaces the getter outright — the same divergence finding 1 closed, reopened through
    // the one door a plain getter doesn't lock (caught on a second lane-review pass).
    Object.freeze(value);
    minted.add(value as unknown as object);
    return value;
  };

  const isMinted = (value: unknown): value is StepValue =>
    typeof value === 'object' && value !== null && minted.has(value as object);

  const operandDecimal = (name: string, operand: Dec | StepValue | DecimalString): Dec => {
    if (typeof operand === 'string') return dec(operand);
    if (isMinted(operand)) return operand.decimal;
    if (operand instanceof D) return operand;
    throw new ArtifactBuildError(
      `Operand '${name}' is neither a decimal, a decimal string, nor a value produced by an ` +
        'earlier step. Every operand has to be traceable to something the trace already shows.',
    );
  };

  const ctx: ComputeContext = {
    input(key) {
      const input = inputsByKey.get(key);
      if (input === undefined) {
        throw new ArtifactBuildError(
          `The computation asked for input '${key}', which was not declared. Inputs are frozen ` +
            'before the computation runs so that replay has something to freeze against ' +
            `(§4.6). Declared: ${[...inputsByKey.keys()].join(', ') || 'none'}.`,
        );
      }
      if (input.dataType !== 'decimal') {
        throw new ArtifactBuildError(
          `Input '${key}' is a ${input.dataType}, not a decimal, and cannot enter arithmetic.`,
        );
      }
      return dec(input.value);
    },

    identity(key) {
      const input = inputsByKey.get(key);
      if (input === undefined) {
        throw new ArtifactBuildError(
          `The computation asked for identity input '${key}', which was not declared. ` +
            `Declared: ${[...inputsByKey.keys()].join(', ') || 'none'}.`,
        );
      }
      if (input.dataType === 'decimal') {
        throw new ArtifactBuildError(
          `Input '${key}' is a decimal, not an identity. Read it with input() so it enters the ` +
            'arithmetic trace rather than being compared as opaque text.',
        );
      }
      return input.value;
    },

    hasInput(key) {
      return inputsByKey.has(key);
    },

    assumption(key) {
      const assumption = assumptionsByKey.get(key);
      if (assumption === undefined) {
        throw new ArtifactBuildError(
          `The computation asked for assumption '${key}', which the registry does not declare. ` +
            'The registry is the sole runtime description of a method\'s parameters (§4.4).',
        );
      }
      return dec(assumption.value);
    },

    step(spec) {
      if (stepKeys.has(spec.key)) {
        throw new ArtifactBuildError(
          `Duplicate step key '${spec.key}'. Steps are addressed by key from the Inspector and ` +
            'from a calculation issue, so two of them make one unreachable.',
        );
      }

      const resolved: Record<string, Dec> = {};
      const operandText: Record<string, DecimalString> = {};
      for (const [name, operand] of Object.entries(spec.operands)) {
        const value = operandDecimal(name, operand);
        resolved[name] = value;
        operandText[name] = exact(value);
      }

      const lookup: OperandLookup = (name) => {
        const value = resolved[name];
        if (value === undefined) {
          throw new ArtifactBuildError(
            `Step '${spec.key}' asked for operand '${name}', which it did not declare ` +
              `(${Object.keys(resolved).join(', ') || 'none'}). An operand that is not declared ` +
              'does not appear in the trace, so the substituted formula would omit a term the ' +
              'value depends on.',
          );
        }
        return value;
      };

      // The evaluation. Its result is recorded verbatim below — there is no path by which a
      // caller supplies `exactValue` itself.
      const produced = spec.evaluate(lookup);
      if (!(produced instanceof D)) {
        throw new ArtifactBuildError(
          `Step '${spec.key}' evaluated to something that is not a decimal. Arithmetic in this ` +
            'layer is decimal end to end (§4.1).',
        );
      }
      if (!produced.isFinite()) {
        throw new ArtifactBuildError(
          `Step '${spec.key}' evaluated to ${produced.toString()}. A non-finite value has no ` +
            'exact decimal form and must be handled as an abstention, not rendered.',
        );
      }

      const exactValue = exact(produced);
      const rule = spec.roundingRule ?? method.roundingRule;

      stepKeys.add(spec.key);
      steps.push({
        index: steps.length,
        key: spec.key,
        parentKey: spec.parentKey ?? null,
        label: spec.label,
        expression: spec.expression,
        substituted: substitute(spec.expression, operandText),
        exactValue,
        displayValue: applyRounding(produced, rule),
        unit: spec.unit,
        roundingRule: rule,
        status: spec.status ?? 'applied',
        operands: Object.freeze(operandText),
        notes: spec.notes ?? [],
      });

      return mint(spec.key, spec.unit, produced);
    },

    point(spec) {
      if (!isMinted(spec.value)) {
        throw new ArtifactBuildError(
          `Point '${spec.observationKey}' carries a value no step produced. A points table is a ` +
            'derivation table (F-07); a point with no derivation is a number from nowhere.',
        );
      }
      points.push({
        pointIndex: points.length,
        observationKey: spec.observationKey,
        exactValue: exact(spec.value.decimal),
        displayValue: applyRounding(spec.value.decimal, spec.roundingRule ?? method.roundingRule),
      });
    },

    abstain(abstention) {
      throw new AbstentionSignal(abstention);
    },

    warn(note) {
      warnings.push(note);
    },
  };

  // Sorted by key before hashing. The *set* of inputs is the fact; the order in which a method
  // happened to declare them is not, and two calls that differ only in declaration order are the
  // same calculation. (Arrays are otherwise order-significant in canonicalization — see
  // `canonical.ts` — so this has to be done deliberately, here, rather than assumed.)
  const byKey = <T extends { readonly key: string }>(items: readonly T[]): readonly T[] =>
    [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const inputHash = computeInputHash({
    methodId: method.methodId,
    methodVersion: method.version,
    inputs: byKey(args.inputs),
    assumptions: byKey(args.assumptions),
  });

  const header = {
    calculationId: args.calculationId,
    methodId: method.methodId,
    methodVersion: method.version,
    subject: args.subject,
    asOf: args.asOf,
    inputs: args.inputs,
    assumptions: args.assumptions,
    inputHash,
    configVersion: args.configVersion,
    scenario: args.scenario,
    retentionClass: args.retentionClass ?? ('standard' as const),
    computedAt: args.computedAt,
  };

  let produced: ComputeResult;
  try {
    produced = method.compute(ctx);
  } catch (error) {
    if (error instanceof AbstentionSignal) {
      // An abstention is a result, so it is hashed and replayed like one. A replay that
      // produces a different reason is a mismatch, exactly as a different number would be.
      return {
        ...header,
        steps,
        points: points.length === 0 ? null : points,
        warnings,
        result: null,
        abstention: error.abstention,
        eligibility: eligibilityFor(error.abstention.reason),
        resultHash: computeResultHash(`abstain:${error.abstention.reason}`),
      };
    }
    throw error;
  }

  if (!isMinted(produced.value)) {
    throw new ArtifactBuildError(
      'The computation returned a value that no step produced. The trace is a byproduct of the ' +
        'calculation, not a narration of it (§4.2) — a result minted outside `ctx.step()` is a ' +
        'number whose explanation is unverifiable, which is the one thing this builder exists ' +
        'to make impossible.',
    );
  }

  if (steps.length === 0) {
    throw new ArtifactBuildError(
      'The computation recorded no steps. A value with an empty trace cannot be inspected.',
    );
  }

  const resultExact = exact(produced.value.decimal);

  return {
    ...header,
    steps,
    points: points.length === 0 ? null : points,
    warnings,
    result: {
      exact: resultExact,
      display: applyRounding(produced.value.decimal, method.roundingRule),
      roundingRule: method.roundingRule,
      unit: produced.value.unit,
    },
    abstention: null,
    eligibility: args.stale === true ? 'stale' : 'ok',
    resultHash: computeResultHash(resultExact),
  };
}

/** §4.8 §1 renders eligibility; §6.3 requires the reason behind it to survive the mapping. */
/**
 * `not_applicable` reasons say "this comparison does not make sense", distinct from
 * `insufficient_data`'s "there was not enough of it". F06 §4.1 adds `methodology_version_boundary`
 * to that set: a rank change across a methodology change is not a thin sample, it is a
 * comparison between two different instruments. `new_to_board`/`dropped_from_board` join it for
 * the same reason: a security absent from one end of the comparison has no rank to be thin —
 * there is nothing there to sample at all.
 */
const NOT_APPLICABLE_REASONS: ReadonlySet<InsufficiencyReason> = new Set([
  'not_applicable',
  'methodology_version_boundary',
  'new_to_board',
  'dropped_from_board',
]);

function eligibilityFor(reason: InsufficiencyReason): Eligibility {
  return NOT_APPLICABLE_REASONS.has(reason) ? 'not_applicable' : 'insufficient_data';
}
