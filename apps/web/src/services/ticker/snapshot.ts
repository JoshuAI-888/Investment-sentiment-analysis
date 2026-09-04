/**
 * F09 — assembling the ticker snapshot entirely from stored data (DoD item 1: "no provider call
 * in the read path"). Every read below goes through a repository against already-collected
 * rows; nothing here imports `src/adapters/`.
 *
 * **Compute-on-read, not cache-on-write.** Unlike F07's dashboard, which reads a `calculationId`
 * pointer a background refresh already wrote, F09 has no refresh job of its own (F16 is not
 * built). So this module computes each axis's artifact fresh from stored snapshots on every call
 * and persists it (`persistArtifact` — a database write, not a provider call) so its
 * `calculationId` resolves in the Inspector. **This is a disclosed cost, not a hidden one**: a
 * popular ticker viewed repeatedly writes one `calculation_snapshot` row per axis per view rather
 * than reusing a cached one. `calculation_snapshot` rows are declared 90-day-retained
 * (`02-ARCHITECTURE-CONTRACTS.md` §5.1) — **but round-1 lane-review finding 6 found no caller of
 * `repositories/retention.ts#purgeExpired` anywhere in this codebase, so that retention window is
 * a policy this database enforces nowhere yet.** Until something runs that purge on a schedule
 * (F16's job scheduler is not built either), every render's writes are effectively permanent, not
 * bounded by the 90-day figure this comment previously claimed as already true. This is a real
 * cost under real traffic, flagged here and in this feature's RISKS/DEFERRED rather than quietly
 * accepted. A short-TTL cache in front of this function is the natural follow-up and is out of
 * this feature's scope (no cache infrastructure is specified in F09's DoD); wiring `purgeExpired`
 * into a scheduled job is F16's, not this lane's, to build.
 */
import { randomUUID } from 'node:crypto';
import type { CalculationArtifact, CalculationInputValue } from '@/calc/artifact';
import { D } from '@/calc/decimal';
import { DIVERGENCE_DISCLOSURE_LINE, DIVERGENCE_STATE_BY_CODE, DIVERGENCE_STATE_INTERPRETATION } from '@/calc/divergence';
import type { AttentionSnapshot, MarketSnapshot, PriceReturnSnapshot } from '@/contracts/security';
import type { EvidenceItem } from '@/contracts/evidence';
import { computeArtifact, persistArtifact, METHOD_REGISTRY } from '@/services/calculations';
import { attentionSnapshotHistory } from '@/repositories/attention';
import { latestMarketSnapshot, marketSnapshotHistory, latestPriceReturnSnapshot } from '@/repositories/market';
import { evidenceForSecurity, type EvidenceItemWithDedupeKey } from '@/repositories/evidence';
import { findActiveConfigVersion } from '@/repositories/versions';
import { findSecurityById } from '@/repositories/security';
import type { Queryable } from '@/repositories/client';
import { resolveTickerSymbol } from './resolve';
import { attentionInputs, newsInputsFromEvidence, officialAssumptions, priceSeriesInputs, stanceInputsFromEvidence } from './inputs';
import { segmentSeriesForAxis } from './coverage';
import { methodologyEntryFor } from './methodology';
import type {
  AttentionAxis,
  AxisMetric,
  DivergencePanel,
  EvidenceDrawer,
  EvidenceItemView,
  MethodologyEntry,
  NewsAxis,
  PriceAxis,
  StanceFrame,
  TickerHeader,
  TickerSnapshotResponse,
} from './contract';

/** Mirrors `services/dashboard/refresh.ts`'s `DASHBOARD_CONFIG_ENVIRONMENT` — one active config per environment, app-wide. */
const CONFIG_ENVIRONMENT = 'production';

/**
 * Best-guess provider-name allowlists per social axis, disclosed here rather than hidden. No
 * social collector has merged yet (F04's Reddit/X/Substack adapters, F08's leaderboard), so the
 * exact `evidence_item.provider` string each will write is not yet settled — `provider` is a
 * free-text column (`contracts/evidence.ts`), not an enum with 'reddit'/'x'/'substack' values.
 * Verify this mapping once those adapters merge; reported under this feature's CONTRACTS line.
 *
 * Round-1 lane-review finding 7: the `x` entry previously also matched `'twitter'`, a string that
 * is not a member of `contracts/provider.ts#providerId`'s canonical set (`'reddit' | 'x' |
 * 'substack'` for the social sources, per F04's D-12 provider list) — that adapter can never
 * write it, so it was a gratuitously wider guess than the other two axes, not a genuinely
 * equal-confidence unverified mapping.
 */
