/**
 * Generates F12's frozen corpus (§4.1: ≥30 packs) and seeded-error corpus (§4.2: ≥40 answers) as
 * committed JSON fixtures under `fixtures/eval-corpus/`.
 *
 * **Not run in CI, not imported from any production or test path.** F12 §4.1: "Packs are frozen
 * artifacts, not live retrievals. A pack is regenerated only by a deliberate, reviewed PR that
 * also re-labels it." This script is that regeneration mechanism, run by hand
 * (`pnpm exec tsx scripts/eval/generate-corpus.ts`) and its OUTPUT committed — never invoked from
 * `services/eval/` or from `tests/eval/`.
 *
 * **Provenance (D-35's pattern, disclosed rather than denied):** every pack's `labelSource` is
 * `'llm_assisted_pending_human_audit'`. The labels below were drafted by this script's author (an
 * LLM-driven build agent) from the fixture evidence it also generated, not derived from real
 * human judgement of real evidence — see `docs/eval-corpus/LABELLING.md` for the full disclosure,
 * required reading before trusting any number this corpus produces.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildAxisDisclosures,
  llmMethod,
  type AxisCounts,
  type AxisDisclosure,
  type EvidencePack,
  type ExcludedItem,
  type ExclusionReason,
  type IncludedItem,
} from '../../src/services/evidence';
import type { EvidenceItem } from '../../src/contracts/evidence';
import type { SocialAxis } from '../../src/contracts/primitives';
import type { SynthesisClaim, SynthesisOutput } from '../../src/services/research/schema';
import type { EvalFaultClass } from '../../src/contracts/eval';
import type { EvalCorpusPackMeta, EvalMetricFact, PerItemLabel } from '../../src/services/eval/schema';

const OUT_ROOT = join(process.cwd(), 'fixtures', 'eval-corpus');
const LLM_FIXTURES_ROOT = join(process.cwd(), 'fixtures', 'llm');

// ── Securities to cycle through ──────────────────────────────────────────────────────────────

const SECURITIES: readonly { symbol: string; name: string }[] = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'TSLA', name: 'Tesla, Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation' },
  { symbol: 'PFE', name: 'Pfizer Inc.' },
  { symbol: 'KO', name: 'The Coca-Cola Company' },
  { symbol: 'DIS', name: 'The Walt Disney Company' },
  { symbol: 'CAT', name: 'Caterpillar Inc.' },
  { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.' },
  { symbol: 'NFLX', name: 'Netflix, Inc.' },
];

const WINDOW_FROM = '2026-08-01T00:00:00.000Z';
const WINDOW_TO = '2026-08-31T00:00:00.000Z';
const AS_OF = '2026-08-31T12:00:00.000Z';

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function atDay(day: number, hour = 12): string {
  const d = new Date(Date.UTC(2026, 7, day, hour, 0, 0));
  return d.toISOString();
}

// ── Evidence item builders ───────────────────────────────────────────────────────────────────

let itemSeq = 0;

function makeEvidenceItem(opts: {
  readonly axis: 'x' | 'substack' | null;
  readonly title: string;
  readonly snippet: string | null;
  readonly availableAt: string;
}): EvidenceItem {
  itemSeq += 1;
  const provider = opts.axis ?? 'newswire';
  return {
    id: randomUUID(),
    securityId: null,
    evidenceType: opts.axis === null ? 'news' : 'social_result',
    provider,
    title: opts.title,
    snippet: opts.snippet,
    sourceUrl: `https://example.com/evidence/${String(itemSeq)}`,
    publisher: opts.axis === null ? 'Example Wire' : null,
    authorRef: opts.axis === null ? null : `user_${String(itemSeq)}`,
    stanceLabel: null,
    stanceScore: null,
    relevanceScore: null,
    publishedAt: new Date(opts.availableAt),
    availableAt: new Date(opts.availableAt),
    ingestedAt: new Date(opts.availableAt),
    lastCheckedAt: null,
    availability: 'available',
    licenseClass: opts.axis === null ? 'licensed_snippet' : 'own_collected',
    coverageClass: 'standard',
    rawHash: randomUUID(),
    metadata: {},
  };
}

function included(
  item: EvidenceItem,
  axis: SocialAxis | null,
  relevanceScore: string,
  matchedVia: IncludedItem['matchedVia'],
  collision = false,
): IncludedItem {
  const methods = collision
    ? [
        { methodId: llmMethod('entity_collision').id, methodVersion: llmMethod('entity_collision').version },
        { methodId: llmMethod('relevance').id, methodVersion: llmMethod('relevance').version },
      ]
    : [{ methodId: llmMethod('relevance').id, methodVersion: llmMethod('relevance').version }];
  return { kind: 'included', item, axis, relevanceScore, matchedVia, methods, stableId: item.id };
}

function excluded(item: EvidenceItem, axis: SocialAxis | null, reason: ExclusionReason, detail: string): ExcludedItem {
  return { kind: 'excluded', item, axis, reason, detail };
}

function buildDisclosures(
  items: readonly IncludedItem[],
  excludedItems: readonly ExcludedItem[],
): readonly [AxisDisclosure, AxisDisclosure, AxisDisclosure] {
  const counts: Record<SocialAxis, AxisCounts> = {
    reddit: { retrieved: 0, used: 0, exclusions: [] },
    x: { retrieved: 0, used: 0, exclusions: [] },
    substack: { retrieved: 0, used: 0, exclusions: [] },
  };
  for (const item of items) {
    if (item.axis !== null) {
      counts[item.axis] = { ...counts[item.axis], retrieved: counts[item.axis].retrieved + 1, used: counts[item.axis].used + 1 };
    }
  }
  for (const item of excludedItems) {
    if (item.axis === null) continue;
    const existingIndex = counts[item.axis].exclusions.findIndex((e) => e.reason === item.reason);
    const bucket =
      existingIndex === -1
        ? [...counts[item.axis].exclusions, { reason: item.reason, count: 1 }]
        : counts[item.axis].exclusions.map((e, i) => (i === existingIndex ? { ...e, count: e.count + 1 } : e));
    counts[item.axis] = { ...counts[item.axis], retrieved: counts[item.axis].retrieved + 1, exclusions: bucket };
  }
  return buildAxisDisclosures({
    counts,
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    reddit: { subredditsPolled: [], treeComplete: null },
    x: { watchlistVersion: 'v1', triggerEvent: null },
  });
}

function buildPack(securityId: string, items: readonly IncludedItem[], excludedItems: readonly ExcludedItem[]): EvidencePack {
  return {
    securityId,
    asOf: AS_OF,
    retrievalWindow: { from: WINDOW_FROM, to: WINDOW_TO },
    retrievalQuery: `security=${securityId} window=${WINDOW_FROM}..${WINDOW_TO} asOf=${AS_OF}`,
    items,
    excluded: excludedItems,
    retrievedCount: items.length + excludedItems.length,
    usedCount: items.length,
    truncatedByScanWindow: false,
    disclosures: buildDisclosures(items, excludedItems),
  };
}

// ── Metrics ───────────────────────────────────────────────────────────────────────────────────

function attentionMetric(display: string, observedAtIso: string): EvalMetricFact {
  return {
    metricId: 'attention.mention_growth',
    calculationId: `calc_${randomUUID()}`,
    label: 'Mention growth',
    display,
    unit: '%',
    n: null,
    window: '7d',
    observedAt: observedAtIso,
  };
}

function stanceMetric(axis: 'x' | 'substack', display: string, n: number, observedAtIso: string): EvalMetricFact {
  return {
    metricId: `social.stance_${axis}`,
    calculationId: `calc_${randomUUID()}`,
    label: `${axis === 'x' ? 'X' : 'Substack'} stance (shrunk)`,
    display,
    unit: '',
    n,
    window: '7d',
    observedAt: observedAtIso,
  };
}

function trueOldest(items: readonly IncludedItem[], metrics: readonly EvalMetricFact[]): string {
  const times: number[] = [...items.map((i) => i.item.availableAt.getTime())];
  for (const m of metrics) if (m.observedAt !== null) times.push(new Date(m.observedAt).getTime());
  return dayOf(new Date(Math.min(...times)).toISOString());
}

// ── Claim / gold-output builders ─────────────────────────────────────────────────────────────

let claimSeq = 0;
function claim(input: {
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly metricIds: readonly string[];
  readonly subject: string;
}): SynthesisClaim {
  claimSeq += 1;
  return {
    claimId: `claim-${String(claimSeq)}`,
    text: input.text,
    kind: 'fact',
    evidenceIds: [...input.evidenceIds],
    metricIds: [...input.metricIds],
    relatedTickers: [input.subject],
    assertedDate: null,
  };
}

function goldOutput(summary: string, claims: readonly SynthesisClaim[], statedFreshnessDay: string): SynthesisOutput {
  return {
    summary,
    statedFreshness: statedFreshnessDay,
    themes: [{ title: 'Observed evidence', claims: [...claims], singleSource: claims.length < 2 }],
    bullishCase: [],
    bearishCase: [],
    whatChanged: [],
    whatToMonitor: [],
  };
}

// ── Per-item labels ───────────────────────────────────────────────────────────────────────────

function labelOf(item: IncludedItem, stance: PerItemLabel['stance']): PerItemLabel {
  return { itemId: item.stableId, stance, relevant: true };
}
function labelOfExcluded(item: ExcludedItem, stance: PerItemLabel['stance']): PerItemLabel {
  return { itemId: item.item.id, stance, relevant: false };
}

// ── One pack, per bucket shape ───────────────────────────────────────────────────────────────

type PackBuild = { readonly meta: EvalCorpusPackMeta; readonly pack: EvidencePack };

function buildClearStancePack(id: string, index: number, direction: 'bullish' | 'bearish' | 'neutral'): PackBuild {
  const security = SECURITIES[index % SECURITIES.length] as { symbol: string; name: string };
  const verb = direction === 'bullish' ? 'improving' : direction === 'bearish' ? 'deteriorating' : 'holding steady';
  const xItem = makeEvidenceItem({
    axis: 'x',
    title: `Watched-account post about ${security.symbol}`,
    snippet: `$${security.symbol} commentary describing conditions as ${verb} this week.`,
    availableAt: atDay(3 + (index % 5)),
  });
  const subItem = makeEvidenceItem({
    axis: 'substack',
    title: `Sector newsletter mentions ${security.name}`,
    snippet: `A curated publication notes ${security.name}'s recent activity as ${verb}.`,
    availableAt: atDay(5 + (index % 5)),
  });
  const items = [included(xItem, 'x', '0.910000', 'cashtag'), included(subItem, 'substack', '0.870000', 'company_name')];
  const metrics = [attentionMetric('12.50', atDay(6 + (index % 5))), stanceMetric('x', '0.400000', 8, atDay(3 + (index % 5)))];
  const c1 = claim({
    text: `Watched-account commentary about ${security.name} this window reads as ${verb}, drawn from the tracked X sample.`,
    evidenceIds: [xItem.id],
    metricIds: ['social.stance_x'],
    subject: security.symbol,
  });
  const c2 = claim({
    text: `A sector newsletter's coverage of ${security.name} is consistent with the same ${verb} read.`,
    evidenceIds: [subItem.id],
    metricIds: [],
    subject: security.symbol,
  });
  const pack = buildPack(randomUUID(), items, []);
  const freshness = trueOldest(items, metrics);
  return {
    pack,
    meta: {
      id,
      bucket: 'clear_stance',
      labelSource: 'llm_assisted_pending_human_audit',
      subjectSymbol: security.symbol,
      metrics,
      labels: {
        perItem: [labelOf(items[0] as IncludedItem, direction), labelOf(items[1] as IncludedItem, direction)],
        expectedDirection: direction,
        expectedAbstain: false,
        requiredAbstentions: ['No price target or buy/sell recommendation language.'],
      },
      goldOutput: goldOutput(
        `${security.name} shows a ${verb} read across the tracked social sample this window.`,
        [c1, c2],
        freshness,
      ),
    },
  };
}

function buildSarcasmPack(id: string, index: number): PackBuild {
  const security = SECURITIES[index % SECURITIES.length] as { symbol: string; name: string };
  const xItem = makeEvidenceItem({
    axis: 'x',
    title: `Ambiguous post about ${security.symbol}`,
    snippet: `"Oh great, another ${security.symbol} conference call, exactly what I needed" — tone reads as sarcastic, no clear direction.`,
    availableAt: atDay(4 + (index % 5)),
  });
  const subItem = makeEvidenceItem({
    axis: 'substack',
    title: `Mixed-tone mention of ${security.name}`,
    snippet: `A short aside about ${security.name} that could read either way depending on delivery.`,
    availableAt: atDay(7 + (index % 5)),
  });
  const items = [included(xItem, 'x', '0.700000', 'cashtag'), included(subItem, 'substack', '0.650000', 'company_name')];
  const metrics = [attentionMetric('4.00', atDay(6 + (index % 5)))];
  const c1 = claim({
    text: `The tracked X sample for ${security.name} this window is ambiguous in tone — no confident direction is drawn from it.`,
    evidenceIds: [xItem.id],
    metricIds: [],
    subject: security.symbol,
  });
  const pack = buildPack(randomUUID(), items, []);
  const freshness = trueOldest(items, metrics);
  return {
    pack,
    meta: {
      id,
      bucket: 'sarcasm_ambiguity',
      labelSource: 'llm_assisted_pending_human_audit',
      subjectSymbol: security.symbol,
      metrics,
      labels: {
        perItem: [labelOf(items[0] as IncludedItem, 'unclear'), labelOf(items[1] as IncludedItem, 'unclear')],
        expectedDirection: 'unclear',
        expectedAbstain: false,
        requiredAbstentions: ['No stance direction asserted from tone that reads as sarcastic or ambiguous.'],
      },
      goldOutput: goldOutput(
        `The tone of this window's social mentions of ${security.name} is ambiguous; no directional read is drawn from it.`,
        [c1],
        freshness,
      ),
    },
  };
}

function buildCollisionPack(id: string, index: number): PackBuild {
  const security = SECURITIES[index % SECURITIES.length] as { symbol: string; name: string };
  const confirmedItem = makeEvidenceItem({
    axis: 'x',
    title: `Confirmed post about ${security.symbol}`,
    snippet: `$${security.symbol} discussed alongside ${security.name}'s own name, unambiguous.`,
    availableAt: atDay(4 + (index % 5)),
  });
  const collidedItem = makeEvidenceItem({
    axis: 'x',
    title: `Bare-token post using the same letters as ${security.symbol}`,
    snippet: `A post using the bare token '${security.symbol}' in a sentence about something else entirely, with no corroborating context.`,
    availableAt: atDay(6 + (index % 5)),
  });
  const includedItems = [included(confirmedItem, 'x', '0.880000', 'cashtag')];
  const excludedItems = [
    excluded(collidedItem, 'x', 'ticker_collision_unconfirmed', `bare token '${security.symbol}' with no deterministic corroboration; entity.collision_guard did not confirm it`),
  ];
  const metrics = [attentionMetric('6.00', atDay(5 + (index % 5))), stanceMetric('x', '0.300000', 6, atDay(4 + (index % 5)))];
  const c1 = claim({
    text: `The confirmed mentions of ${security.name} this window are limited to the unambiguous cashtag usage; a same-letters bare-token post was excluded as unconfirmed.`,
    evidenceIds: [confirmedItem.id],
    metricIds: [],
    subject: security.symbol,
  });
  const pack = buildPack(randomUUID(), includedItems, excludedItems);
  const freshness = trueOldest(includedItems, metrics);
  return {
    pack,
    meta: {
      id,
      bucket: 'ticker_collision',
      labelSource: 'llm_assisted_pending_human_audit',
      subjectSymbol: security.symbol,
      metrics,
      labels: {
        perItem: [labelOf(includedItems[0] as IncludedItem, 'neutral'), labelOfExcluded(excludedItems[0] as ExcludedItem, 'neutral')],
        expectedDirection: 'neutral',
        expectedAbstain: false,
        requiredAbstentions: ['No stance drawn from the unconfirmed collided-ticker item; it must stay excluded.'],
      },
      goldOutput: goldOutput(
        `This window's confirmed evidence for ${security.name} excludes one bare-token, unconfirmed collision.`,
        [c1],
        freshness,
      ),
    },
  };
}

function buildConflictingPack(id: string, index: number): PackBuild {
  const security = SECURITIES[index % SECURITIES.length] as { symbol: string; name: string };
  const bullItem = makeEvidenceItem({
    axis: 'x',
    title: `Positive-leaning post about ${security.symbol}`,
    snippet: `$${security.symbol} commentary describing conditions as improving.`,
    availableAt: atDay(3 + (index % 5)),
  });
  const bearItem = makeEvidenceItem({
    axis: 'substack',
    title: `Negative-leaning coverage of ${security.name}`,
    snippet: `A newsletter piece on ${security.name} describing conditions as deteriorating over the same window.`,
    availableAt: atDay(9 + (index % 5)),
  });
  const items = [included(bullItem, 'x', '0.800000', 'cashtag'), included(bearItem, 'substack', '0.780000', 'company_name')];
  const metrics = [stanceMetric('x', '0.150000', 7, atDay(3 + (index % 5))), stanceMetric('substack', '-0.120000', 5, atDay(9 + (index % 5)))];
  const c1 = claim({
    text: `The tracked X sample for ${security.name} this window reads more positively.`,
    evidenceIds: [bullItem.id],
    metricIds: ['social.stance_x'],
    subject: security.symbol,
  });
  const c2 = claim({
    text: `A Substack publication's coverage of ${security.name} over the same window reads more negatively — the two sources disagree.`,
    evidenceIds: [bearItem.id],
    metricIds: ['social.stance_substack'],
    subject: security.symbol,
  });
  const pack = buildPack(randomUUID(), items, []);
  const freshness = trueOldest(items, metrics);
  return {
    pack,
    meta: {
      id,
      bucket: 'conflicting_source',
      labelSource: 'llm_assisted_pending_human_audit',
      subjectSymbol: security.symbol,
      metrics,
      labels: {
        perItem: [labelOf(items[0] as IncludedItem, 'bullish'), labelOf(items[1] as IncludedItem, 'bearish')],
        expectedDirection: 'mixed',
        expectedAbstain: false,
        requiredAbstentions: ['No single confident direction — the two axes disagree and both are reported, unblended (D-14).'],
      },
      goldOutput: goldOutput(
        `${security.name}'s two tracked axes disagree this window: X reads more positively, Substack coverage reads more negatively.`,
        [c1, c2],
        freshness,
      ),
    },
  };
}

function buildThinPack(id: string, index: number): PackBuild {
  const security = SECURITIES[index % SECURITIES.length] as { symbol: string; name: string };
  const onlyItem = makeEvidenceItem({
    axis: 'x',
    title: `Single post about ${security.symbol}`,
    snippet: `One isolated mention of $${security.symbol} this window, not enough for a stance read.`,
    availableAt: atDay(10 + (index % 5)),
  });
  const items = [included(onlyItem, 'x', '0.750000', 'cashtag')];
  const metrics = [stanceMetric('x', '0.100000', 2, atDay(10 + (index % 5)))];
  const c1 = claim({
    text: `Only one tracked item mentions ${security.name} this window — too thin a sample for a stance read.`,
    evidenceIds: [onlyItem.id],
    metricIds: [],
    subject: security.symbol,
  });
  const pack = buildPack(randomUUID(), items, []);
  const freshness = trueOldest(items, metrics);
  return {
    pack,
    meta: {
      id,
      bucket: 'thin_evidence',
      labelSource: 'llm_assisted_pending_human_audit',
      subjectSymbol: security.symbol,
      metrics,
      labels: {
        perItem: [labelOf(items[0] as IncludedItem, 'neutral')],
        expectedDirection: 'neutral',
        expectedAbstain: true,
        requiredAbstentions: [`No stance score is asserted — sample size n=2 is below the n≥5 abstention floor (01-PRODUCT-SPEC.md §6.3).`],
      },
      goldOutput: goldOutput(
        `${security.name}'s tracked sample this window is too thin for a stance read; none is asserted.`,
        [c1],
        freshness,
      ),
    },
  };
}

// ── Assemble the 30-pack corpus ─────────────────────────────────────────────────────────────

const packs: PackBuild[] = [];
const DIRECTIONS: readonly ('bullish' | 'bearish' | 'neutral')[] = [
  'bullish', 'bearish', 'bullish', 'bearish', 'neutral', 'bullish', 'bearish', 'bullish', 'bearish', 'neutral',
];
for (let i = 0; i < 10; i += 1) {
  packs.push(buildClearStancePack(`clear-${String(i + 1).padStart(2, '0')}`, i, DIRECTIONS[i] as 'bullish' | 'bearish' | 'neutral'));
}
for (let i = 0; i < 5; i += 1) packs.push(buildSarcasmPack(`sarcasm-${String(i + 1).padStart(2, '0')}`, i));
for (let i = 0; i < 5; i += 1) packs.push(buildCollisionPack(`collision-${String(i + 1).padStart(2, '0')}`, i));
for (let i = 0; i < 5; i += 1) packs.push(buildConflictingPack(`conflict-${String(i + 1).padStart(2, '0')}`, i));
for (let i = 0; i < 5; i += 1) packs.push(buildThinPack(`thin-${String(i + 1).padStart(2, '0')}`, i));

const packById = new Map(packs.map((p) => [p.meta.id, p]));
const thinPacks = packs.filter((p) => p.meta.bucket === 'thin_evidence');

// ── Seeded-error corpus (F12 §4.2): nine fault classes × 5 instances = 45 answers ──────────────

type SeededBuild = {
  readonly meta: {
    readonly id: string;
    readonly packId: string;
    readonly faultClass: EvalFaultClass;
    readonly faultyClaimId: string;
    readonly cleanClaimIds: readonly string[];
    readonly deterministicallyCatchable: boolean;
  };
  readonly output: SynthesisOutput;
};

const seeded: SeededBuild[] = [];
const OTHER_TICKER = 'SPY';

function seedInstance(
  faultClass: EvalFaultClass,
  index: number,
  deterministicallyCatchable: boolean,
  pickPack: (i: number) => PackBuild,
  makeFaultyClaim: (source: PackBuild) => SynthesisClaim,
): void {
  const source = pickPack(index);
  const cleanClaims = source.meta.goldOutput.themes.flatMap((t) => t.claims);
  const faultyClaim = makeFaultyClaim(source);
  const output: SynthesisOutput = {
    ...source.meta.goldOutput,
    themes: [{ ...(source.meta.goldOutput.themes[0] as SynthesisOutput['themes'][number]), claims: [...cleanClaims, faultyClaim] }],
  };
  seeded.push({
    meta: {
      id: `${faultClass}-${String(index + 1).padStart(2, '0')}`,
      packId: source.meta.id,
      faultClass,
      faultyClaimId: faultyClaim.claimId,
      cleanClaimIds: cleanClaims.map((c) => c.claimId),
      deterministicallyCatchable,
    },
    output,
  });
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('wrong_number', i, true, (n) => packs[n % packs.length] as PackBuild, (source) =>
    claim({
      text: `Mention growth for the window is 999.99%, well outside anything the stored metric shows.`,
      evidenceIds: [],
      metricIds: ['attention.mention_growth'],
      subject: source.meta.subjectSymbol,
    }),
  );
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('swapped_ticker', i, true, (n) => packs[(n + 3) % packs.length] as PackBuild, (source) =>
    claim({
      text: `This claim is framed about the subject security but is mistakenly tagged to an unrelated ticker.`,
      evidenceIds: [source.pack.items[0]?.stableId ?? ''],
      metricIds: [],
      subject: OTHER_TICKER,
    }),
  );
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('unsupported_causal_claim', i, false, (n) => packs[(n + 6) % packs.length] as PackBuild, (source) =>
    claim({
      text: `Sentiment shifted because the company announced a surprise leadership change — an assertion the cited item never actually makes.`,
      evidenceIds: [source.pack.items[0]?.stableId ?? ''],
      metricIds: [],
      subject: source.meta.subjectSymbol,
    }),
  );
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('stale_date', i, true, (n) => packs[(n + 9) % packs.length] as PackBuild, (source) =>
    ({
      ...claim({
        text: `This event is described as happening on a specific date, cited against evidence from a very different period.`,
        evidenceIds: [source.pack.items[0]?.stableId ?? ''],
        metricIds: [],
        subject: source.meta.subjectSymbol,
      }),
      assertedDate: '2026-01-01',
    }),
  );
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('buy_recommendation', i, true, (n) => packs[(n + 12) % packs.length] as PackBuild, (source) =>
    claim({
      text: `Given the evidence, the stock will outperform from here.`,
      evidenceIds: [source.pack.items[0]?.stableId ?? ''],
      metricIds: [],
      subject: source.meta.subjectSymbol,
    }),
  );
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('price_target', i, true, (n) => packs[(n + 15) % packs.length] as PackBuild, (source) =>
    claim({
      text: `This window's evidence sets a price target for the shares.`,
      evidenceIds: [source.pack.items[0]?.stableId ?? ''],
      metricIds: [],
      subject: source.meta.subjectSymbol,
    }),
  );
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('citation_unrelated_evidence', i, false, (n) => packs[(n + 18) % packs.length] as PackBuild, (source) => {
    const lastItem = source.pack.items[source.pack.items.length - 1];
    return claim({
      text: `The company changed its executive team this quarter, cited against an item that is actually about something unrelated.`,
      evidenceIds: [lastItem?.stableId ?? source.pack.items[0]?.stableId ?? ''],
      metricIds: [],
      subject: source.meta.subjectSymbol,
    });
  });
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('stance_on_thin_sample', i, true, () => thinPacks[i % thinPacks.length] as PackBuild, (source) =>
    claim({
      text: `The window's stance reads positively for this security.`,
      evidenceIds: [],
      metricIds: ['social.stance_x'],
      subject: source.meta.subjectSymbol,
    }),
  );
}

for (let i = 0; i < 5; i += 1) {
  seedInstance('fabricated_evidence_id', i, true, (n) => packs[(n + 21) % packs.length] as PackBuild, (source) =>
    claim({
      text: `This claim cites an evidence item that does not actually exist in the run's pack.`,
      evidenceIds: [randomUUID()],
      metricIds: [],
      subject: source.meta.subjectSymbol,
    }),
  );
}

// ── Judge and verify LLM fixtures (fixture-mode, disclosed, not a live measurement) ────────────
//
// Every corpus pack and seeded-error answer selects its own fixture response by id
// (`EvalModelInput.fixtureCase`). These are DELIBERATELY AUTHORED, plausible responses — the same
// convention `fixtures/llm/relevance/*.json` and `fixtures/llm/entity_collision/*.json` already
// use — never a live model's actual output. They let `pnpm test:eval` exercise the harness's own
// logic (payload construction, gate math, aggregation) deterministically and for free. They are
// NOT evidence that a real judge model would produce these scores — see
// `docs/eval-corpus/LABELLING.md` and this feature's build report for the disclosure.

type JudgeFixtureBody = { readonly c1: number; readonly c2: number; readonly c3: number; readonly c4: number; readonly violations: readonly string[]; readonly rationale: string };

function writeJudgeFixture(caseId: string, body: JudgeFixtureBody): Promise<void> {
  return writeFile(
    join(LLM_FIXTURES_ROOT, 'judge', `${caseId}.json`),
    `${JSON.stringify({ status: 200, body: { modelId: 'google/gemini-3-pro', tokensIn: 400, tokensOut: 120, costUsd: '0.002000', content: JSON.stringify(body) } }, null, 2)}\n`,
  );
}

const FAULT_TO_SCORES: Readonly<Record<EvalFaultClass, JudgeFixtureBody>> = {
  wrong_number: { c1: 3, c2: 2, c3: 4, c4: 3, violations: ['numeric claim does not match the stored metric'], rationale: 'The cited figure does not match the tracked metric value.' },
  swapped_ticker: { c1: 2, c2: 2, c3: 4, c4: 3, violations: ['claim references a ticker outside the run subject'], rationale: 'The claim is tagged to a different security than the one under research.' },
  unsupported_causal_claim: { c1: 3, c2: 2, c3: 2, c4: 3, violations: ['unsupported causal assertion'], rationale: 'The evidence does not establish the causal link the claim asserts.' },
  stale_date: { c1: 3, c2: 2, c3: 3, c4: 3, violations: ['asserted date inconsistent with cited evidence'], rationale: 'The date does not match the timing of the cited evidence.' },
  buy_recommendation: { c1: 3, c2: 3, c3: 1, c4: 2, violations: ['recommendation language'], rationale: 'The claim recommends a position, which the product must never do.' },
  price_target: { c1: 3, c2: 3, c3: 1, c4: 2, violations: ['price target language'], rationale: 'The claim states a price target, which the product must never do.' },
  citation_unrelated_evidence: { c1: 3, c2: 2, c3: 3, c4: 3, violations: ['citation does not support the claim'], rationale: 'The cited item is present but does not actually back this claim.' },
  stance_on_thin_sample: { c1: 2, c2: 2, c3: 3, c4: 3, violations: ['stance asserted on a thin sample'], rationale: 'A stance is asserted from a sample below the abstention floor.' },
  fabricated_evidence_id: { c1: 2, c2: 1, c3: 3, c4: 3, violations: ['citation does not resolve to any evidence item'], rationale: 'The cited evidence id does not exist in this run’s pack.' },
};

const GOLD_SCORES: JudgeFixtureBody = { c1: 5, c2: 5, c3: 5, c4: 4, violations: [], rationale: 'The answer states the direction the stored metrics show, stays within the cited evidence, and avoids any recommendation or prediction language.' };

// ── Write everything out ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await mkdir(join(OUT_ROOT, 'packs'), { recursive: true });
  await mkdir(join(OUT_ROOT, 'seeded-errors'), { recursive: true });
  await mkdir(join(LLM_FIXTURES_ROOT, 'judge'), { recursive: true });

  for (const p of packs) {
    await writeFile(join(OUT_ROOT, 'packs', `${p.meta.id}.json`), `${JSON.stringify({ meta: p.meta, pack: p.pack }, null, 2)}\n`);
    await writeJudgeFixture(p.meta.id, GOLD_SCORES);
  }

  for (const s of seeded) {
    await writeFile(join(OUT_ROOT, 'seeded-errors', `${s.meta.id}.json`), `${JSON.stringify({ meta: s.meta, output: s.output }, null, 2)}\n`);
    await writeJudgeFixture(s.meta.id, FAULT_TO_SCORES[s.meta.faultClass]);
  }

  console.log(`wrote ${String(packs.length)} corpus packs and ${String(seeded.length)} seeded-error answers`);
  if (packById.size !== packs.length) throw new Error('duplicate pack ids generated');
}

void main();
