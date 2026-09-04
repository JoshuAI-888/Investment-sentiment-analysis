/**
 * F17 §4.1/§4.5 — formula examples that call the **production** analytics library on a real
 * subject and link to the resulting real artifact.
 *
 * "Real" means every one of these:
 *
 * 1. The inputs are the same committed golden fixtures `analytics/registry.ts`'s own methods
 *    are tested against (`src/analytics/goldens/*.json`) — reviewed data already checked by
 *    `check:calc-coverage`, never a number typed into this file.
 * 2. The computation runs through `services/calculations.ts`'s `computeArtifact` — the same
 *    function every production caller (F07's dashboard, F08's leaderboard, F09's ticker page)
 *    uses — via `attention.rank_change`'s own dedicated production path
 *    (`services/attention-rank-change.ts`) where one exists, and `resolveAssumptions` (`calc/
 *    assumptions.ts`) for every method's official-scenario assumption resolution, exactly as a
 *    real caller would.
 * 3. The result is persisted through `services/calculations.ts`'s `persistArtifact` /
 *    `repositories/calculations.ts`'s `insertArtifact` — a real row in `calculation_snapshot`,
 *    inspectable at `/calculations/{id}` like any other artifact in the product.
 * 4. Generation is idempotent, not re-run on every page view: `ensureExampleArtifact` looks the
 *    artifact up by a deterministic id first, computes and persists only on a genuine miss, and
 *    a PK-conflict from a concurrent first-visitor race resolves by re-reading rather than
 *    erroring the page.
 *
 * `retentionClass: 'permanent'` — these are permanently referenced by the calculation catalogue
 * (F05 §7.2's own category: "anything a claim, share or open issue references"), the same reason
 * an Inspector artifact reached from a bookmark or a support ticket does not expire silently.
 */
import { createHash } from 'node:crypto';
import type { CalculationInputValue } from '@/calc/artifact';
import { resolveAssumptions } from '@/calc/assumptions';
import type { MethodRegistryEntry } from '@/calc/registry';
import type { ApeWisdomEntry } from '@/adapters/apewisdom';
import { computeArtifact, persistArtifact, loadArtifact, METHOD_REGISTRY } from '@/services/calculations';
import { computeRankChange, inputsFromBoardEntry, type BoardReading } from '@/services/attention-rank-change';
import { findActiveConfigVersion } from '@/repositories/versions';
import { getPool, type Queryable } from '@/repositories/client';
import type { CalculationArtifact, Subject } from '@/calc/artifact';
import {
  ARCHITECTURE_ENVIRONMENT,
  EXAMPLE_MARKET_ID,
  EXAMPLE_SECURITY_ID,
  EXAMPLE_SECURITY_LABEL,
  NO_CONFIG_VERSION_BOOTSTRAPPED,
} from './constants';

import attentionRankChangeV1 from '@/analytics/goldens/attention.rank_change.v1.0.0.json';
import attentionRankChangeV1_1 from '@/analytics/goldens/attention.rank_change.v1.1.0.json';
import attentionMentionDelta from '@/analytics/goldens/attention.mention_delta.json';
import attentionMentionGrowth from '@/analytics/goldens/attention.mention_growth.json';
import attentionEngagementPerMention from '@/analytics/goldens/attention.engagement_per_mention.json';
import attentionMentionsZscore from '@/analytics/goldens/attention.mentions_zscore.json';
import socialStanceReddit from '@/analytics/goldens/social.stance_reddit.json';
import socialStanceX from '@/analytics/goldens/social.stance_x.json';
import socialStanceSubstack from '@/analytics/goldens/social.stance_substack.json';
import newsSentiment from '@/analytics/goldens/news.sentiment.json';
import priceRegime from '@/analytics/goldens/price.regime.json';
import priceVolatility20 from '@/analytics/goldens/price.volatility_20.json';
import marketSectorBreadth from '@/analytics/goldens/market.sector_breadth.json';
import marketComposite from '@/analytics/goldens/market.composite.json';
import marketDivergenceState from '@/analytics/goldens/market.divergence_state.json';
import technicalRsi14 from '@/analytics/goldens/technical.rsi_14.json';
import technicalMovingAverage20 from '@/analytics/goldens/technical.moving_average_20.json';
import technicalMovingAverage50 from '@/analytics/goldens/technical.moving_average_50.json';
import technicalRecentHigh20 from '@/analytics/goldens/technical.recent_high_20.json';
import technicalRecentLow20 from '@/analytics/goldens/technical.recent_low_20.json';

