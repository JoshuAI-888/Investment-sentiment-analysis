/**
 * F09 §4.2's news axis: "shrunk news sentiment, article count, window; `insufficient_data` below
 * n=3." `news.sentiment`'s own `min_articles` assumption (F-08) is what actually enforces the
 * n=3 floor — this panel renders whatever eligibility the artifact carries rather than
 * re-deriving the threshold.
 */
import { AxisMetricCard } from './AxisMetricCard';
import type { NewsAxisView } from './types';

export type NewsAxisPanelProps = { readonly news: NewsAxisView };

export function NewsAxisPanel({ news }: NewsAxisPanelProps) {
  return (
    <section className="rounded border border-neutral-200 p-6" data-axis="news">
      <h2 className="text-lg font-semibold">News</h2>
      <p className="mt-1 text-xs text-neutral-500" data-news-article-count={String(news.articleCount)}>
        {news.articleCount} entity-tagged article(s) · window: {news.window}
      </p>

      {news.metric === null ? (
        <p className="mt-2 text-sm text-neutral-700" data-news-not-computed="">
          Not yet computed for this render.
        </p>
      ) : (
        <div className="mt-2">
          <AxisMetricCard metric={news.metric} />
        </div>
      )}
    </section>
  );
}
