/**
 * The method registry (F05 §4.4) — *"the single runtime description of a metric"*.
 *
 * `02-ARCHITECTURE-CONTRACTS.md` §4.3: the Inspector, the formula catalogue, the assumption
 * validator and the Architecture Explorer all read this, and **none of them reimplements a
 * formula**. That is why the registry is split in two here:
 *
 * - a **descriptor** — pure data: id, version, formula, bounds, rounding, limitations. It lives
 *   in `analytics/registry.ts`, where `check:calc-coverage` and `check:copy` already read it,
 *   and it is what gets projected into the database for the Inspector and the Explorer;
 * - a **compute function** — the arithmetic, in `calc/methods/`.
 *
 * They are bound together at composition time and `validateDescriptor` rejects a descriptor that
 * does not parse, so a projection that drifted from the code fails loudly instead of quietly
 * describing a formula nobody runs.
 *
 * **Why the split exists at all.** `02-ARCHITECTURE-CONTRACTS.md` §3 lets `analytics/` import
 * only `contracts/`, so a descriptor living there cannot reference `calc/`'s `ComputeContext`.
 * The split is that constraint made honest rather than worked around — see the note in the
 * builder about what a review should check.
 */
import { z } from 'zod';
import type { MethodCompute } from './artifact';
import { dec, isDecimalString, roundingRule } from './decimal';

const decimalText = z.string().refine(isDecimalString, {
  message: 'must be a decimal string, not a float (02-ARCHITECTURE-CONTRACTS.md §4.2)',
});

export const editableAssumption = z.object({
  key: z.string().min(1),
  min: decimalText,
  max: decimalText,
  unit: z.string(),
  label: z.string().min(1),
});
export type EditableAssumption = z.infer<typeof editableAssumption>;

/**
 * The declarative half. Everything the Inspector renders and the validator enforces, as data.
 *
 * `inputSchema` is a zod schema and therefore not itself serializable; it is carried as a
 * function so the descriptor object stays a plain value that can be projected to the database.
 */
export const methodDescriptor = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'must be `domain.metric`'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be semver — bump on any numeric change'),
    title: z.string().min(1),
    subjectKind: z.enum(['security', 'market', 'sector']),
    unit: z.string(),
    /** Rendered in the Inspector's Formula section before substitution (§4.8 §2). */
    symbolicFormula: z.string().min(1),
    officialAssumptions: z.record(decimalText),
    /** §4.4: the ONLY runtime description of what a user may change. */
    editableAssumptions: z.array(editableAssumption),
    workingPrecision: z.number().int().positive(),
    roundingRule: z.string().min(1),
    /** Human-readable, shown in the Inspector (§4.8 §1). */
    eligibilityRules: z.array(z.string().min(1)),
    failureBehaviour: z.enum(['abstain', 'clamp', 'not_applicable']),
    externalComparator: z.object({ provider: z.string(), field: z.string() }).nullable(),
    /** F-03's selection-bias disclosure lives here. It is not optional copy (§4.4). */
    limitations: z.array(z.string().min(1)),
    /** Golden fixtures. `check:calc-coverage` fails a registered method that has none. */
    goldens: z.array(z.string().min(1)),
    /** Present only once the method has passed Tier D4. `check:copy` reads this (D-09). */
    tierD4Record: z.string().min(1).optional(),
    /** Beyond this, an artifact's eligibility is `stale` rather than `ok`. */
    stalenessMinutes: z.number().int().positive().nullable(),
  })
  .superRefine((entry, ctx) => {
    try {
      roundingRule(entry.roundingRule);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['roundingRule'],
        message: `'${entry.roundingRule}' is not a registered rounding rule. A display value has to name the rule that produced it.`,
      });
    }

    for (const [index, editable] of entry.editableAssumptions.entries()) {
      if (!(editable.key in entry.officialAssumptions)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['editableAssumptions', index, 'key'],
          message: `'${editable.key}' is editable but has no official default. A personal scenario is a departure from the official one; with no official value there is nothing to depart from.`,
        });
      }
      if (dec(editable.min).greaterThan(dec(editable.max))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['editableAssumptions', index],
          message: `bounds are inverted (min ${editable.min} > max ${editable.max}), so no value is admissible.`,
        });
      }
      const official = entry.officialAssumptions[editable.key];
      if (
        official !== undefined &&
        (dec(official).lessThan(dec(editable.min)) || dec(official).greaterThan(dec(editable.max)))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['editableAssumptions', index],
          message: `the official default ${official} lies outside the bounds a user may choose. The official run would then be one a user is forbidden to reproduce.`,
        });
      }
    }
  });

export type MethodDescriptor = z.infer<typeof methodDescriptor>;

/** A descriptor bound to its arithmetic. What `buildArtifact` and `replay` are handed. */
export type MethodRegistryEntry = MethodDescriptor & { readonly compute: MethodCompute };

// ── The second, code-level allowlist ──────────────────────────────────────────────────────────

/**
 * §4.4, binding: *"a database value can never make a prohibited parameter editable"*.
 *
 * The registry is projected into the database so the Inspector and the Explorer can read it.
 * That projection is data, and data can be edited. This map is the second gate — it lives in
 * source, it is reviewed like source, and an override is admitted only if **both** the registry
 * entry and this map permit the key.
 *
 * A key added here alone changes nothing. A key added to the registry alone changes nothing.
 * That is the property: making a parameter editable requires a code review either way.
 */