const SOCIAL_AXIS_PROVIDERS: Readonly<Record<'reddit' | 'x' | 'substack', readonly string[]>> = {
  reddit: ['reddit'],
  x: ['x'],
  substack: ['substack'],
};

/** D-14, verbatim per frame — "an observed Reddit comment sample, a watched-account X sample opened by a price trigger, and a curated Substack set." */
const SOCIAL_AXIS_DISCLOSURE: Readonly<Record<'reddit' | 'x' | 'substack', string>> = {
  reddit:
    'This frame is an observed sample of Reddit comments and posts matching this security — not a survey and not a random sample of everything said about it.',
  x: 'This frame is a sample of watched-account X posts opened by a price trigger (D-15) — it activates only when a price move crosses a defined threshold, not continuously, so a quiet window here can mean "no trigger fired" rather than "no discussion".',
  substack:
    'This frame is a curated set of Substack newsletter passages selected for relevance to this security — not a random or representative sample of financial commentary.',
};

const SOCIAL_AXIS_LABEL: Readonly<Record<'reddit' | 'x' | 'substack', string>> = {
  reddit: 'Reddit',
  x: 'X',
  substack: 'Substack',
};

function isClassified(item: EvidenceItem): boolean {
  return item.stanceLabel !== null && item.stanceScore !== null && item.relevanceScore !== null;
}

function signOfDecimal(value: string): '1' | '-1' | '0' {
  const dec = new D(value);
  if (dec.isZero()) return '0';
  return dec.greaterThan('0') ? '1' : '-1';
}

function freshestObservedAt(artifact: CalculationArtifact): Date | null {
  const observed = artifact.inputs
    .map((input) => input.provenance.observedAt)
    .filter((value): value is string => value !== null)
    .sort();
  const last = observed.at(-1);
  return last === undefined ? null : new Date(last);
}

function projectAxisMetric(
  artifact: CalculationArtifact,
  label: string,
  source: string,
  window: string,
  n: number,
): AxisMetric {
  return {
    calculationId: artifact.calculationId,
    metricId: artifact.methodId,
    label,
    display: artifact.result?.display ?? null,
    unit: artifact.result?.unit ?? '',
    roundingRule: artifact.result?.roundingRule ?? '',
    eligibility: artifact.eligibility,
    reason: artifact.abstention?.message ?? null,
    asOf: new Date(artifact.asOf),
    source,
    n,
    window,
    observedAt: freshestObservedAt(artifact),
    stale: artifact.eligibility === 'stale',
  };
}

type ComputeArgs = {
  readonly methodId: string;
  readonly inputs: readonly CalculationInputValue[];
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly asOf: Date;
  readonly configVersion: string;
};

/** Computes, persists (DB write — not a provider call) and returns the artifact. */
async function computeAndPersist(args: ComputeArgs): Promise<CalculationArtifact> {
  const artifact = computeArtifact({
    methodId: args.methodId,
    subject: { kind: 'security', id: args.subjectId, label: args.subjectLabel },
    asOf: args.asOf.toISOString(),
    inputs: args.inputs,
    assumptions: officialAssumptions(args.methodId),
    configVersion: args.configVersion,
    calculationId: randomUUID(),
  });
  await persistArtifact(artifact);
  return artifact;
}

export type AssembleOptions = {
  readonly asOf?: Date;
  readonly db?: Queryable;
};

