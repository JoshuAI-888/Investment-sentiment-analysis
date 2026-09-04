/**
 * Turning adapter data into `CalculationInputValue[]` for `price.regime`, `news.sentiment`,
 * `market.sector_breadth` and `market.composite` — the shapes `calc/methods/*.ts` reads via
 * `ctx.input`/`ctx.identity`/`readSeries` (`calc/series.ts`'s `${prefix}_${index}` convention).
 *
 * **The one honest limitation this file cannot route around.** `adapters/market.ts`'s `DailyBar`
 * keeps FMP's `close` field only — it does not carry `adjClose`, which is the field
 * `price.regime`'s and `price.volatility_20`'s `quote_kind` gate actually requires
 * (`calc/methods/price-regime.ts`: *"abstains rather than compute if it is not
 * `adjusted_close`"*). Declaring `close` as `adjusted_close` would be mislabelling a raw close as
 * an adjusted one — a real methodological error, not a technicality, since a split or a special
 * dividend silently corrupts an unadjusted return series. So `quote_kind` is declared honestly
 * as `close_unadjusted` here, which correctly abstains every `price.regime`/`price.volatility_20`
 * computation `not_applicable` until COLLECT's adapter carries `adjClose`. Reported under this
 * feature's `CONTRACTS` finding.
 */
import type { DailyBar } from '@/adapters/market';
import type { MarketauxArticle } from '@/adapters/marketaux';
import type { CalculationInputValue, InputProvenance } from '@/calc/artifact';
import type { ResolvedAssumption } from '@/calc/artifact';
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

/**
 * FMP returns newest-first (see `fixtures/market/historical_price_full/success.json`).
 * `price.regime` needs oldest-first, `close_0 .. close_{n-1}` with `close_{n-1}` the most recent.
 */
export function priceRegimeInputs(symbol: string, bars: readonly DailyBar[]): CalculationInputValue[] {
  const chronological = [...bars].sort((a, b) => a.date.localeCompare(b.date));

  const closes: CalculationInputValue[] = chronological.map((bar, index) => ({
    key: `close_${index}`,
    value: String(bar.close),
    unit: 'usd',
    dataType: 'decimal',
    source: 'market',
    quality: 'ok',
    freshness: 'fresh',
    provenance: provenance({
      provider: 'market',
      providerField: 'close',
      sourceUrl: `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}`,
      observedAt: `${bar.date}T00:00:00.000Z`,
    }),
  }));

  const quoteKind: CalculationInputValue = {
    key: 'quote_kind',
    value: 'close_unadjusted',
    unit: null,
    dataType: 'identity',
    source: 'market',
    quality: 'ok',
    freshness: 'fresh',
    provenance: provenance({ provider: 'market', providerField: 'close' }),
  };

  return [...closes, quoteKind];
}

function ageHours(publishedAt: string, asOf: Date): string {
  const publishedMs = new Date(publishedAt).getTime();
  const hours = (asOf.getTime() - publishedMs) / (1000 * 60 * 60);
  return String(Math.max(hours, 0));
}

/**
 * `MarketauxArticle` (`adapters/marketaux.ts`) does not carry a per-article relevance score —
 * the adapter's own type keeps `{uuid, title, url, publishedAt, entities}` only, dropping the
 * `relevance_score` field the raw payload can carry. Relevance is declared as `1` (full weight)
 * for every article until that field is surfaced, which is a real, named limitation rather than
 * a silent one — see this feature's `CONTRACTS`/`RISKS` report.
 *
 * **F07 review finding 5.** `relevance_${index}` (the hardcoded `1` above) and
 * `age_hours_${index}` (computed locally from `publishedAt` and the clock) are not Marketaux
 * fields — the adapter never supplied either. The original version of this function gave both
 * the *same* `InputProvenance` object built for the article's real, provider-sourced fields,
 * including `providerField: 'entities[].sentiment_score'` and the article's real `sourceUrl` —
 * so opening the Inspector on either synthesized value showed a confident, wrong Marketaux
 * origin for something this codebase computed itself. Each now gets its own honest provenance:
 * `provider: 'internal'` (the same convention `sectorBreadthInputs` below uses for its own
 * locally-derived counts), and a `providerField` that names what was actually computed rather
 * than borrowing the sentiment field's name.
 */