// ── Deterministic identity ────────────────────────────────────────────────────────────────────

/**
 * A stable, valid v4-shaped UUID derived from a seed — not `crypto.randomUUID()`. The same
 * (methodId, version) must resolve to the same artifact on every call, in every environment,
 * so a second visitor's page load finds what the first one already computed rather than minting
 * a duplicate. Formatted exactly like the fixed ids `tests/unit/calc/golden-helpers.ts` already
 * uses (`contracts/primitives.ts`'s `uuid` schema accepts it).
 */
function stableExampleId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  const bytes = hex.slice(0, 32);
  return [
    bytes.slice(0, 8),
    bytes.slice(8, 12),
    `4${bytes.slice(13, 16)}`,
    `8${bytes.slice(17, 20)}`,
    bytes.slice(20, 32),
  ].join('-');
}

function calculationIdFor(methodId: string, version: string): string {
  return stableExampleId(`architecture-example:${methodId}@${version}`);
}

// ── Lean golden case → production inputs ──────────────────────────────────────────────────────

type LeanCase = {
  readonly name: string;
  readonly inputs?: Readonly<Record<string, string>>;
  readonly identityInputs?: Readonly<Record<string, string>>;
  readonly seriesInputs?: Readonly<Record<string, readonly string[]>>;
  readonly assumptions?: Readonly<Record<string, string>>;
  readonly expected: { readonly eligibility: string };
};

type LeanGolden = { readonly cases: readonly LeanCase[] };

const EXAMPLE_PROVENANCE = {
  sourceUrl: null,
  observedAt: '2026-08-30T11:55:00.000000Z',
  availableAt: '2026-08-30T11:55:00.000000Z',
  ingestedAt: '2026-08-30T11:56:00.000000Z',
  rawPayloadId: null,
  licenseClass: 'internal_fixture',
  redactionClass: 'public',
} as const;

function decimalInput(key: string, value: string, unit = ''): CalculationInputValue {
  return {
    key,
    value,
    unit,
    dataType: 'decimal',
    source: 'architecture_example',
    quality: 'ok',
    freshness: 'fresh',
    provenance: { provider: 'architecture_example', providerField: key, ...EXAMPLE_PROVENANCE },
  };
}

function identityInput(key: string, value: string): CalculationInputValue {
  return {
    key,
    value,
    unit: null,
    dataType: 'identity',
    source: 'architecture_example',
    quality: 'ok',
    freshness: 'fresh',
    provenance: { provider: 'architecture_example', providerField: key, ...EXAMPLE_PROVENANCE },
  };
}

/**
 * Prefers a case the registry's own eligibility rules accept ("ok"), and among those, one with
 * no assumption override — a worked example should show the *official* run, not a scenario. If
 * no case is eligible, the first case is used: a real, honestly-abstaining artifact is still a
 * real artifact, and still worth linking to (§6.3 — abstention is rendered, not hidden).
 */
function pickCase(golden: LeanGolden): LeanCase {
  const okNoOverride = golden.cases.find(
    (c) => c.expected.eligibility === 'ok' && c.assumptions === undefined,
  );
  if (okNoOverride !== undefined) return okNoOverride;
  const ok = golden.cases.find((c) => c.expected.eligibility === 'ok');
  if (ok !== undefined) return ok;
  const first = golden.cases[0];
  if (first === undefined) throw new Error('golden fixture has no cases');
  return first;
}

function inputsFromLeanCase(testCase: LeanCase): CalculationInputValue[] {
  return [
    ...Object.entries(testCase.inputs ?? {}).map(([key, value]) => decimalInput(key, value)),
    ...Object.entries(testCase.identityInputs ?? {}).map(([key, value]) => identityInput(key, value)),
    ...Object.entries(testCase.seriesInputs ?? {}).flatMap(([prefix, values]) =>
      values.map((value, index) => decimalInput(`${prefix}_${index}`, value)),
    ),
  ];
}

