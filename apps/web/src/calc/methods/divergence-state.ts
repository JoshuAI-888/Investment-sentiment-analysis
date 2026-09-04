/**
 * `market.divergence_state` — source §8.6's table, evaluated in the table's own row order:
 *
 * | Condition | State |
 * |---|---|
 * | Attention up, social positive, price positive | Confirming interest |
 * | Attention up, social positive, price negative | Bullish discussion / weak tape |
 * | Attention up, social negative, price negative | Risk-focused attention |
 * | Attention up, stance mixed | Debate / uncertainty |
 * | Price up, attention flat/down | Price-led move |
 *
 * Every combination the table does not name falls to `no_clear_pattern` — the table is not
 * exhaustive over nine possible direction combinations, and an unlisted combination is not the
 * same fact as a listed one that happens not to apply.
 *
 * Inputs are already-classified direction codes (`-1`/`0`/`1`) — the aggregation this method
 * owns is *combining* three already-computed axes into a state, not computing the axes
 * themselves (out of scope, F06 §2).
 *
 * **F-17, binding:** the artifact's `warnings` always carries the disclosure line, on every
 * outcome — it is part of this method's output, not UI copy a later feature could drop.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { dec } from '../decimal';
import { DIVERGENCE_DISCLOSURE_LINE, DIVERGENCE_STATE_CODE, type DivergenceState } from '../divergence';

export const MARKET_DIVERGENCE_STATE_ID = 'market.divergence_state';
export const MARKET_DIVERGENCE_STATE_VERSION = '1.0.0';

const UP = '1';
const DOWN = '-1';
const FLAT_OR_MIXED = '0';

function classify(attention: string, social: string, price: string): DivergenceState {
  if (attention === UP && social === UP && price === UP) return 'confirming_interest';
  if (attention === UP && social === UP && price === DOWN) return 'bullish_discussion_weak_tape';
  if (attention === UP && social === DOWN && price === DOWN) return 'risk_focused_attention';
  if (attention === UP && social === FLAT_OR_MIXED) return 'debate_uncertainty';
  if (price === UP && attention !== UP) return 'price_led_move';
  return 'no_clear_pattern';
}

export function computeDivergenceState(ctx: ComputeContext): ComputeResult {
  const attention = ctx.input('attention_direction');
  const social = ctx.input('social_direction');
  const price = ctx.input('price_direction');

  const attentionText = attention.toFixed();
  const socialText = social.toFixed();
  const priceText = price.toFixed();
  const state = classify(attentionText, socialText, priceText);

  const code = DIVERGENCE_STATE_CODE[state];
  const step = ctx.step({
    key: 'divergence_state',
    label: 'Divergence state, source §8.6',
    expression: 'classify({attention_direction}, {social_direction}, {price_direction})',
    operands: { attention_direction: attention, social_direction: social, price_direction: price },
    unit: 'state_code',
    notes: [`state: ${state}`],
    evaluate: () => dec(code),
  });

  // F-17, binding: every divergence-state artifact carries this line, unconditionally — it is
  // part of the method's output, not UI copy a later feature could drop.
  ctx.warn(DIVERGENCE_DISCLOSURE_LINE);

  return { value: step };
}
