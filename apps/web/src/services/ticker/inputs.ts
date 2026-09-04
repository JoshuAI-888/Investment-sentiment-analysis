/**
 * Turning stored rows into `CalculationInputValue[]` — the shapes `calc/methods/*.ts` reads via
 * `ctx.input`/`ctx.identity`/`readSeries` (`calc/series.ts`'s `${prefix}_${index}` convention).
 * Mirrors `services/dashboard/inputs.ts`'s pattern, sourced from stored snapshots rather than a
 * live adapter call — F09 DoD item 1: no provider call in the read path.
 */
import type { AttentionSnapshot } from '@/contracts/security';
import type { MarketSnapshot } from '@/contracts/security';
import type { EvidenceItem } from '@/contracts/evidence';
import type { CalculationInputValue, InputProvenance, ResolvedAssumption } from '@/calc/artifact';
import { D } from '@/calc/decimal';
import { METHOD_REGISTRY } from '@/services/calculations';

function provenance(partial: Partial<InputProvenance> & { readonly provider: string }): InputProvenance {
  return {
    provider: partial.provider,
    providerField: partial.providerField ?? null,
    sourceUrl: partial.sourceUrl ?? null,
    observedAt: partial.observedAt ?? null,
    availableAt: partial.availableAt ?? partial.observedAt ?? null,
    ingestedAt: partial.ingestedAt ?? new Date().toISOString(),
    rawPayloadId: null,
    licenseClass: 'provider_terms',
    redactionClass: 'public',
  };
}

/** `entry.officialAssumptions` resolved into the shape `buildArtifact` expects, with no override. */
export function officialAssumptions(methodId: string): readonly ResolvedAssumption[] {
  const entry = METHOD_REGISTRY.latest(methodId);
  return Object.entries(entry.officialAssumptions).map(([key, officialValue]) => {
    const editable = entry.editableAssumptions.find((candidate) => candidate.key === key);
    return {
      key,
      value: officialValue,
      unit: editable?.unit ?? '',
      source: 'official_default' as const,
      officialValue,
      min: editable?.min ?? null,
      max: editable?.max ?? null,
      editable: editable !== undefined,
    };
  });
}

// ── Attention (F06 §4.1, F09 §4.2) ──────────────────────────────────────────────────────────────

/**
 * `attention_snapshot` already stores one board reading's current *and* prior-observation
 * figures on the same row (`rank`/`rankPrior`, `mentions`/`mentionsPrior` — mirroring
 * `ApeWisdomEntry`'s own `rank`/`rank24hAgo` shape), so a single row is enough for
 * `attention.mention_delta` and `attention.rank_change`.
 *
 * **Judgment call, disclosed rather than hidden (F08 does not exist yet to settle this).**
 * `attention.rank_change@1.1.0` also needs the *prior observation's own*
 * `provider_methodology_version` to check for a boundary crossing (F06 §4.1) — a fact this single
 * row's own `providerMethodologyVersion` column does not carry (it describes only "now"). Where a
 * second, earlier stored row exists (`priorRow`), its own methodology version is used, which is
 * the honest answer. Where none exists — the row is the first observation ever collected for this
 * `(security, source)` — there is nothing to compare against, and `priorRow`'s absence is not
 * itself evidence of a boundary crossing, so the current row's own methodology version is used for
 * both sides (i.e., "no boundary detected" is the correct default absent a second data point, not
 * a favourable guess). See this feature's DECISIONS note.
 */
export function attentionInputs(
  latest: AttentionSnapshot,
  priorRow: AttentionSnapshot | null,
): CalculationInputValue[] {
  const prov = (providerField: string) =>
    provenance({
      provider: latest.source,
      providerField,
      observedAt: latest.observedAt.toISOString(),
      availableAt: latest.observedAt.toISOString(),
      ingestedAt: latest.ingestedAt.toISOString(),
    });

  const priorMethodologyVersion = priorRow?.providerMethodologyVersion ?? latest.providerMethodologyVersion;

  return [
    { key: 'rank_now', value: String(latest.rank ?? 0), unit: 'ranks', dataType: 'decimal', source: latest.source, quality: 'ok', freshness: 'fresh', provenance: prov('rank') },
    { key: 'rank_prior', value: String(latest.rankPrior ?? 0), unit: 'ranks', dataType: 'decimal', source: latest.source, quality: 'ok', freshness: 'fresh', provenance: prov('rank_prior') },
    { key: 'mentions_now', value: String(latest.mentions), unit: 'mentions', dataType: 'decimal', source: latest.source, quality: 'ok', freshness: 'fresh', provenance: prov('mentions') },
    { key: 'mentions_prior', value: String(latest.mentionsPrior ?? 0), unit: 'mentions', dataType: 'decimal', source: latest.source, quality: 'ok', freshness: 'fresh', provenance: prov('mentions_prior') },
    { key: 'methodology_version_now', value: latest.providerMethodologyVersion, unit: '', dataType: 'identity', source: latest.source, quality: 'ok', freshness: 'fresh', provenance: prov('methodology_version') },
    { key: 'methodology_version_prior', value: priorMethodologyVersion, unit: '', dataType: 'identity', source: latest.source, quality: 'ok', freshness: 'fresh', provenance: prov('methodology_version_prior') },
  ];
}