export async function assembleTickerSnapshot(
  symbol: string,
  options: AssembleOptions = {},
): Promise<TickerSnapshotResponse> {
  const asOf = options.asOf ?? new Date();
  const db = options.db;

  const resolved = await resolveTickerSymbol(symbol, asOf, db);
  if (!resolved.ok) {
    return { resolved: false, refusal: resolved.refusal };
  }
  const security = resolved.security;

  const [fullSecurity, latestMkt, marketHistory, return7, return30, attentionHistory, evidenceResult, activeConfig] =
    await Promise.all([
      findSecurityById(security.id, db),
      latestMarketSnapshot({ securityId: security.id, asOfInstant: asOf }, db),
      marketSnapshotHistory({ securityId: security.id, asOfInstant: asOf, session: 'eod', limit: 60 }, db),
      latestPriceReturnSnapshot({ securityId: security.id, horizonCalendarDays: 7, asOfInstant: asOf }, db),
      latestPriceReturnSnapshot({ securityId: security.id, horizonCalendarDays: 30, asOfInstant: asOf }, db),
      // Round-1 lane-review finding 7: `attention_snapshot.source` distinguishes 'apewisdom' from
      // 'reddit' (`contracts/security.ts#attentionSource`), and F08's own collector — the only
      // writer of this table — writes 'apewisdom' (`services/attention/collector.ts`). This axis
      // is ApeWisdom's Reddit-mentions board, but the stored fact's `source` column names the
      // data vendor, not the underlying platform; reading 'reddit' here would silently and
      // permanently see no rows.
      attentionSnapshotHistory({ securityId: security.id, source: 'apewisdom', asOfInstant: asOf, limit: 30 }, db),
      evidenceForSecurity({ securityId: security.id, asOfInstant: asOf, limit: 200 }, db),
      findActiveConfigVersion(CONFIG_ENVIRONMENT, db),
    ]);

  const configVersion = activeConfig?.id ?? null;
  const subjectLabel = security.symbol;

  // ── Header (§4.1) ──────────────────────────────────────────────────────────────────────────
  // Round-4 lane-review finding 4: F09 §2 lists "insider and filings links (cut-line items 3 and
  // 2)" as In scope; nothing implemented or disclosed them until now. `security.cik` needs no
  // provider call — these are plain SEC EDGAR browse URLs built from a column already on hand.
  // The `padStart(10, '0')` here duplicates `adapters/sec-edgar.ts#padCik` rather than importing
  // it: that module pulls in `./wrapper`/`./fixtures` (COLLECT's provider-call machinery) for one
  // line of arithmetic this page's read path has no other reason to depend on.
  const cik = fullSecurity?.cik ?? null;
  const paddedCik = cik === null ? null : cik.padStart(10, '0');
  const filingsHref = paddedCik === null ? null : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=&dateb=&owner=include&count=40`;
  const insiderTransactionsHref = paddedCik === null ? null : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=4&dateb=&owner=include&count=40`;

  const header: TickerHeader = {
    securityId: security.id,
    symbol: security.symbol,
    name: fullSecurity?.name ?? security.name,
    exchange: fullSecurity?.exchange ?? security.exchange,
    assetType: fullSecurity?.assetType ?? security.assetType,
    sector: fullSecurity?.sector ?? null,
    price: latestMkt?.price ?? null,
    changePercent: latestMkt?.changePercent ?? null,
    session: latestMkt?.session ?? null,
    provider: latestMkt?.provider ?? null,
    observedAt: latestMkt?.observedAt ?? null,
    filingsHref,
    insiderTransactionsHref,
  };

  const methodology: MethodologyEntry[] = [];

  // ── Attention axis (§4.2) ──────────────────────────────────────────────────────────────────
  const attention = await buildAttentionAxis({
    history: attentionHistory,
    security,
    asOf,
    configVersion,
    db,
  });
  if (attention.mentionDelta !== null) {
    methodology.push(methodologyEntryFor({ axis: 'attention', methodId: 'attention.mention_delta', source: 'reddit (attention board)', window: 'since previous observation', calculationId: attention.mentionDelta.calculationId }));
  }
  if (attention.rankChange !== null) {
    methodology.push(methodologyEntryFor({ axis: 'attention', methodId: 'attention.rank_change', source: 'reddit (attention board)', window: '24 h', calculationId: attention.rankChange.calculationId }));
  }

  // ── Sampled stance — three frames (§4.2, D-14) ────────────────────────────────────────────────
  const socialItems = evidenceResult.items.filter((item) => item.evidenceType === 'social_result');
  const stance: StanceFrame[] = [];
  const stanceArtifacts = new Map<'reddit' | 'x' | 'substack', CalculationArtifact>();
  for (const axis of ['reddit', 'x', 'substack'] as const) {
    const providers = SOCIAL_AXIS_PROVIDERS[axis];
    const forAxis = socialItems.filter((item) => providers.includes(item.provider.toLowerCase()));
    const classified = forAxis.filter(isClassified);
    const inputs = stanceInputsFromEvidence(forAxis, asOf);

    let metric: AxisMetric | null = null;
    let sampleAdequacy: string | null = null;
    if (configVersion !== null) {
      const artifact = await computeAndPersist({
        methodId: `social.stance_${axis}`,
        inputs,
        subjectId: security.id,
        subjectLabel,
        asOf,
        configVersion,
      });
      stanceArtifacts.set(axis, artifact);
      metric = projectAxisMetric(artifact, `Stance of sampled snippets (${SOCIAL_AXIS_LABEL[axis]})`, axis, 'evidence retrieved this render', classified.length);
      sampleAdequacy = artifact.steps.find((step) => step.key === 'sample_adequacy')?.displayValue ?? null;
      methodology.push(methodologyEntryFor({ axis: `stance_${axis}`, methodId: `social.stance_${axis}`, source: SOCIAL_AXIS_LABEL[axis], window: 'evidence retrieved this render', calculationId: artifact.calculationId }));
    }

    stance.push({
      axis,
      label: SOCIAL_AXIS_LABEL[axis],
      metric,
      sampleAdequacy,
      retrievedCount: forAxis.length,
      usedCount: classified.length,
      window: 'evidence retrieved this render',
      disclosure: SOCIAL_AXIS_DISCLOSURE[axis],
      // Round-1 lane-review finding 8: this field's own contract doc says "the registry's
      // limitations[] for this frame's method, reproduced (not paraphrased)" — it was actually
      // populated from the computed artifact's `warnings[]`, a different list entirely (runtime
      // observations about this specific computation, not the method's standing, registered
      // limitations). Wired to match what the contract documents.
      selectionBiasNotes: metric === null ? [] : [...METHOD_REGISTRY.latest(`social.stance_${axis}`).limitations],
    });
  }

  // ── News axis ──────────────────────────────────────────────────────────────────────────────
  const newsItems = evidenceResult.items.filter((item) => item.evidenceType === 'news');
  const newsClassified = newsItems.filter(isClassified);
  let newsMetric: AxisMetric | null = null;
  if (configVersion !== null) {
    const artifact = await computeAndPersist({
      methodId: 'news.sentiment',
      inputs: newsInputsFromEvidence(newsItems, asOf),
      subjectId: security.id,
      subjectLabel,
      asOf,
      configVersion,
    });
    newsMetric = projectAxisMetric(artifact, 'News sentiment (entity-tagged)', 'news', 'articles retrieved this render', newsClassified.length);
    methodology.push(methodologyEntryFor({ axis: 'news', methodId: 'news.sentiment', source: 'news providers', window: 'articles retrieved this render', calculationId: artifact.calculationId }));
  }
  const news: NewsAxis = { metric: newsMetric, articleCount: newsClassified.length, window: 'articles retrieved this render' };

  // ── Price axis ─────────────────────────────────────────────────────────────────────────────
  const priceAxisResult = await buildPriceAxis({ history: marketHistory, return7, return30, security, asOf, configVersion });
  for (const entry of priceAxisResult.methodologyEntries) methodology.push(entry);

  // ── Divergence (F06 §4.6, product invariant §6.4) ────────────────────────────────────────────
  const divergence = await buildDivergence({
    mentionDelta: attention.mentionDelta,
    redditStance: stanceArtifacts.get('reddit') ?? null,
    return7,
    security,
    asOf,
    configVersion,
  });
  if (divergence.available) {
    // Round-4 lane-review finding 2: was 'attention, stance and price axes' — the social leg is
    // Reddit's sampled stance alone (see `socialAxisDisclosure` on the panel), not all three D-14
    // frames, so naming "stance" unqualified here overstated coverage the same way the panel did.
    methodology.push(methodologyEntryFor({ axis: 'divergence', methodId: 'market.divergence_state', source: 'attention, Reddit stance and price axes', window: 'this render', calculationId: divergence.calculationId }));
  }

  // ── Evidence drawer (§4.3) ────────────────────────────────────────────────────────────────────
  const evidence = buildEvidenceDrawer(
    evidenceResult.items,
    evidenceResult.scannedCount,
    evidenceResult.truncated,
    evidenceResult.distinctCount,
  );

  return {
    resolved: true,
    header,
    attention: attention.axis,
    stance,
    news,
    price: priceAxisResult.axis,
    divergence,
    evidence,
    methodology,
    asOf,
  };
}

