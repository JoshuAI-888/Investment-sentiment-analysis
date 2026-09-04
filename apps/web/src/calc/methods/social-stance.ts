/**
 * `social.stance.<axis>` — source §8.2, social stance aggregation, one method per platform axis
 * (D-14: *"three platform axes, computed and stored separately. A blended cross-axis number is
 * never the stored primitive"*).
 *
 * ```text
 * signed_i = +1 bullish, -1 bearish, 0 neutral/unclear
 * weight_i = relevance_i * classifier_confidence_i * freshness_decay_i
 * freshness_decay_i = exp(-age_hours / 36)
 * raw_social = sum(weight_i * signed_i) / sum(weight_i)
 * n_eff = (sum(weight_i)^2) / sum(weight_i^2)
 * shrunk_social = raw_social * n_eff / (n_eff + 8)
 * coverage = min(1, n_eff / 12)
 * agreement = 1 - weighted_variance(signed_i)
 * ```
 *
 * `weighted_variance` is not spelled out further in source; this transcribes it as the
 * weight-normalized variance of `signed_i` around `raw_social`:
 * `sum(weight_i * (signed_i - raw_social)^2) / sum(weight_i)` — the standard definition, and the
 * only one source's `agreement` (a 0–1 "how much did people agree" figure) is coherent with.
 * Documented here as an interpretation, per the build spec's instruction that only the
 * thresholds, not the formulas, were left open.
 *
 * **F-03, binding:** the artifact's headline number is the *stance*, not the sample-adequacy
 * figure — `shrunk_social` is what `ctx.step` returns. `sample_adequacy` (F-03's rename of
 * source's `confidence`, since a shrinkage estimate is not a confidence interval) is recorded as
 * its own step, alongside `coverage`, `agreement` and `n_eff`, so the Inspector shows all four
 * next to the `limitations[]` disclosure rather than folding them into one opaque number.
 *
 * **`min_items` is locked at 5 on every axis — never axis-specific, never provisional.**
 * `01-PRODUCT-SPEC.md` §6.3 and Tier B's B5 fix it there with zero per-axis exception; a second
 * lane-review pass caught an earlier draft of this module treating it as a tunable per-axis
 * default and lowering it for X and Substack, which is exactly the regression this note now
 * exists to prevent. Only `display_floor` — the *low-adequacy-flag* threshold above `min_items`,
 * not the abstention floor itself — is genuinely provisional per axis; see the registry entries
 * in `analytics/registry.ts` for the reasoning and the MT-08 trigger to re-derive it. This
 * module takes both as `min_items`/`display_floor` assumptions rather than literals so the same
 * compute function serves all three registrations — `min_items` stays fixed because every
 * registration is required to pass the same value, not because this module enforces it.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { D, type Dec } from '../decimal';
import { readSeries, seriesLength } from '../series';
import { sumDec } from '../stats';

export const SOCIAL_STANCE_VERSION = '1.0.0';

const ONE = new D('1');
const ZERO = new D('0');
const FRESHNESS_HALF_LIFE_HOURS = '36';
const SHRINKAGE_K = '8';
const COVERAGE_CEILING = '12';

function weightOf(relevance: Dec, confidence: Dec, ageHours: Dec): Dec {
  const decay = ageHours.div(new D(FRESHNESS_HALF_LIFE_HOURS)).negated().exp();
  return relevance.times(confidence).times(decay);
}

export function computeSocialStance(ctx: ComputeContext): ComputeResult {
  const minItems = ctx.assumption('min_items');
  const displayFloor = ctx.assumption('display_floor');

  const n = seriesLength(ctx, 'signed');
  const nDec = new D(String(n));
  if (nDec.lessThan(minItems)) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        `${String(n)} relevant item(s) were found. At least ${minItems.toFixed()} are required ` +
        'before a stance of sampled snippets is shown at all — below that floor there is no ' +
        'sample to shrink, only a handful of individually-read items.',
    });
  }

  const signed = readSeries(ctx, 'signed', n);
  const relevance = readSeries(ctx, 'relevance', n);
  const confidence = readSeries(ctx, 'confidence', n);
  const ageHours = readSeries(ctx, 'age_hours', n);

  const weights = relevance.map((r, index) =>
    weightOf(r, confidence[index] as Dec, ageHours[index] as Dec),
  );
  const totalWeight = sumDec(weights);

  if (totalWeight.lessThanOrEqualTo(ZERO)) {
    ctx.abstain({
      reason: 'no_coverage_in_window',
      message:
        `${String(n)} item(s) were found, but every one carries zero weight (zero relevance or ` +
        'zero classifier confidence). There is nothing to average — a mean over all-zero weights ' +
        'is undefined, not zero.',
    });
  }

  const rawSocial = ctx.step({
    key: 'raw_social',
    label: 'Weighted mean stance, unshrunk',
    expression: 'sum(weight_i * signed_i) / sum(weight_i)',
    operands: { item_count: String(n) },
    unit: 'stance_unit',
    evaluate: () => {
      const numerator = sumDec(weights.map((w, index) => w.times(signed[index] as Dec)));
      return numerator.div(totalWeight);
    },
  });

  const sumWeightsSquared = sumDec(weights.map((w) => w.pow(2)));
  const nEff = ctx.step({
    key: 'n_eff',
    label: 'Effective sample size',
    expression: '(sum(weight_i))^2 / sum(weight_i^2)',
    operands: { item_count: String(n) },
    unit: 'items',
    evaluate: () => totalWeight.pow(2).div(sumWeightsSquared),
  });

  const shrunkSocial = ctx.step({
    key: 'shrunk_social',
    label: 'Stance of sampled snippets, shrunk toward neutral',
    expression: '{raw_social} * {n_eff} / ({n_eff} + {shrinkage_k})',
    operands: { raw_social: rawSocial, n_eff: nEff, shrinkage_k: SHRINKAGE_K },
    unit: 'stance_unit',
    evaluate: (operand) =>
      operand('raw_social')
        .times(operand('n_eff'))
        .div(operand('n_eff').plus(operand('shrinkage_k'))),
  });

  const coverageUncapped = nEff.decimal.div(new D(COVERAGE_CEILING));
  const coverageAtCeiling = coverageUncapped.greaterThan(ONE);
  const coverage = ctx.step({
    key: 'coverage',
    label: 'Sample-size coverage, capped at one',
    expression: 'min(1, {n_eff} / {coverage_ceiling})',
    operands: { n_eff: nEff, coverage_ceiling: COVERAGE_CEILING },
    unit: 'ratio',
    status: coverageAtCeiling ? 'clamped' : 'applied',
    evaluate: (operand) => {
      const raw = operand('n_eff').div(operand('coverage_ceiling'));
      return raw.greaterThan(ONE) ? ONE : raw;
    },
  });

  const agreement = ctx.step({
    key: 'agreement',
    label: 'How closely sampled items agree in direction',
    expression: '1 - weighted_variance(signed_i)',
    operands: { item_count: String(n) },
    unit: 'ratio',
    evaluate: () => {
      const raw = rawSocial.decimal;
      const weightedSumSquaredDeviation = sumDec(
        weights.map((w, index) => w.times((signed[index] as Dec).minus(raw).pow(2))),
      );
      const weightedVariance = weightedSumSquaredDeviation.div(totalWeight);
      return ONE.minus(weightedVariance);
    },
  });

  const rawAdequacy = coverage.decimal
    .times(new D('0.55'))
    .plus(agreement.decimal.times(new D('0.45')));
  const clampedLow = rawAdequacy.lessThan(ZERO);
  const clampedHigh = rawAdequacy.greaterThan(ONE);
  ctx.step({
    key: 'sample_adequacy',
    label: 'Sample adequacy — how much material was available, not how likely the result is right',
    expression: 'clamp(0.55 * {coverage} + 0.45 * {agreement}, 0, 1)',
    operands: { coverage, agreement },
    unit: 'ratio',
    status: clampedLow || clampedHigh ? 'clamped' : 'applied',
    evaluate: (operand) => {
      const raw = operand('coverage')
        .times('0.55')
        .plus(operand('agreement').times('0.45'));
      if (raw.lessThan(ZERO)) return ZERO;
      if (raw.greaterThan(ONE)) return ONE;
      return raw;
    },
  });

  if (nEff.decimal.lessThan(displayFloor)) {
    // Against `n_eff`, not the raw item count — the registry names this threshold `n_eff ≥ 8`,
    // and `n_eff` is weight-dependent: eight items at partial relevance/confidence/freshness
    // can carry an effective sample far below eight. Comparing against raw `n` here would admit
    // exactly the low-quality-but-numerous case the floor exists to catch. Found by lane-review.
    ctx.warn(
      `${String(n)} relevant item(s) were found (effective sample size ${nEff.decimal.toFixed(2)}), ` +
        `below the ${displayFloor.toFixed()}-item effective-sample floor for full display. The ` +
        'stance is stored and shown, flagged low adequacy rather than withheld — §8.2 stores a ' +
        'score at 5–7 items and only withholds one below 5.',
    );
  }

  return { value: shrunkSocial };
}
