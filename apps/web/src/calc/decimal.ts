/**
 * The decimal layer (F05 §4.1). **Configured once, here, and nowhere else.**
 *
 * `docs/02-ARCHITECTURE-CONTRACTS.md` §4.2: *"All arithmetic uses a decimal library. A raw JS
 * `number` in an analytics module is a review failure."* `no-float-in-analytics` makes that a
 * build failure inside `calc/` and `analytics/`, which is why this module speaks in strings and
 * `Decimal` and never in `number` — the one exception being `workingPrecision`, which is a
 * *configuration* of the arithmetic rather than a term in it.
 *
 * Why a configured clone rather than the global `Decimal`: a library configured by whichever
 * module imported it first is a library whose precision depends on module resolution order. The
 * artifact's `result_hash` would then depend on the bundler. `D` below is a clone with the
 * working precision pinned, so every consumer gets the same arithmetic whatever the import graph
 * looks like.
 */
import Decimal from 'decimal.js';

/**
 * The registry's working precision, in significant digits.
 *
 * 34 is IEEE 754-2008 `decimal128`'s coefficient length. It is chosen because it is a *named*
 * precision rather than a comfortable one — a round number picked by taste is a number somebody
 * later adjusts by taste, and every stored `result_hash` computed before the adjustment silently
 * stops reproducing.
 */
export const WORKING_PRECISION = 34;

/**
 * The configured clone. `toExpNeg`/`toExpPos` are pushed far out so `toString()` never reaches
 * for exponential notation: `1e-7` and `0.0000001` are the same number and different strings,
 * and the canonical form has to be one of them, deterministically.
 */
export const D = Decimal.clone({
  precision: WORKING_PRECISION,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
  modulo: Decimal.ROUND_HALF_EVEN,
});

export type Dec = InstanceType<typeof D>;

/** The shape every decimal crosses a boundary in — including through JSON (§4.1). */
export type DecimalString = string;

const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;

/** True for the exact grammar `contracts/primitives.ts` calls a `decimalString`. */
export function isDecimalString(value: string): boolean {
  return DECIMAL_TEXT.test(value);
}

export class DecimalParseError extends Error {
  constructor(readonly received: string) {
    super(
      `"${received}" is not a decimal string. Values cross this boundary as decimal strings, ` +
        'never as floats (F05 §4.1) — an exponent, a thousands separator or a locale decimal ' +
        'comma all parse somewhere and none of them hash the same everywhere.',
    );
    this.name = 'DecimalParseError';
  }
}

/**
 * The only door into the decimal layer. Deliberately narrow: it accepts the `decimalString`
 * grammar and nothing else, so `1e3`, `1,000`, `0x10`, `Infinity` and `NaN` are all errors here
 * rather than surprises three steps later inside a trace.
 */
export function dec(value: DecimalString): Dec {
  if (!isDecimalString(value)) throw new DecimalParseError(value);
  return new D(value);
}

/**
 * The canonical exact form of a decimal: no exponent, no trailing zeros, one representation of
 * zero. `1.10` and `1.1` both land on `"1.1"`, which is what makes §4.3's hash invariance a
 * property of the data rather than a convention callers have to remember.
 */
export function exact(value: Dec | DecimalString): DecimalString {
  const d = typeof value === 'string' ? dec(value) : value;
  if (!d.isFinite()) {
    throw new DecimalParseError(d.toString());
  }
  // `toFixed()` with no argument is decimal.js's non-exponential full-precision form. It keeps
  // trailing zeros from the input, so the normalisation below is what actually collapses
  // `1.10` onto `1.1`.
  const text = d.toFixed();
  const normalised = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return normalised === '-0' ? '0' : normalised;
}

// ── Rounding rules ────────────────────────────────────────────────────────────────────────────

/**
 * Named rounding rules. A `MethodRegistryEntry.roundingRule` is one of these ids, never an
 * inline number of decimal places — the Inspector's Precision section has to name the rule that
 * produced the display value, and a rule with no name cannot be named.
 */
export type RoundingRule = {
  readonly id: string;
  readonly decimalPlaces: number;
  readonly mode: 'half_even' | 'half_up' | 'down';
  readonly description: string;
};

const HALF_EVEN = Decimal.ROUND_HALF_EVEN;
const HALF_UP = Decimal.ROUND_HALF_UP;
const DOWN = Decimal.ROUND_DOWN;

export const ROUNDING_RULES: Readonly<Record<string, RoundingRule>> = {
  /** The default for a percentage. Banker's rounding: it does not drift upward over a series. */
  pct_2dp_half_even: {
    id: 'pct_2dp_half_even',
    decimalPlaces: 2,
    mode: 'half_even',
    description: 'two decimal places, round half to even',
  },
  ratio_6dp_half_even: {
    id: 'ratio_6dp_half_even',
    decimalPlaces: 6,
    mode: 'half_even',
    description: 'six decimal places, round half to even',
  },
  /** Ranks and counts. A rank of 4.5 displayed as 5 is a rank that was never observed. */
  int_0dp_half_even: {
    id: 'int_0dp_half_even',
    decimalPlaces: 0,
    mode: 'half_even',
    description: 'whole numbers, round half to even',
  },
  count_0dp_down: {
    id: 'count_0dp_down',
    decimalPlaces: 0,
    mode: 'down',
    description: 'whole numbers, truncated toward zero',
  },
  usd_2dp_half_up: {
    id: 'usd_2dp_half_up',
    decimalPlaces: 2,
    mode: 'half_up',
    description: 'two decimal places, round half away from zero',
  },
};

const MODE_TO_DECIMALJS: Readonly<Record<RoundingRule['mode'], Decimal.Rounding>> = {
  half_even: HALF_EVEN,
  half_up: HALF_UP,
  down: DOWN,
};

export class UnknownRoundingRule extends Error {
  constructor(readonly ruleId: string) {
    super(
      `No rounding rule named '${ruleId}'. The display value has to name the rule that produced ` +
        `it (F05 §4.8 §5), so an unregistered rule is a value the Inspector cannot explain. ` +
        `Known rules: ${Object.keys(ROUNDING_RULES).join(', ')}.`,
    );
    this.name = 'UnknownRoundingRule';
  }
}

export function roundingRule(id: string): RoundingRule {
  const rule = ROUNDING_RULES[id];
  if (rule === undefined) throw new UnknownRoundingRule(id);
  return rule;
}

/**
 * The display value, and only the display value. The exact value is never replaced by this —
 * §4.2 stores both, precisely so a reader can see the difference between what was computed and
 * what was shown.
 */
export function applyRounding(value: Dec | DecimalString, ruleId: string): DecimalString {
  const rule = roundingRule(ruleId);
  const d = typeof value === 'string' ? dec(value) : value;
  return d.toFixed(rule.decimalPlaces, MODE_TO_DECIMALJS[rule.mode]);
}
