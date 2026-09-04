/**
 * `market.composite` — source §8.5:
 *
 * ```text
 * market_score = weighted_mean(
 *   news_sentiment: 0.35,
 *   price_regime: 0.30,
 *   sector_breadth_score: 0.25,
 *   sampled_retail_stance: 0.10
 * )
 * ```
 *
 * *"The composite is calculated only from available components and weights are renormalized. A
 * component with inadequate coverage is omitted, not set to zero."* — this is F06 §4.5's build
 * spec verbatim, and it is what this method's whole shape is built to prove: a component is
 * **omitted from the input set entirely** by whoever calls this (there is no `news_sentiment:
 * '0'` fallback anywhere upstream), and this method reads presence with `ctx.hasInput` rather
 * than assuming all four are declared. The artifact records which participated in each
 * contributing step's `notes`, and the renormalized weight is visible in that step's own trace —
 * "the Inspector can show why today's composite is not comparable to yesterday's" (§4.5).
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { D, type Dec } from '../decimal';
import { sumDec } from '../stats';

export const MARKET_COMPOSITE_ID = 'market.composite';
export const MARKET_COMPOSITE_VERSION = '1.0.0';

type Component = { readonly key: string; readonly weight: string; readonly label: string };

/** Fixed weights, source §8.5 — code-level facts, never a user-editable assumption. */
const COMPONENTS: readonly Component[] = [
  { key: 'news_sentiment', weight: '0.35', label: 'News sentiment' },
  { key: 'price_regime', weight: '0.30', label: 'Price regime (trend strength)' },
  { key: 'sector_breadth_score', weight: '0.25', label: 'Sector breadth' },
  { key: 'sampled_retail_stance', weight: '0.10', label: 'Sampled retail stance' },
];

export function computeMarketComposite(ctx: ComputeContext): ComputeResult {
  const present = COMPONENTS.filter((component) => ctx.hasInput(component.key));

  if (present.length === 0) {
    ctx.abstain({
      reason: 'no_coverage_in_window',
      message:
        'None of the four composite components (news sentiment, price regime, sector breadth, ' +
        'sampled retail stance) had adequate coverage this cycle. A composite with no ' +
        'participating component is not a smaller composite, it is no composite.',
    });
  }

  const rawWeightSum = sumDec(present.map((component) => new D(component.weight)));
  const participantNames = present.map((component) => component.label).join(', ');
  const omittedNames = COMPONENTS.filter((component) => !ctx.hasInput(component.key))
    .map((component) => component.label)
    .join(', ');

  const contributions: Dec[] = [];
  for (const component of present) {
    const value = ctx.input(component.key);
    const contribution = ctx.step({
      key: `contribution_${component.key}`,
      label: `${component.label}, renormalized weight applied`,
      expression: `{${component.key}} * ({official_weight} / {participating_weight_sum})`,
      operands: {
        [component.key]: value,
        official_weight: component.weight,
        participating_weight_sum: rawWeightSum.toFixed(),
      },
      unit: 'score_unit',
      notes: [
        `Participating components this cycle: ${participantNames}.` +
          (omittedNames === '' ? '' : ` Omitted for inadequate coverage: ${omittedNames}.`),
      ],
      evaluate: (operand) =>
        operand(component.key).times(operand('official_weight').div(operand('participating_weight_sum'))),
    });
    contributions.push(contribution.decimal);
  }

  const composite = ctx.step({
    key: 'market_composite',
    label: 'Market composite, renormalized weighted mean',
    expression: 'sum(contribution_i)',
    operands: { component_count: String(present.length) },
    unit: 'score_unit',
    notes: [`Participating components: ${participantNames}.`],
    evaluate: () => sumDec(contributions),
  });

  return { value: composite };
}