// ── Attention ──────────────────────────────────────────────────────────────────────────────────

async function buildAttentionAxis(args: {
  readonly history: readonly AttentionSnapshot[];
  readonly security: { readonly id: string; readonly symbol: string };
  readonly asOf: Date;
  readonly configVersion: string | null;
  readonly db?: Queryable | undefined;
}): Promise<{ readonly axis: AttentionAxis; readonly mentionDelta: AxisMetric | null; readonly rankChange: AxisMetric | null }> {
  const { history } = args;

  const points = history.map((row) => ({ at: row.observedAt, observedAt: row.observedAt, mentions: row.mentions, rank: row.rank }));
  // Round-2 lane-review finding 3, the same class of mismatch round-1 finding 7 named for
  // `attention_snapshot.source`. `coverage_gap`/`collector_start`'s `axis` check constraint
  // (migration 0010, SPINE-owned) only admits 'reddit' | 'x' | 'substack' | 'market' — there is
  // no 'apewisdom' value to ask for, even though this chart's rows are ApeWisdom's Reddit-
  // mentions board, not F04's Reddit *comment* collector. So this reads (and, on a real gap,
  // renders) a different collector's coverage floor and gaps — a Reddit-comment-collector outage
  // fabricates gaps on this ApeWisdom-sourced chart, and an ApeWisdom-only outage produces no gap
  // here at all, which is the interpolation-across-a-hole D-16/F22 §4.4 exist to prevent.
  // `calc/coverage.ts`'s own disclosure string is reproduced verbatim below (the same discipline
  // D-14/§6.4 apply elsewhere), so its literal "for reddit" wording cannot be corrected from
  // here without paraphrasing a SPINE-owned disclosure — recorded as a cross-lane CONTRACTS gap
  // (an 'apewisdom' axis value needs a migration) rather than silently left unstated.
  const segmentation = await segmentSeriesForAxis('reddit', points, args.db);
  // `ChartSegmentation.segments` is `readonly (readonly T[])[]` (F22's arithmetic is read-only
  // by discipline); the zod-inferred `AttentionAxis.chartSegments` is a plain mutable `T[][]`.
  // Copying here is the boundary between the two, not a mutation anywhere downstream.
  const chartSegments = segmentation.segments.map((segment) => [...segment]);

  if (history.length === 0) {
    return {
      axis: {
        mentions: null,
        rank: null,
        observedAt: null,
        mentionDelta: null,
        rankChange: null,
        chartSegments,
        coverageDisclosure: segmentation.disclosure,
        gapCount: segmentation.gapCount,
      },
      mentionDelta: null,
      rankChange: null,
    };
  }

  const latest = history[0] as AttentionSnapshot;
  const priorRow = history[1] ?? null;
  const inputs = attentionInputs(latest, priorRow);

  let mentionDelta: AxisMetric | null = null;
  let rankChange: AxisMetric | null = null;
  if (args.configVersion !== null) {
    // Round-4 lane-review finding 1: `attention.mention_delta` (SPINE-owned, `calc/`) has no
    // abstention branch — it is pure arithmetic, "always computable" by design (§4.1's
    // mention_growth/mention_delta split depends on that). `attentionInputs` substitutes `0` for
    // a `null` `mentionsPrior` so the arithmetic never throws, but `mentionsPrior` is nullable
    // for a real reason distinct from the rank fields' `ABSENT_FROM_BOARD` sentinel: it means
    // "not recorded by the provider", never "zero". Feeding that substituted `0` into the method
    // would persist a confident, `eligibility: 'ok'` artifact whose Inspector attributes a
    // fabricated `mentions_prior = 0` to ApeWisdom. This lane cannot add an abstention path to a
    // SPINE-owned method, so the gate has to live here: skip the computation entirely when the
    // real prior is unknown, the same "not yet computed" shape every other gated axis already
    // uses for a missing prerequisite.
    if (latest.mentionsPrior !== null) {
      const deltaArtifact = await computeAndPersist({
        methodId: 'attention.mention_delta',
        inputs,
        subjectId: args.security.id,
        subjectLabel: args.security.symbol,
        asOf: args.asOf,
        configVersion: args.configVersion,
      });
      mentionDelta = projectAxisMetric(deltaArtifact, 'Mentions, change since previous observation', latest.source, 'since previous observation', 1);
    }

    const rankArtifact = await computeAndPersist({
      methodId: 'attention.rank_change',
      inputs,
      subjectId: args.security.id,
      subjectLabel: args.security.symbol,
      asOf: args.asOf,
      configVersion: args.configVersion,
    });
    rankChange = projectAxisMetric(rankArtifact, 'Rank, change since previous observation (24 h)', latest.source, '24 h', 1);
  }

  return {
    axis: {
      mentions: latest.mentions,
      rank: latest.rank,
      observedAt: latest.observedAt,
      mentionDelta,
      rankChange,
      chartSegments,
      coverageDisclosure: segmentation.disclosure,
      gapCount: segmentation.gapCount,
    },
    mentionDelta,
    rankChange,
  };
}