// ── Sampled stance (D-14, source §8.2) ──────────────────────────────────────────────────────────

export type StanceLabel = EvidenceItem['stanceLabel'];

function signOf(label: StanceLabel): string {
  if (label === 'bullish') return '1';
  if (label === 'bearish') return '-1';
  return '0';
}

function ageHoursOf(item: EvidenceItem, asOf: Date): string {
  const basis = item.availableAt.getTime();
  const hours = (asOf.getTime() - basis) / (1000 * 60 * 60);
  return String(Math.max(hours, 0));
}

/**
 * `evidence_item` has no separate "classifier confidence" column (D-13's scorer output).
 * `stanceScore` is read as that confidence — the model's confidence in the `stanceLabel` it
 * assigned, mirroring how a FinBERT/RoBERTa-style classifier reports its output (label,
 * confidence) — rather than as a signed sentiment value in its own right. Documented here rather
 * than assumed silently; see this feature's DECISIONS note. Only items with a non-null
 * `stanceLabel`/`stanceScore`/`relevanceScore` are "relevant items" for `n` — an item never
 * classified (still queued, or scoring failed) is excluded rather than treated as neutral.
 *
 * **Round-1 lane-review finding 1, correcting a prior claim here.** This filter is *not* D-13's
 * abstention gate (`services/jobs/stance-availability.ts#stanceGate`) — that gate is never called
 * from this module. `stanceGate` needs a persisted score table (`ScoreRow`/`UnscoreableRow`/
 * `ScorerHealth`, `services/jobs/ports.ts`) to distinguish "the scorer is down" from "these items
 * simply haven't been classified yet"; no migration for such a table exists in this codebase
 * today, so the gate may be genuinely unreachable from this feature until one does. The practical
 * consequence: during a real scorer outage, this module's own abstention (via `calc/methods/
 * social-stance.ts`'s `n < minItems` check) reads "N relevant item(s) were found. At least M are
 * required" — the same message an ordinarily-thin, non-outage sample gets — not §6.7's "No stance
 * — scorer unavailable since {ts}." A caller cannot tell the two apart from this page today. That
 * is a real, disclosed gap against D-13, not a satisfied invariant, and it stays open until a
 * score table exists for `stanceGate` to read.
 */
export function stanceInputsFromEvidence(
  items: readonly EvidenceItem[],
  asOf: Date,
): CalculationInputValue[] {
  const classified = items.filter(
    (item) => item.stanceLabel !== null && item.stanceScore !== null && item.relevanceScore !== null,
  );

  const inputs: CalculationInputValue[] = [];
  classified.forEach((item, index) => {
    const prov = (providerField: string) =>
      provenance({
        provider: item.provider,
        providerField,
        sourceUrl: item.sourceUrl,
        observedAt: item.publishedAt?.toISOString() ?? item.availableAt.toISOString(),
        availableAt: item.availableAt.toISOString(),
        ingestedAt: item.ingestedAt.toISOString(),
      });

    inputs.push(
      { key: `signed_${index}`, value: signOf(item.stanceLabel), unit: null, dataType: 'decimal', source: item.provider, quality: 'ok', freshness: 'fresh', provenance: prov('stance_label') },
      { key: `relevance_${index}`, value: item.relevanceScore as string, unit: 'ratio', dataType: 'decimal', source: item.provider, quality: 'ok', freshness: 'fresh', provenance: prov('relevance_score') },
      { key: `confidence_${index}`, value: item.stanceScore as string, unit: 'ratio', dataType: 'decimal', source: item.provider, quality: 'ok', freshness: 'fresh', provenance: prov('stance_score') },
      {
        key: `age_hours_${index}`,
        value: ageHoursOf(item, asOf),
        unit: 'hours',
        dataType: 'decimal',
        source: 'internal',
        quality: 'estimated',
        freshness: 'fresh',
        provenance: provenance({ provider: 'internal', providerField: 'derived:age_hours_from_available_at', observedAt: item.availableAt.toISOString() }),
      },
    );
  });

  return inputs;
}