export function newsSentimentInputs(
  symbol: string,
  articles: readonly MarketauxArticle[],
  asOf: Date,
): CalculationInputValue[] {
  const tagged = articles
    .flatMap((article) => article.entities.filter((entity) => entity.symbol === symbol).map((entity) => ({ article, entity })))
    .filter(({ entity }) => entity.sentimentScore !== null);

  const inputs: CalculationInputValue[] = [];
  tagged.forEach(({ article, entity }, index) => {
    const sentimentProv = provenance({
      provider: 'marketaux',
      providerField: 'entities[].sentiment_score',
      sourceUrl: article.url,
      observedAt: article.publishedAt,
    });
    // Neither of these is a Marketaux field — see this function's doc comment. `sourceUrl` is
    // left `null` (rather than the article's) for the same reason: the article's URL is not
    // where this *value* came from, only where the article it was derived from came from.
    const relevanceProv = provenance({
      provider: 'internal',
      providerField: 'derived:relevance_placeholder',
      observedAt: article.publishedAt,
    });
    const ageHoursProv = provenance({
      provider: 'internal',
      providerField: 'derived:age_hours_from_published_at',
      observedAt: article.publishedAt,
    });
    inputs.push(
      {
        key: `entity_sentiment_${index}`,
        value: String(entity.sentimentScore),
        unit: 'sentiment_unit',
        dataType: 'decimal',
        source: 'marketaux',
        quality: 'ok',
        freshness: 'fresh',
        provenance: sentimentProv,
      },
      {
        key: `relevance_${index}`,
        value: '1',
        unit: 'ratio',
        dataType: 'decimal',
        source: 'internal',
        // Not a real measurement of relevance — an honest placeholder until the adapter surfaces
        // Marketaux's own `relevance_score` (this function's other doc comment).
        quality: 'estimated',
        freshness: 'fresh',
        provenance: relevanceProv,
      },
      {
        key: `age_hours_${index}`,
        value: ageHours(article.publishedAt, asOf),
        unit: 'hours',
        dataType: 'decimal',
        source: 'internal',
        // Locally computed, not a Marketaux value the way `entity_sentiment_*` is — `'ok'`
        // here would read the same as that genuinely provider-sourced field, which is exactly
        // the conflation this finding exists to remove.
        quality: 'estimated',
        freshness: 'fresh',
        provenance: ageHoursProv,
      },
    );
  });

  return inputs;
}

/**
 * F07 review finding 7. `0.35` mirrors `price.regime`'s own label boundary (`src/analytics/
 * registry.ts`'s `price.regime` entry: "Labels (positive >= 0.35, negative <= -0.35, otherwise
 * neutral)"), but `market.sector_breadth`'s own `officialAssumptions` there is empty — nothing
 * registers this threshold as belonging to *this* method, so if `price.regime`'s boundary ever
 * changes, this drifts out of sync silently, and the Inspector cannot explain "why 7 positive
 * sectors" because the classification happens here, outside any traced calc step.
 * `src/analytics/registry.ts` is SPINE-owned (`CLAUDE.md`) — this lane cannot register the
 * assumption there itself; reported under this feature's `CONTRACTS`. `Dec`, not `Number`, at
 * least keeps the comparison itself out of float arithmetic in the meantime.
 */
const POSITIVE_SECTOR_THRESHOLD = '0.35';

export function sectorBreadthInputs(
  regimes: readonly { readonly eligibility: string; readonly exact: string | null }[],
): CalculationInputValue[] {
  const withData = regimes.filter((regime) => regime.eligibility === 'ok');
  const positiveThreshold = new D(POSITIVE_SECTOR_THRESHOLD);
  const positive = withData.filter((regime) => regime.exact !== null && new D(regime.exact).gte(positiveThreshold));

  const prov = provenance({ provider: 'internal', providerField: 'price.regime' });
  return [
    { key: 'sector_etfs_with_data', value: String(withData.length), unit: 'count', dataType: 'decimal', source: 'internal', quality: 'ok', freshness: 'fresh', provenance: prov },
    { key: 'positive_sector_etfs', value: String(positive.length), unit: 'count', dataType: 'decimal', source: 'internal', quality: 'ok', freshness: 'fresh', provenance: prov },
  ];
}

export type CompositeComponentValue = { readonly key: string; readonly exact: string };

export function marketCompositeInputs(components: readonly CompositeComponentValue[]): CalculationInputValue[] {
  const prov = provenance({ provider: 'internal', providerField: 'market.composite' });
  return components.map((component) => ({
    key: component.key,
    value: component.exact,
    unit: 'score_unit',
    dataType: 'decimal',
    source: 'internal',
    quality: 'ok',
    freshness: 'fresh',
    provenance: prov,
  }));
}