// ── Price / technical ─────────────────────────────────────────────────────────────────────────

const HORIZON_DISCLOSURE =
  "This page's price axis was specified against 5-trading-day/20-trading-day returns. " +
  "`price_return_snapshot`'s check constraint only stores 7/30/90/180 *calendar*-day horizons " +
  '(migration 0002) — a 7-calendar-day return is not the same measurement as a 5-trading-day one, ' +
  'so the horizons below are labelled by what is actually stored, not relabelled to match the ' +
  'originally-specified windows. See this feature’s CONTRACTS report.';

type PriceReturnSummary = Pick<
  PriceReturnSnapshot,
  'horizonCalendarDays' | 'totalReturn' | 'asOfDate' | 'baselinePriceDate' | 'qualityStatus'
>;

async function buildPriceAxis(args: {
  readonly history: readonly MarketSnapshot[];
  readonly return7: PriceReturnSummary | null;
  readonly return30: PriceReturnSummary | null;
  readonly security: { readonly id: string; readonly symbol: string };
  readonly asOf: Date;
  readonly configVersion: string | null;
}): Promise<{ readonly axis: PriceAxis; readonly methodologyEntries: readonly MethodologyEntry[] }> {
  const returns = [args.return7, args.return30]
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({ horizonCalendarDays: r.horizonCalendarDays, totalReturn: r.totalReturn, asOfDate: r.asOfDate, baselinePriceDate: r.baselinePriceDate, qualityStatus: r.qualityStatus }));

  const methodologyEntries: MethodologyEntry[] = [];

  async function computeOne(methodId: string, window: number, label: string): Promise<AxisMetric | null> {
    if (args.configVersion === null) return null;
    const inputs = priceSeriesInputs(args.history, window);
    const artifact = await computeAndPersist({
      methodId,
      inputs,
      subjectId: args.security.id,
      subjectLabel: args.security.symbol,
      asOf: args.asOf,
      configVersion: args.configVersion,
    });
    methodologyEntries.push(methodologyEntryFor({ axis: 'price', methodId, source: 'market', window: `${String(window)} sessions`, calculationId: artifact.calculationId }));
    // Round-3 lane-review finding 2: `n` must be the observations the method actually used —
    // `priceSeriesInputs` slices to `Math.min(history.length, window)` bars (never more than
    // `window`, however many were fetched) — not `args.history.length`, the page size the query
    // was called with (60), which made every technical's `n` contradict its own window label.
    return projectAxisMetric(artifact, label, 'market', `${String(window)} sessions`, Math.min(args.history.length, window));
  }

  const [regime, volatility20, rsi14, movingAverage20, movingAverage50] = await Promise.all([
    computeOne('price.regime', 21, 'Price regime (trend strength)'),
    computeOne('price.volatility_20', 21, '20-session annualised volatility'),
    computeOne('technical.rsi_14', 15, 'Relative strength index (14-session)'),
    computeOne('technical.moving_average_20', 20, '20-session moving average'),
    computeOne('technical.moving_average_50', 50, '50-session moving average'),
  ]);

  return {
    axis: { returns, horizonDisclosure: HORIZON_DISCLOSURE, volatility20, regime, rsi14, movingAverage20, movingAverage50 },
    methodologyEntries,
  };
}

