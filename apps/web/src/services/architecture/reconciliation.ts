/**
 * F17 §5/§6 — CI manifest reconciliation, as pure comparison functions.
 *
 * Mirrors `scripts/checks/calc-coverage.ts`'s own split: the *comparison* lives here as a pure
 * function over plain data, and the *scanning* (reading source files, grepping literals) lives
 * in the test that calls it — `tests/unit/services/architecture/reconciliation.test.ts` — so this
 * module stays importable from a browser-safe, fs-free context and is unit-testable with fixed
 * inputs.
 *
 * Every function here answers the same question in one direction each: *"does everything the
 * manifest names exist in the live source, and does everything the live source names appear in
 * the manifest?"* — F17 §5's own phrasing. A finding is returned, never thrown, so a caller can
 * report every drift in one run rather than stopping at the first.
 */
export type ReconciliationFinding = {
  readonly category: 'provider' | 'job' | 'model_task' | 'method';
  readonly direction: 'manifest_names_unknown' | 'live_missing_from_manifest';
  readonly id: string;
  readonly message: string;
};

function diffSets(
  category: ReconciliationFinding['category'],
  manifestIds: readonly string[],
  liveIds: readonly string[],
): ReconciliationFinding[] {
  const manifestSet = new Set(manifestIds);
  const liveSet = new Set(liveIds);
  const findings: ReconciliationFinding[] = [];

  for (const id of manifestSet) {
    if (!liveSet.has(id)) {
      findings.push({
        category,
        direction: 'manifest_names_unknown',
        id,
        message: `The manifest names '${id}' as a ${category}, but the live source no longer does. Either it was removed from source and the manifest was not, or it was never real.`,
      });
    }
  }
  for (const id of liveSet) {
    if (!manifestSet.has(id)) {
      findings.push({
        category,
        direction: 'live_missing_from_manifest',
        id,
        message: `The live source declares '${id}' as a ${category}, but the manifest does not name it anywhere — not even as a disclosed gap. A reader of this Explorer would not know it exists.`,
      });
    }
  }
  return findings;
}

/**
 * Providers. `manifestWired` is `manifest.ts`'s `WIRED_PROVIDERS`; `manifestUnwiredWithReason`
 * is `KNOWN_UNWIRED_PROVIDERS`'s provider ids — together they must cover every id the live
 * `providerId` contract enum names, and `scannedWiredProviders` (grepped from `src/adapters/**`
 * and `src/services/**`) must agree with `manifestWired` exactly.
 */
export function reconcileProviders(args: {
  readonly contractProviderIds: readonly string[];
  readonly manifestWired: readonly string[];
  readonly manifestUnwired: readonly string[];
  readonly scannedWiredProviders: readonly string[];
}): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];

  // Every contract provider id must be accounted for exactly once: wired, or disclosed unwired.
  for (const id of args.contractProviderIds) {
    const wired = args.manifestWired.includes(id);
    const unwired = args.manifestUnwired.includes(id);
    if (!wired && !unwired) {
      findings.push({
        category: 'provider',
        direction: 'live_missing_from_manifest',
        id,
        message: `'${id}' is a live provider id (contracts/provider.ts) that the manifest neither lists as wired nor discloses as an intentional gap.`,
      });
    }
    if (wired && unwired) {
      findings.push({
        category: 'provider',
        direction: 'manifest_names_unknown',
        id,
        message: `'${id}' is listed both as wired and as a disclosed gap — the manifest contradicts itself.`,
      });
    }
  }
  // Nothing in either manifest list may name a provider outside the live contract.
  for (const id of [...args.manifestWired, ...args.manifestUnwired]) {
    if (!args.contractProviderIds.includes(id)) {
      findings.push({
        category: 'provider',
        direction: 'manifest_names_unknown',
        id,
        message: `The manifest names '${id}' as a provider, which is not in the live providerId contract.`,
      });
    }
  }
  // The manifest's own claim of what is wired must match what the source actually does.
  findings.push(...diffSets('provider', args.manifestWired, args.scannedWiredProviders));

  return findings;
}

/** Job keys. `scannedJobKeys` is grepped from every `..._JOB_KEY = '...'` export under `src/services/jobs/`. */
export function reconcileJobs(args: {
  readonly manifestJobKeys: readonly string[];
  readonly scannedJobKeys: readonly string[];
}): ReconciliationFinding[] {
  return diffSets('job', args.manifestJobKeys, args.scannedJobKeys);
}

/** Model-route tasks. `liveModelTasks` is `services/llm/ports.ts`'s `MODEL_TASKS`, imported directly. */
export function reconcileModelTasks(args: {
  readonly manifestModelTasks: readonly string[];
  readonly liveModelTasks: readonly string[];
}): ReconciliationFinding[] {
  return diffSets('model_task', args.manifestModelTasks, args.liveModelTasks);
}

/**
 * Methods. `registryIds` is every `id@version` `analytics/registry.ts` declares;
 * `boundIds` is every `id@version` `services/calculations.ts`'s `METHOD_REGISTRY` actually
 * bound to arithmetic. `bindRegistry` already throws at module load on a mismatch between the
 * descriptor list and the compute map — this reconciliation is the second, explicit, named
 * check the DoD asks for, not a substitute for that structural one.
 */
export function reconcileMethods(args: {
  readonly registryIds: readonly string[];
  readonly boundIds: readonly string[];
}): ReconciliationFinding[] {
  return diffSets('method', args.registryIds, args.boundIds);
}
