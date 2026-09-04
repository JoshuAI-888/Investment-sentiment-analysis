/**
 * The Wave 1 walking slice, from a provider payload to an artifact (F05 §1).
 *
 * This module does one narrow thing: it turns an attention board reading into the **frozen
 * inputs** an artifact is built from, with their provenance attached, and computes the artifact.
 * It does not fetch. The adapter is handed in, so the same code path serves the fixture harness,
 * the scheduled job F16 will wire, and a live call — and none of them can differ in how the
 * inputs are recorded, which is the part replay depends on.
 *
 * **Why provenance is not optional here.** §4.8 §3 renders every input with its provider field,
 * source, `observed_at` and staleness. An input recorded without them is a number in the trace
 * whose origin a reader has to take on trust, which is the whole thing the Inspector exists to
 * avoid. So the mapping below is explicit and slightly tedious rather than a spread.
 */
import type { ApeWisdomEntry } from '../adapters/apewisdom';
import type { CalculationArtifact, CalculationInputValue } from '../calc/artifact';
import { resolveAssumptions, type OverrideInput } from '../calc/assumptions';
import type { MethodRegistry } from '../calc/registry';
import { computeArtifact, METHOD_REGISTRY } from './calculations';

export const APEWISDOM_LICENSE_CLASS = 'attribution_required';

export type BoardReading = {
  /** Which board. A rank on one board is not comparable with a rank on another. */
  readonly filter: string;
  readonly sourceUrl: string;
  /** When the board reported this state. */
  readonly observedAt: string;
  /** When we could first have seen it — F22's as-of bound. */
  readonly availableAt: string;
  readonly ingestedAt: string;
  readonly rawPayloadId?: string | null;
  /**
   * F06 §4.1's amendment: the methodology this reading was produced under. Mirrors
   * `attention_snapshot.provider_methodology_version` (migration `0002`). Compared against the
   * prior observation's own value in `computeRankChange` — a difference means the two snapshots
   * are not comparable at all, before rank or mention counts are even looked at.
   */
  readonly methodologyVersion: string;
};

function boardInput(
  key: string,
  value: string,
  unit: string,
  providerField: string,
  reading: BoardReading,
  dataType: CalculationInputValue['dataType'] = 'decimal',
): CalculationInputValue {
  return {
    key,
    value,
    unit,
    dataType,
    source: `apewisdom/${reading.filter}`,
    quality: 'ok',
    freshness: 'fresh',
    provenance: {
      provider: 'apewisdom',
      providerField,
      sourceUrl: reading.sourceUrl,
      observedAt: reading.observedAt,
      availableAt: reading.availableAt,
      ingestedAt: reading.ingestedAt,
      rawPayloadId: reading.rawPayloadId ?? null,
      licenseClass: APEWISDOM_LICENSE_CLASS,
      redactionClass: 'public',
    },
  };
}

/**
 * One board entry → the five frozen inputs `attention.rank_change` is computed from.
 *
 * The fifth is an **identity**, not a quantity: which board, at which endpoint revision, produced
 * these ranks. It enters no arithmetic and it is inside the input hash all the same, because the
 * hash is taken over the whole input set. That is the mechanism §5 asks for when it says *"the
 * scorer identity is inside the hashed inputs, so swapping the pinned revision alone produces
 * `result_mismatch`"* — swapping the instrument changes the artifact's identity even when every
 * number is unchanged, which is exactly what it should do.
 */
export function inputsFromBoardEntry(
  entry: ApeWisdomEntry,
  reading: BoardReading,
  /**
   * The methodology the *prior* observation was produced under (F06 §4.1). **Required, no
   * default.** A default of `reading.methodologyVersion` ("no boundary crossed") is exactly the
   * value that silently disables the guard this parameter exists to drive — a caller that
   * forgets to track methodology gets a computed rank change instead of `not_applicable`, and
   * the artifact records `methodology_version_prior` equal to the current one, so the Inspector
   * shows a comparison that looks verified when it was never checked. There is no production
   * caller yet, so nothing depended on the old default — found by lane-review.
   */
  priorMethodologyVersion: string,
): CalculationInputValue[] {
  return [
    boardInput('rank_now', String(entry.rank), 'ranks', 'rank', reading),
    boardInput('rank_prior', entry.rank24hAgo, 'ranks', 'rank_24h_ago', reading),
    boardInput('mentions_now', entry.mentions, 'mentions', 'mentions', reading),
    boardInput('mentions_prior', entry.mentions24hAgo, 'mentions', 'mentions_24h_ago', reading),
    boardInput(
      'source_identity',
      `apewisdom:${reading.filter}`,
      '',
      'endpoint',
      reading,
      'identity',
    ),
    boardInput(
      'methodology_version_now',
      reading.methodologyVersion,
      '',
      'methodology_version',
      reading,
      'identity',
    ),
    boardInput(
      'methodology_version_prior',
      priorMethodologyVersion,
      '',
      'methodology_version_24h_ago',
      reading,
      'identity',
    ),
  ];
}

export type RankChangeArgs = {
  readonly entry: ApeWisdomEntry;
  readonly reading: BoardReading;
  /** The surrogate key. Ticker text is never an identity (F03 §5). */
  readonly securityId: string;
  readonly asOf: string;
  readonly configVersion: string;
  readonly calculationId: string;
  readonly computedAt?: string;
  readonly registry?: MethodRegistry;
  readonly scenario?: { readonly kind: 'official' } | { readonly kind: 'personal'; readonly userId: string; readonly profileId: string };
  readonly accountDefaults?: OverrideInput;
  readonly subjectOverrides?: OverrideInput;
  /**
   * F06 §4.1. Required — see `inputsFromBoardEntry`'s doc for why a default here is exactly
   * the bug the guard exists to catch.
   */
  readonly priorMethodologyVersion: string;
};

/**
 * Builds the artifact. A personal scenario differs from the official one in exactly one
 * variable — the assumption — because §4.5 forbids a provider call in the scenario path and this
 * function takes its inputs already frozen.
 */
export function computeRankChange(args: RankChangeArgs): CalculationArtifact {
  const registry = args.registry ?? METHOD_REGISTRY;
  const entry = registry.latest('attention.rank_change');
  const scenario = args.scenario ?? { kind: 'official' };

  const { assumptions } = resolveAssumptions({
    descriptor: entry,
    scenario: scenario.kind,
    ...(args.accountDefaults === undefined ? {} : { accountDefaults: args.accountDefaults }),
    ...(args.subjectOverrides === undefined ? {} : { subjectOverrides: args.subjectOverrides }),
  });

  return computeArtifact({
    methodId: entry.id,
    methodVersion: entry.version,
    subject: { kind: 'security', id: args.securityId, label: args.entry.ticker },
    asOf: args.asOf,
    inputs: inputsFromBoardEntry(args.entry, args.reading, args.priorMethodologyVersion),
    assumptions,
    configVersion: args.configVersion,
    scenario,
    calculationId: args.calculationId,
    registry,
    ...(args.computedAt === undefined ? {} : { computedAt: args.computedAt }),
  });
}
