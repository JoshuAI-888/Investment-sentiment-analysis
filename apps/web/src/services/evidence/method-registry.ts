/**
 * The two D-21 LLM methods, registered — F10 §4.4: *"each a registered `MethodRegistry` entry
 * with its own version, so the Inspector shows which method produced which field."* Also
 * registers `DETERMINISTIC_CANDIDACY_METHOD`, the sentinel stamped on an item that was excluded
 * before any LLM call was even attempted, so that version resolves in the registry too rather
 * than throwing (lane-review finding 5c).
 *
 * ## Why this is not `calc/registry.ts`'s `MethodRegistry`
 *
 * That registry (`02-ARCHITECTURE-CONTRACTS.md` §4.3) is bound to `CalculationArtifact`:
 * `officialAssumptions`/`editableAssumptions` as decimal strings, a `roundingRule`, a
 * `workingPrecision` — the vocabulary of a deterministic numeric computation. `relevance.filter`
 * and `entity.collision_guard` produce a boolean verdict from a model call, not a decimal
 * artifact with a rounding rule; forcing them through that shape would mean inventing a fake
 * `roundingRule` and a fake `workingPrecision` for a value that has neither, which is worse than
 * not fitting the registry at all. `calc/` and `services/inspector.ts` also both belong to
 * SPINE — this lane cannot add entries to them regardless.
 *
 * So this is a **parallel, intentionally smaller registry**, mirroring the pattern (versioned
 * entries, `find`/`get`/`latest`, one throw on a duplicate version) without the decimal-specific
 * fields that do not apply. **Reported under this lane's `CONTRACTS` line**: making these two
 * methods visible in the *shared* Inspector needs either a non-numeric entry shape in
 * `calc/registry.ts` (SPINE) or `services/inspector.ts` reading `classifiedItem.
 * relevanceMethodVersion` directly — this lane cannot decide which without editing SPINE's files.
 */

export type ClassificationMethodEntry = {
  readonly methodId: string;
  readonly version: string;
  readonly title: string;
  /** Bumped whenever the prompt text changes in a way that could change the model's answer.
   *  `null` for a purely deterministic method that never calls a model at all. */
  readonly promptVersion: string | null;
  /** D-34's task route for both of v1's LLM methods; `null` when no LLM call is involved. */
  readonly route: 'AI_MODEL_FAST' | null;
  readonly temperature: 0 | null;
  /** F-03: shown wherever this method's output is disclosed. */
  readonly limitations: readonly string[];
};

export const RELEVANCE_FILTER_METHOD = {
  methodId: 'relevance.filter',
  version: '1.0.0',
  title: 'Relevance filter (aboutness)',
  promptVersion: 'relevance.filter@1',
  route: 'AI_MODEL_FAST',
  temperature: 0,
  limitations: [
    'Judges aboutness only — it never scores or produces a stance; stance is F20\'s pinned scorer, never this method (D-13).',
    'Does not detect sarcasm or irony (deferred by D-21, named trigger: measured error attributable to it).',
    'A schema-invalid response is retried once, then the item is dropped rather than guessed.',
  ],
} as const satisfies ClassificationMethodEntry;

export const COLLISION_GUARD_METHOD = {
  methodId: 'entity.collision_guard',
  version: '1.0.0',
  title: 'Ticker-collision guard',
  promptVersion: 'entity.collision_guard@1',
  route: 'AI_MODEL_FAST',
  temperature: 0,
  limitations: [
    'Runs only on the four named ambiguous tokens (AI, ON, IT, ALL) that also passed a deterministic corroboration check (F10 §4.2) — it never runs on an unmatched token.',
    'A schema-invalid response, or a backend outage, excludes the item rather than admitting an unresolved ambiguous mention.',
  ],
} as const satisfies ClassificationMethodEntry;

/**
 * Registered so a `relevanceMethodVersion` stamped with this sentinel (an item excluded before
 * any LLM call was ever attempted — no mention at all, or an ambiguous token with no
 * corroborating reference) resolves in the registry instead of throwing
 * `ClassificationMethodNotRegistered` (lane-review finding 5c).
 */
export const DETERMINISTIC_CANDIDACY_METHOD = {
  methodId: 'candidacy.deterministic',
  version: '1.0.0',
  title: 'Deterministic mention candidacy (no LLM)',
  promptVersion: null,
  route: null,
  temperature: null,
  limitations: [
    'Purely lexical: exact-symbol/cashtag/company-name matching plus the ticker-collision candidacy gate (F10 §4.2). Never judges aboutness or semantic context — that is relevance.filter and entity.collision_guard\'s job.',
  ],
} as const satisfies ClassificationMethodEntry;

/** `methodId@version`, the sentinel actually stamped on `ClassifiedItem.relevanceMethodVersion`. */
export const DETERMINISTIC_CANDIDACY_VERSION_TAG = `${DETERMINISTIC_CANDIDACY_METHOD.methodId}@${DETERMINISTIC_CANDIDACY_METHOD.version}`;
export const RELEVANCE_FILTER_VERSION_TAG = `${RELEVANCE_FILTER_METHOD.methodId}@${RELEVANCE_FILTER_METHOD.version}`;
export const COLLISION_GUARD_VERSION_TAG = `${COLLISION_GUARD_METHOD.methodId}@${COLLISION_GUARD_METHOD.version}`;

export class DuplicateClassificationMethod extends Error {
  constructor(key: string) {
    super(`Duplicate classification method entry ${key} — two definitions of one method version.`);
    this.name = 'DuplicateClassificationMethod';
  }
}

export class ClassificationMethodNotRegistered extends Error {
  constructor(methodId: string, version: string | null) {
    super(
      `No registered classification method '${methodId}'${version === null ? '' : ` at version ${version}`}.`,
    );
    this.name = 'ClassificationMethodNotRegistered';
  }
}

export class ClassificationMethodRegistry {
  private readonly byKey = new Map<string, ClassificationMethodEntry>();

  constructor(entries: readonly ClassificationMethodEntry[]) {
    for (const entry of entries) {
      const key = `${entry.methodId}@${entry.version}`;
      if (this.byKey.has(key)) throw new DuplicateClassificationMethod(key);
      this.byKey.set(key, entry);
    }
  }

  find(methodId: string, version: string): ClassificationMethodEntry | undefined {
    return this.byKey.get(`${methodId}@${version}`);
  }

  get(methodId: string, version: string): ClassificationMethodEntry {
    const entry = this.find(methodId, version);
    if (entry === undefined) throw new ClassificationMethodNotRegistered(methodId, version);
    return entry;
  }

  latest(methodId: string): ClassificationMethodEntry {
    const candidates = [...this.byKey.values()].filter((entry) => entry.methodId === methodId);
    if (candidates.length === 0) throw new ClassificationMethodNotRegistered(methodId, null);
    return candidates.sort((a, b) => compareSemver(a.version, b.version)).at(-1) as ClassificationMethodEntry;
  }

  all(): readonly ClassificationMethodEntry[] {
    return [...this.byKey.values()];
  }
}

function compareSemver(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (const [index, part] of left.entries()) {
    const other = right[index] ?? '0';
    const l = Number(part);
    const r = Number(other);
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export const EVIDENCE_METHOD_REGISTRY = new ClassificationMethodRegistry([
  RELEVANCE_FILTER_METHOD,
  COLLISION_GUARD_METHOD,
  DETERMINISTIC_CANDIDACY_METHOD,
]);