function subjectFor(entry: MethodRegistryEntry, name: string): Subject {
  if (entry.subjectKind === 'market') {
    return { kind: 'market', id: EXAMPLE_MARKET_ID, label: `Example — ${name}` };
  }
  return { kind: 'security', id: EXAMPLE_SECURITY_ID, label: EXAMPLE_SECURITY_LABEL };
}

const AS_OF = '2026-08-30T12:00:00.000Z';

async function resolvedConfigVersion(db: Queryable): Promise<string> {
  const active = await findActiveConfigVersion(ARCHITECTURE_ENVIRONMENT, db);
  return active?.id ?? NO_CONFIG_VERSION_BOOTSTRAPPED;
}

/** Builds (never persists) the artifact for a lean-golden-backed method. Pure given its inputs. */
function buildLeanExample(entry: MethodRegistryEntry, configVersion: string): CalculationArtifact {
  const golden = LEAN_GOLDENS[`${entry.id}@${entry.version}`];
  if (golden === undefined) {
    throw new Error(`no golden fixture wired for ${entry.id}@${entry.version} (architecture example)`);
  }
  const testCase = pickCase(golden);
  const { assumptions } = resolveAssumptions({ descriptor: entry, scenario: 'official' });

  return computeArtifact({
    methodId: entry.id,
    methodVersion: entry.version,
    subject: subjectFor(entry, testCase.name),
    asOf: AS_OF,
    inputs: inputsFromLeanCase(testCase),
    assumptions,
    configVersion,
    scenario: { kind: 'official' },
    calculationId: calculationIdFor(entry.id, entry.version),
    registry: METHOD_REGISTRY,
    retentionClass: 'permanent',
  });
}

/** `attention.rank_change` has its own production path (`services/attention-rank-change.ts`) — used directly, not re-derived here. */
function buildRankChangeExample(version: string, configVersion: string): CalculationArtifact {
  const golden = version === '1.0.0' ? attentionRankChangeV1 : attentionRankChangeV1_1;
  const caseData = golden.cases.find((c) => c.expected.eligibility === 'ok' && 'entry' in c) as
    | { readonly entry: ApeWisdomEntry; readonly name: string }
    | undefined;
  if (caseData === undefined) throw new Error(`no eligible case in ${golden.methodId}.v${version} golden`);

  const readingSource = golden.reading as {
    readonly filter: string;
    readonly sourceUrl: string;
    readonly observedAt: string;
    readonly availableAt: string;
    readonly ingestedAt: string;
    readonly rawPayloadId: string | null;
    readonly methodologyVersion?: string;
  };
  // v1.0.0's golden predates F06 §4.1's methodology-version field. 'v1' is the same synthetic
  // default the v1.1.0 golden itself uses for a case that crosses no boundary — not a value this
  // method's arithmetic reads, only an identity input naming which methodology produced it.
  const methodologyVersion = readingSource.methodologyVersion ?? 'v1';
  const reading: BoardReading = { ...readingSource, methodologyVersion };

  // `computeRankChange` always resolves the *latest* registered version (its own doc comment,
  // `services/attention-rank-change.ts`) — the production convenience wrapper real callers use.
  // For that one version it is used directly; for every other (older) registered version, the
  // example is built one level down, through `computeArtifact` directly, with the same
  // input-building function production uses (`inputsFromBoardEntry`) and an explicit
  // `methodVersion`. Still the production path — just not through a wrapper that, by design, has
  // no version parameter to pin to an older version.
  const latestVersion = METHOD_REGISTRY.latest('attention.rank_change').version;
  if (version === latestVersion) {
    return computeRankChange({
      entry: caseData.entry,
      reading,
      securityId: EXAMPLE_SECURITY_ID,
      asOf: AS_OF,
      configVersion,
      calculationId: calculationIdFor('attention.rank_change', version),
      registry: METHOD_REGISTRY,
      priorMethodologyVersion: methodologyVersion,
    });
  }

  const entry = METHOD_REGISTRY.get('attention.rank_change', version);
  const { assumptions } = resolveAssumptions({ descriptor: entry, scenario: 'official' });
  return computeArtifact({
    methodId: entry.id,
    methodVersion: entry.version,
    subject: { kind: 'security', id: EXAMPLE_SECURITY_ID, label: caseData.entry.ticker },
    asOf: AS_OF,
    inputs: inputsFromBoardEntry(caseData.entry, reading, methodologyVersion),
    assumptions,
    configVersion,
    scenario: { kind: 'official' },
    calculationId: calculationIdFor('attention.rank_change', version),
    registry: METHOD_REGISTRY,
    retentionClass: 'permanent',
  });
}