export const EDITABLE_ASSUMPTION_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'attention.rank_change': ['min_mentions'],
};

export type OverrideRejection = {
  readonly key: string;
  readonly reason:
    | 'not_registered'
    | 'not_code_allowlisted'
    | 'not_a_decimal'
    | 'below_min'
    | 'above_max'
    | 'official_scenario';
  readonly message: string;
};

export type OverrideOutcome =
  | { readonly ok: true; readonly key: string; readonly value: string }
  | { readonly ok: false; readonly rejection: OverrideRejection };

/**
 * The assumption validator. Every personal override passes through here, and nothing else may
 * decide the question — §4.4 puts the decision in exactly one place on purpose.
 */
export function validateOverride(
  descriptor: MethodDescriptor,
  key: string,
  value: string,
  options: { readonly scenario: 'official' | 'personal' } = { scenario: 'personal' },
): OverrideOutcome {
  const reject = (reason: OverrideRejection['reason'], message: string): OverrideOutcome => ({
    ok: false,
    rejection: { key, reason, message },
  });

  if (options.scenario === 'official') {
    return reject(
      'official_scenario',
      'Official scheduled materialisation ignores personal assumptions entirely ' +
        '(02-ARCHITECTURE-CONTRACTS.md §6). An override applied to an official run would make ' +
        'the official series depend on who last looked at it.',
    );
  }

  const registered = descriptor.editableAssumptions.find((entry) => entry.key === key);
  if (registered === undefined) {
    return reject(
      'not_registered',
      `'${key}' is not an editable assumption of ${descriptor.id}. The registry is the sole ` +
        'runtime description of what a user may change (§4.4).',
    );
  }

  const allowlisted = EDITABLE_ASSUMPTION_ALLOWLIST[descriptor.id] ?? [];
  if (!allowlisted.includes(key)) {
    return reject(
      'not_code_allowlisted',
      `'${key}' is marked editable by the registry entry for ${descriptor.id} but is not in the ` +
        'code-level allowlist. A registry projection is data, and data can be edited; §4.4 ' +
        'requires both gates so a database row can never make a prohibited parameter editable.',
    );
  }

  if (!isDecimalString(value)) {
    return reject(
      'not_a_decimal',
      `'${value}' is not a decimal string. Assumption values cross this boundary as decimal ` +
        'strings, never as floats (§4.1).',
    );
  }

  if (dec(value).lessThan(dec(registered.min))) {
    return reject('below_min', `${value} is below the permitted minimum ${registered.min}.`);
  }
  if (dec(value).greaterThan(dec(registered.max))) {
    return reject('above_max', `${value} is above the permitted maximum ${registered.max}.`);
  }

  return { ok: true, key, value };
}

// ── The registry itself ───────────────────────────────────────────────────────────────────────

export class MethodNotRegistered extends Error {
  constructor(
    readonly methodId: string,
    readonly version: string | null,
  ) {
    super(
      `No registered method '${methodId}'${version === null ? '' : ` at version ${version}`}. ` +
        'An artifact whose method version no longer exists stays readable; it just cannot be ' +
        'replayed (§4.6, `method_missing`).',
    );
    this.name = 'MethodNotRegistered';
  }
}

export class MethodRegistry {
  private readonly byKey: Map<string, MethodRegistryEntry>;

  constructor(entries: readonly MethodRegistryEntry[]) {
    this.byKey = new Map();
    for (const entry of entries) {
      const key = `${entry.id}@${entry.version}`;
      if (this.byKey.has(key)) {
        throw new Error(
          `Duplicate registry entry ${key}. Two definitions of one method version means the ` +
            'number an artifact recorded depends on which one loaded first.',
        );
      }
      this.byKey.set(key, entry);
    }
  }

  /** The entry an artifact must be replayed against: exact id **and** exact version. */
  find(methodId: string, version: string): MethodRegistryEntry | undefined {
    return this.byKey.get(`${methodId}@${version}`);
  }

  get(methodId: string, version: string): MethodRegistryEntry {
    const entry = this.find(methodId, version);
    if (entry === undefined) throw new MethodNotRegistered(methodId, version);
    return entry;
  }

  /** The latest version of a method, for a fresh computation rather than a replay. */
  latest(methodId: string): MethodRegistryEntry {
    const candidates = [...this.byKey.values()].filter((entry) => entry.id === methodId);
    if (candidates.length === 0) throw new MethodNotRegistered(methodId, null);
    return candidates.sort((a, b) => compareSemver(a.version, b.version)).at(-1) as MethodRegistryEntry;
  }

  all(): readonly MethodRegistryEntry[] {
    return [...this.byKey.values()];
  }
}

/** Numeric semver ordering. `1.10.0` sorts after `1.9.0`, which a string compare gets wrong. */
function compareSemver(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (const [index, part] of left.entries()) {
    const other = right[index] ?? '0';
    if (part.length !== other.length) return part.length < other.length ? -1 : 1;
    if (part !== other) return part < other ? -1 : 1;
  }
  return 0;
}

/** Parse-or-throw for a descriptor, used wherever descriptors are bound or projected. */
export function validateDescriptor(value: unknown): MethodDescriptor {
  return methodDescriptor.parse(value);
}
