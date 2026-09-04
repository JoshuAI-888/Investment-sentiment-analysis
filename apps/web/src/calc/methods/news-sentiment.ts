/**
 * `news.sentiment` — source §8.3:
 *
 * ```text
 * news_weight_i = relevance_i * source_weight_i * exp(-age_hours / 48)
 * raw_news = sum(news_weight_i * entity_sentiment_i) / sum(news_weight_i)
 * shrunk_news = raw_news * n / (n + 5)
 * ```
 *
 * *"Use Marketaux entity sentiment only for the resolved ticker/entity. Do not use
 * article-level tone for every company mentioned."* — enforced upstream, by whatever assembles
 * `entity_sentiment_i`; this method only aggregates what it is handed.
 *
 * `source_weight_i` is fixed at `1` for every item (source: *"Default `source_weight_i = 1`.
 * Add publisher-quality weights only after a documented methodology and evaluation dataset
 * exist"*) — not a per-item input, since there is currently exactly one value it could ever
 * take, and an input that can only ever be `1` is a constant wearing an input's clothes.
 *
 * **F-08, binding:** fewer than 3 entity-tagged articles ⇒ `insufficient_data`. Marketaux's free
 * tier caps at 3 articles per request, so a shrunk mean over `n < 3` is noise wearing a decimal
 * point.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { D, type Dec } from '../decimal';
import { readSeries, seriesLength } from '../series';
import { sumDec } from '../stats';

export const NEWS_SENTIMENT_ID = 'news.sentiment';
export const NEWS_SENTIMENT_VERSION = '1.0.0';

const ZERO = new D('0');
const FRESHNESS_HALF_LIFE_HOURS = '48';
const SHRINKAGE_K = '5';
/** §8.3: fixed at 1 until a documented publisher-quality methodology exists. */
const SOURCE_WEIGHT = new D('1');

function weightOf(relevance: Dec, ageHours: Dec): Dec {
  const decay = ageHours.div(new D(FRESHNESS_HALF_LIFE_HOURS)).negated().exp();
  return relevance.times(SOURCE_WEIGHT).times(decay);
}

export function computeNewsSentiment(ctx: ComputeContext): ComputeResult {
  const minArticles = ctx.assumption('min_articles');

  const n = seriesLength(ctx, 'entity_sentiment');
  const nDec = new D(String(n));
  if (nDec.lessThan(minArticles)) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        `${String(n)} entity-tagged article(s) were found. At least ${minArticles.toFixed()} are ` +
        "required — Marketaux's free tier caps at 3 articles per request, so a shrunk mean over " +
        'fewer than that is noise wearing a decimal point.',
    });
  }

  const entitySentiment = readSeries(ctx, 'entity_sentiment', n);
  const relevance = readSeries(ctx, 'relevance', n);
  const ageHours = readSeries(ctx, 'age_hours', n);

  const weights = relevance.map((r, index) => weightOf(r, ageHours[index] as Dec));
  const totalWeight = sumDec(weights);

  if (totalWeight.lessThanOrEqualTo(ZERO)) {
    ctx.abstain({
      reason: 'no_coverage_in_window',
      message:
        `${String(n)} article(s) were found, but every one carries zero weight (zero relevance ` +
        'throughout). There is nothing to average — a mean over all-zero weights is undefined, ' +
        'not zero.',
    });
  }

  const rawNews = ctx.step({
    key: 'raw_news',
    label: 'Weighted mean entity sentiment, unshrunk',
    expression: 'sum(news_weight_i * entity_sentiment_i) / sum(news_weight_i)',
    operands: { article_count: String(n) },
    unit: 'sentiment_unit',
    evaluate: () => {
      const numerator = sumDec(weights.map((w, index) => w.times(entitySentiment[index] as Dec)));
      return numerator.div(totalWeight);
    },
  });

  const shrunkNews = ctx.step({
    key: 'shrunk_news',
    label: 'News sentiment, shrunk toward neutral',
    expression: '{raw_news} * {article_count} / ({article_count} + {shrinkage_k})',
    operands: { raw_news: rawNews, article_count: String(n), shrinkage_k: SHRINKAGE_K },
    unit: 'sentiment_unit',
    evaluate: (operand) =>
      operand('raw_news')
        .times(operand('article_count'))
        .div(operand('article_count').plus(operand('shrinkage_k'))),
  });

  return { value: shrunkNews };
}