const LEAN_GOLDENS: Readonly<Record<string, LeanGolden>> = {
  'attention.mention_delta@1.0.0': attentionMentionDelta,
  'attention.mention_growth@1.0.0': attentionMentionGrowth,
  'attention.engagement_per_mention@1.0.0': attentionEngagementPerMention,
  'attention.mentions_zscore@1.0.0': attentionMentionsZscore,
  'social.stance_reddit@1.0.0': socialStanceReddit,
  'social.stance_x@1.0.0': socialStanceX,
  'social.stance_substack@1.0.0': socialStanceSubstack,
  'news.sentiment@1.0.0': newsSentiment,
  'price.regime@1.0.0': priceRegime,
  'price.volatility_20@1.0.0': priceVolatility20,
  'market.sector_breadth@1.0.0': marketSectorBreadth,
  'market.composite@1.0.0': marketComposite,
  'market.divergence_state@1.0.0': marketDivergenceState,
  'technical.rsi_14@1.0.0': technicalRsi14,
  'technical.moving_average_20@1.0.0': technicalMovingAverage20,
  'technical.moving_average_50@1.0.0': technicalMovingAverage50,
  'technical.recent_high_20@1.0.0': technicalRecentHigh20,
  'technical.recent_low_20@1.0.0': technicalRecentLow20,
};

/**
 * Builds the artifact for any registered method entry — the dispatch this module exists for.
 *
 * `retentionClass` is forced to `'permanent'` here, uniformly, rather than trusted from whichever
 * path built the artifact: `computeRankChange` (the real production convenience wrapper attention
 * .rank_change's latest version goes through) has no `retentionClass` parameter at all — a
 * personal/official calculation has no reason to override it, so it always defaults to
 * `'standard'`. Overriding it after the fact touches only the storage/lifecycle tag, never the
 * computed value, its inputs, or either hash — `retentionClass` is not part of what either hash
 * is taken over (`buildArtifact`/`canonicalHash`).
 */
function buildExample(entry: MethodRegistryEntry, configVersion: string): CalculationArtifact {
  const artifact =
    entry.id === 'attention.rank_change'
      ? buildRankChangeExample(entry.version, configVersion)
      : buildLeanExample(entry, configVersion);
  return artifact.retentionClass === 'permanent' ? artifact : { ...artifact, retentionClass: 'permanent' };
}

/**
 * Computes (if not already persisted) and returns the real artifact for one registry entry.
 * Idempotent: a second call finds the first call's row rather than recomputing or duplicating.
 */
export async function ensureExampleArtifact(
  entry: MethodRegistryEntry,
  db: Queryable = getPool(),
): Promise<CalculationArtifact> {
  const calculationId = calculationIdFor(entry.id, entry.version);
  const existing = await loadArtifact(calculationId, db);
  if (existing !== null) return existing;

  const configVersion = await resolvedConfigVersion(db);
  const artifact = buildExample(entry, configVersion);

  try {
    await persistArtifact(artifact);
  } catch (error) {
    // A concurrent first-visitor race: the unique index on (subject/method/config/input_hash)
    // — or the deterministic id itself — was claimed between the read above and this insert.
    // Re-read rather than treat this as a failure; the artifact the other request wrote is the
    // same real artifact this one would have written.
    const retry = await loadArtifact(calculationId, db);
    if (retry !== null) return retry;
    throw error;
  }

  return artifact;
}

/** Every registered method's worked example, computed/persisted as needed. Order follows the registry. */
export async function ensureAllExampleArtifacts(
  db: Queryable = getPool(),
): Promise<readonly CalculationArtifact[]> {
  const artifacts: CalculationArtifact[] = [];
  for (const entry of METHOD_REGISTRY.all()) {
    artifacts.push(await ensureExampleArtifact(entry, db));
  }
  return artifacts;
}