// ── Divergence ─────────────────────────────────────────────────────────────────────────────────

async function buildDivergence(args: {
  readonly mentionDelta: AxisMetric | null;
  readonly redditStance: CalculationArtifact | null;
  readonly return7: { readonly totalReturn: string | null; readonly asOfDate: string } | null;
  readonly security: { readonly id: string; readonly symbol: string };
  readonly asOf: Date;
  readonly configVersion: string | null;
}): Promise<DivergencePanel> {
  const { configVersion, mentionDelta, redditStance, return7 } = args;

  if (configVersion === null) {
    return { available: false, reason: 'No active config_version row — an artifact cannot be recorded without one to freeze (02-ARCHITECTURE-CONTRACTS.md §6).' };
  }
  if (mentionDelta === null || mentionDelta.eligibility !== 'ok' || mentionDelta.display === null) {
    return { available: false, reason: 'The attention direction is not yet determinable (mention_delta did not resolve to a value).' };
  }
  if (redditStance === null || redditStance.eligibility !== 'ok' || redditStance.result === null) {
    return { available: false, reason: 'The sampled-stance direction is not yet determinable (Reddit stance did not resolve to a value).' };
  }
  if (return7 === null || return7.totalReturn === null) {
    return { available: false, reason: 'The price direction is not yet determinable (no 7-day return on record).' };
  }

  // `mentionDelta`'s own display/exact form is unavailable on the projected `AxisMetric`
  // (`display` is the rounded string, not `exact` — deliberately: the divergence classification
  // only needs a sign, and `display` already carries enough precision for that after rounding to
  // an integer mention count).
  const attentionDirection = signOfDecimal(mentionDelta.display);
  const socialDirection = signOfDecimal(redditStance.result.exact);
  const priceDirection = signOfDecimal(return7.totalReturn);

  // Round-4 lane-review finding 3: these three synthesized inputs used to carry
  // `provenance.observedAt: null` unconditionally, which made the artifact structurally
  // incapable of ever being marked `stale` — `computeArtifact` (SPINE-owned,
  // `services/calculations.ts`) derives staleness from the freshest non-null
  // `provenance.observedAt` among an artifact's inputs, and a set of all-`null` inputs makes
  // `freshest === undefined`, always false, regardless of the registered `stalenessMinutes`. The
  // real recency of each leg is already in hand at this call site — threading it through lets
  // that existing, working staleness mechanism do its job instead of being silently defeated.
  const attentionObservedAt = mentionDelta.observedAt;
  const socialObservedAt = freshestObservedAt(redditStance);
  const priceObservedAt = new Date(return7.asOfDate);

  const artifact = await computeAndPersist({
    methodId: 'market.divergence_state',
    inputs: [
      { key: 'attention_direction', value: attentionDirection, unit: null, dataType: 'decimal', source: 'internal', quality: 'ok', freshness: 'fresh', provenance: { provider: 'internal', providerField: 'derived:sign(attention.mention_delta)', sourceUrl: null, observedAt: attentionObservedAt?.toISOString() ?? null, availableAt: null, ingestedAt: new Date().toISOString(), rawPayloadId: null, licenseClass: 'provider_terms', redactionClass: 'public' } },
      { key: 'social_direction', value: socialDirection, unit: null, dataType: 'decimal', source: 'internal', quality: 'ok', freshness: 'fresh', provenance: { provider: 'internal', providerField: 'derived:sign(social.stance_reddit)', sourceUrl: null, observedAt: socialObservedAt?.toISOString() ?? null, availableAt: null, ingestedAt: new Date().toISOString(), rawPayloadId: null, licenseClass: 'provider_terms', redactionClass: 'public' } },
      { key: 'price_direction', value: priceDirection, unit: null, dataType: 'decimal', source: 'internal', quality: 'ok', freshness: 'fresh', provenance: { provider: 'internal', providerField: 'derived:sign(price_return_snapshot.total_return@7d)', sourceUrl: null, observedAt: priceObservedAt.toISOString(), availableAt: null, ingestedAt: new Date().toISOString(), rawPayloadId: null, licenseClass: 'provider_terms', redactionClass: 'public' } },
    ],
    subjectId: args.security.id,
    subjectLabel: args.security.symbol,
    asOf: args.asOf,
    configVersion,
  });

  // Round-3 lane-review finding 4: this used to recover the state by string-prefix-matching a
  // free-text step note (`'state: ' + …`), falling back to a fabricated `no_clear_pattern` on
  // any parse miss — a confident, specific claim about a computation that was never actually
  // read. `calc/divergence.ts#DIVERGENCE_STATE_BY_CODE` is the artifact's own, typed mapping from
  // `result.exact` (the method's real output) back to a state; reading it directly means a
  // format change or an abstained artifact fails loudly here instead of rendering a plausible
  // wrong answer.
  const code = artifact.result?.exact;
  const state = code !== undefined ? DIVERGENCE_STATE_BY_CODE[code] : undefined;
  if (state === undefined) {
    throw new Error(
      `market.divergence_state artifact (${artifact.calculationId}) did not produce a recognized result code — refusing to render a fabricated divergence state.`,
    );
  }

  // Sourced from the artifact's own `warnings[]`, never hardcoded in this module or the view —
  // F06's `computeDivergenceState` attaches this line unconditionally (F-17). A missing line
  // would be a defect in that method, not something to paper over here with a literal fallback.
  const disclosure = artifact.warnings.find((warning) => warning === DIVERGENCE_DISCLOSURE_LINE);
  if (disclosure === undefined) {
    throw new Error(
      'market.divergence_state artifact did not carry the F-17 disclosure line in its warnings[] — refusing to render a divergence state with no disclosure rather than substituting one.',
    );
  }

  return {
    available: true,
    metricId: 'market.divergence_state',
    calculationId: artifact.calculationId,
    state,
    interpretation: DIVERGENCE_STATE_INTERPRETATION[state],
    disclosure,
    // Round-4 lane-review finding 2: makes explicit what `providerField:
    // 'derived:sign(social.stance_reddit)'` above only records internally — the "stance" leg
    // behind this state is Reddit's sampled frame alone, never a blend of D-14's three platforms.
    socialAxisDisclosure:
      "The stance input to this state is Reddit's sampled frame alone — X and Substack are not included, D-14's three frames are never blended into one reading.",
    // Round-4 lane-review finding 3: now that the three synthesized inputs above carry real
    // `observedAt` values, `artifact.eligibility === 'stale'` genuinely reflects whether any leg
    // is older than `market.divergence_state`'s registered `stalenessMinutes` — surfaced the same
    // way every other metric on this page discloses staleness (`FreshnessBadge`).
    observedAt: freshestObservedAt(artifact),
    stale: artifact.eligibility === 'stale',
  };
}

