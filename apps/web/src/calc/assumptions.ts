/**
 * Assumption resolution (F05 §4.5) — *"exactly the precedence chain in
 * `02-ARCHITECTURE-CONTRACTS.md` §6"*:
 *
 * ```
 * code-level invariants and safety allowlists      (never overridable)
 *   → environment / deployment secrets              (never readable from the browser)
 *     → active config_version row                   (typed, versioned, audited)
 *       → active universe_version / model_route     (typed, versioned, audited)
 *         → official assumption defaults
 *           → user account-default overrides        (bounded, personal scenario only)
 *             → user subject-level override         (bounded, personal scenario only)
 * ```
 *
 * Two clauses of §4.5 do the real work and are easy to lose:
 *
 * 1. **Official scheduled materialisation ignores personal assumptions entirely.** Not "applies
 *    them and marks them" — ignores them. An official series that depended on who last opened it
 *    would not be a series.
 * 2. **A personal result is computed lazily from an official snapshot's eligible frozen inputs —
 *    no provider call in the scenario path.** That is what makes the official/personal
 *    comparison apples-to-apples: the two runs differ in exactly one variable, the assumption.
 *    This module never reaches for data, which is the mechanical half of that guarantee.
 */
import type { ResolvedAssumption } from './artifact';
import {
  validateOverride,
  type MethodDescriptor,
  type OverrideRejection,
} from './registry';

export type OverrideInput = Readonly<Record<string, string>>;

export type ResolveAssumptionsArgs = {
  readonly descriptor: MethodDescriptor;
  readonly scenario: 'official' | 'personal';
  /** §6: user account-default overrides. Ignored outright in an official scenario. */
  readonly accountDefaults?: OverrideInput;
  /** §6: user subject-level overrides. Outrank account defaults. */
  readonly subjectOverrides?: OverrideInput;
};

export type ResolveAssumptionsResult = {
  readonly assumptions: readonly ResolvedAssumption[];
  /** Rejections are returned, never thrown and never silently dropped. */
  readonly rejections: readonly OverrideRejection[];
};

/**
 * The resolution. Deterministic, pure, and total: every assumption the registry declares comes
 * back resolved, with the source that decided it, so the Inspector can render "official 25,
 * yours 40" rather than just "40".
 */
export function resolveAssumptions(args: ResolveAssumptionsArgs): ResolveAssumptionsResult {
  const { descriptor, scenario } = args;
  const editableByKey = new Map(descriptor.editableAssumptions.map((e) => [e.key, e]));
  const rejections: OverrideRejection[] = [];

  // Clause 1. The personal layers are not consulted at all for an official run — an override
  // that is read and then discarded is one somebody eventually stops discarding.
  const layers: readonly { readonly source: ResolvedAssumption['source']; readonly values: OverrideInput }[] =
    scenario === 'official'
      ? []
      : [
          { source: 'account_default', values: args.accountDefaults ?? {} },
          { source: 'subject_override', values: args.subjectOverrides ?? {} },
        ];

  const resolved: ResolvedAssumption[] = [];

  for (const [key, officialValue] of Object.entries(descriptor.officialAssumptions)) {
    const editable = editableByKey.get(key);

    let value = officialValue;
    // A parameter the registry does not list as editable is a code-level invariant for this
    // purpose: it sits above every user layer in §6 and no layer below can reach it.
    let source: ResolvedAssumption['source'] =
      editable === undefined ? 'code_invariant' : 'official_default';

    // Applied lowest-precedence first, so the last layer to speak wins — which is §6 read
    // downward, in order, rather than a set of special cases.
    for (const layer of layers) {
      const candidate = layer.values[key];
      if (candidate === undefined) continue;

      const outcome = validateOverride(descriptor, key, candidate, { scenario });
      if (!outcome.ok) {
        rejections.push(outcome.rejection);
        continue;
      }
      value = outcome.value;
      source = layer.source;
    }

    resolved.push({
      key,
      value,
      unit: editable?.unit ?? '',
      source,
      officialValue,
      min: editable?.min ?? null,
      max: editable?.max ?? null,
      editable: editable !== undefined,
    });
  }

  // An override naming a key the method does not have is reported rather than ignored: silently
  // dropping it renders a personal result identical to the official one with no explanation.
  for (const layer of layers) {
    for (const key of Object.keys(layer.values)) {
      if (key in descriptor.officialAssumptions) continue;
      rejections.push({
        key,
        reason: 'not_registered',
        message: `'${key}' is not an assumption of ${descriptor.id} at all. It was not applied, and a personal result that silently equals the official one is worse than a rejection.`,
      });
    }
  }

  // Stable order, so two resolutions of the same facts hash the same (§4.3).
  const ordered = [...resolved].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return { assumptions: ordered, rejections };
}