// ── News (source §8.3) ───────────────────────────────────────────────────────────────────────

/**
 * `entity_sentiment_i` — a continuous signed value `news.sentiment` expects — is derived from
 * `evidence_item`'s discrete `stanceLabel` and its `stanceScore` (read as confidence, same
 * mapping `stanceInputsFromEvidence` uses): `sign(stanceLabel) * stanceScore`. Not a Marketaux
 * (or any provider's) field — an honest, disclosed derivation, the same convention
 * `services/dashboard/inputs.ts` already uses for its own `relevance_*`/`age_hours_*` synthesized
 * inputs (`provider: 'internal'`).
 */
export function newsInputsFromEvidence(
  items: readonly EvidenceItem[],
  asOf: Date,
): CalculationInputValue[] {
  const classified = items.filter(
    (item) => item.stanceLabel !== null && item.stanceScore !== null && item.relevanceScore !== null,
  );

  const inputs: CalculationInputValue[] = [];
  classified.forEach((item, index) => {
    const entitySentiment = new D(signOf(item.stanceLabel)).times(new D(item.stanceScore as string)).toFixed();
    const prov = (providerField: string, provider: string) =>
      provenance({
        provider,
        providerField,
        sourceUrl: item.sourceUrl,
        observedAt: item.publishedAt?.toISOString() ?? item.availableAt.toISOString(),
        availableAt: item.availableAt.toISOString(),
        ingestedAt: item.ingestedAt.toISOString(),
      });

    inputs.push(
      {
        key: `entity_sentiment_${index}`,
        value: entitySentiment,
        unit: 'sentiment_unit',
        dataType: 'decimal',
        source: 'internal',
        quality: 'estimated',
        freshness: 'fresh',
        provenance: prov('derived:sign(stance_label)*stance_score', 'internal'),
      },
      {
        key: `relevance_${index}`,
        value: item.relevanceScore as string,
        unit: 'ratio',
        dataType: 'decimal',
        source: item.provider,
        quality: 'ok',
        freshness: 'fresh',
        provenance: prov('relevance_score', item.provider),
      },
      {
        key: `age_hours_${index}`,
        value: ageHoursOf(item, asOf),
        unit: 'hours',
        dataType: 'decimal',
        source: 'internal',
        quality: 'estimated',
        freshness: 'fresh',
        provenance: prov('derived:age_hours_from_available_at', 'internal'),
      },
    );
  });

  return inputs;
}

// ── Price / technical (source §8.4, §8.7) ───────────────────────────────────────────────────────

/**
 * `market_snapshot` (migration `0002`/`0011`) has no column recording whether `price` is a raw
 * or a split/dividend-adjusted close — see `repositories/market.ts`'s own module docstring and
 * `services/dashboard/inputs.ts`'s identical finding for F07. Declaring `close_unadjusted`
 * (rather than guessing `adjusted_close`) is the honest choice: `price.regime`,
 * `price.volatility_20` and every `technical.*` method gate on this and abstain `not_applicable`
 * rather than mixing quote kinds (§8.4). Reported under this feature's CONTRACTS line.
 */
export function priceSeriesInputs(
  bars: readonly Pick<MarketSnapshot, 'price' | 'observedAt' | 'provider'>[],
  window: number,
): CalculationInputValue[] {
  // Repository history comes back most-recent-first; these methods want oldest-first with
  // `close_{window-1}` the most recent, and exactly `window` of them, no more and no fewer.
  const chronological = [...bars].reverse().slice(-window);

  const closes: CalculationInputValue[] = chronological.map((bar, index) => ({
    key: `close_${index}`,
    value: bar.price,
    unit: 'usd',
    dataType: 'decimal',
    source: 'market',
    quality: 'ok',
    freshness: 'fresh',
    provenance: provenance({ provider: bar.provider, providerField: 'price', observedAt: bar.observedAt.toISOString() }),
  }));

  const quoteKind: CalculationInputValue = {
    key: 'quote_kind',
    value: 'close_unadjusted',
    unit: null,
    dataType: 'identity',
    source: 'market',
    quality: 'ok',
    freshness: 'fresh',
    provenance: provenance({ provider: 'market', providerField: 'price' }),
  };

  return [...closes, quoteKind];
}