// ── Evidence drawer ────────────────────────────────────────────────────────────────────────────

function unreachableNoteFor(item: EvidenceItemWithDedupeKey): string | null {
  if (item.availability === 'available') return null;
  const asOfDate = item.ingestedAt.toISOString().slice(0, 10);
  const stateWord = item.availability === 'unreachable' ? 'source no longer reachable' : item.availability;
  return `${stateWord} — snippet as retrieved on ${asOfDate}`;
}

function buildEvidenceDrawer(
  items: readonly EvidenceItemWithDedupeKey[],
  scannedCount: number,
  truncated: boolean,
  distinctCount: number,
): EvidenceDrawer {
  const views: EvidenceItemView[] = items.map((item) => ({
    id: item.id,
    dedupeKey: item.dedupeKey,
    sourceKind: item.evidenceType,
    provider: item.provider,
    publisher: item.publisher,
    title: item.title,
    url: item.sourceUrl,
    publishedAt: item.publishedAt,
    retrievedAt: item.ingestedAt,
    snippet: item.snippet,
    relevance: item.relevanceScore,
    availability: item.availability,
    lastCheckedAt: item.lastCheckedAt,
    unreachableNote: unreachableNoteFor(item),
  }));

  return {
    items: views,
    retrievedCount: scannedCount,
    usedCount: items.length,
    truncated,
    // Round-2 lane-review finding 2: `distinctCount` was already in hand at this call site and
    // discarded — the far more common truncation (more distinct evidence than fits the 200-item
    // page) had no disclosure anywhere, even though `truncated` above (the 5,000-row scan limit)
    // almost never fires in comparison.
    pageTruncated: distinctCount > items.length,
  };
}
