/**
 * `market.sector_breadth` — source §8.5:
 *
 * ```text
 * sector_breadth = positive_sector_etfs / sector_etfs_with_data
 * sector_breadth_score = 2 * sector_breadth - 1
 * ```
 *
 * Maps a `[0, 1]` breadth ratio onto `[-1, 1]` so it is comparable in sign and scale with the
 * other three `market.composite` components. `sector_etfs_with_data = 0` is not a divide-by-zero
 * to guard — it is "no sector data reached the composite this cycle", which is the abstention
 * itself, not a term to floor.
 */
import type { ComputeContext, ComputeResult } from '../artifact';

export const MARKET_SECTOR_BREADTH_ID = 'market.sector_breadth';
export const MARKET_SECTOR_BREADTH_VERSION = '1.0.0';

export function computeMarketSectorBreadth(ctx: ComputeContext): ComputeResult {
  const positive = ctx.input('positive_sector_etfs');
  const withData = ctx.input('sector_etfs_with_data');

  if (withData.lessThanOrEqualTo('0')) {
    ctx.abstain({
      reason: 'no_coverage_in_window',
      message:
        'No sector ETF reported data this cycle, so there is nothing to compute breadth from.',
    });
  }

  const breadth = ctx.step({
    key: 'sector_breadth',
    label: 'Share of sector ETFs positive',
    expression: '{positive_sector_etfs} / {sector_etfs_with_data}',
    operands: { positive_sector_etfs: positive, sector_etfs_with_data: withData },
    unit: 'ratio',
    evaluate: (operand) => operand('positive_sector_etfs').div(operand('sector_etfs_with_data')),
  });

  const score = ctx.step({
    key: 'sector_breadth_score',
    label: 'Sector breadth, rescaled to [-1, 1]',
    expression: '2 * {sector_breadth} - 1',
    operands: { sector_breadth: breadth, two: '2', one: '1' },
    unit: 'score_unit',
    evaluate: (operand) => operand('two').times(operand('sector_breadth')).minus(operand('one')),
  });

  return { value: score };
}
