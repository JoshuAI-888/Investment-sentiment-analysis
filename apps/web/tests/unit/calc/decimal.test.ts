import { describe, expect, it } from 'vitest';
import {
  applyRounding,
  D,
  dec,
  DecimalParseError,
  exact,
  isDecimalString,
  ROUNDING_RULES,
  roundingRule,
  UnknownRoundingRule,
  WORKING_PRECISION,
} from '../../../src/calc/decimal';

describe('F05 §4.1 — decimal arithmetic exactness', () => {
  it('adds the numbers IEEE 754 gets wrong', () => {
    // The canonical demonstration. `0.1 + 0.2 === 0.30000000000000004` in every JS runtime, and
    // a metric built on that is a metric whose last digits are an artefact of the hardware.
    expect(exact(dec('0.1').plus(dec('0.2')))).toBe('0.3');
  });

  it('multiplies without drift', () => {
    expect(exact(dec('1.005').times(dec('100')))).toBe('100.5');
  });

  it('divides to the configured working precision, not to a float', () => {
    const third = dec('1').div(dec('3'));
    expect(exact(third)).toMatch(/^0\.3{34}$/);
    expect(exact(third)).toHaveLength('0.'.length + WORKING_PRECISION);
  });

  it('pins the working precision to a named standard', () => {
    // 34 is decimal128's coefficient length. A comfortable round number is one somebody later
    // adjusts by taste, and every stored result_hash computed before the adjustment stops
    // reproducing.
    expect(WORKING_PRECISION).toBe(34);
    expect(D.precision).toBe(34);
  });

  it('never reaches for exponential notation', () => {
    // `1e-7` and `0.0000001` are the same number and different strings. The canonical form has
    // to be one of them, deterministically.
    expect(exact(dec('0.0000001'))).toBe('0.0000001');
    expect(exact(dec('100000000000000000000000'))).toBe('100000000000000000000000');
  });
});

describe('F05 §4.3 — the canonical exact form', () => {
  it('collapses 1.10 onto 1.1', () => {
    expect(exact('1.10')).toBe(exact('1.1'));
    expect(exact('1.10')).toBe('1.1');
  });

  it('collapses every spelling of zero', () => {
    for (const spelling of ['0', '0.0', '0.000', '-0', '-0.0']) {
      expect(exact(spelling), spelling).toBe('0');
    }
  });

  it('keeps trailing significant digits', () => {
    expect(exact('1.01')).toBe('1.01');
    expect(exact('10')).toBe('10');
  });
});

describe('F05 §4.1 — the boundary refuses floats', () => {
  it.each(['1e3', '1,000', '0x10', 'Infinity', 'NaN', '', ' 1', '1.', '+1', '1,5'])(
    'rejects %o',
    (value) => {
      expect(() => dec(value)).toThrow(DecimalParseError);
    },
  );

  it.each(['0', '-0', '1', '-1', '1.5', '-1.5', '000123', '0.000000000000000000001'])(
    'accepts %o',
    (value) => {
      expect(isDecimalString(value)).toBe(true);
      expect(() => dec(value)).not.toThrow();
    },
  );
});

describe('F05 §4.8 §5 — named rounding rules', () => {
  it('rounds half to even, which does not drift upward over a series', () => {
    expect(applyRounding('0.125', 'pct_2dp_half_even')).toBe('0.12');
    expect(applyRounding('0.135', 'pct_2dp_half_even')).toBe('0.14');
  });

  it('rounds half away from zero where the rule says so', () => {
    expect(applyRounding('0.125', 'usd_2dp_half_up')).toBe('0.13');
  });

  it('keeps the display width the rule names, including trailing zeros', () => {
    // The display value is presentation. Unlike the exact value it does NOT drop trailing
    // zeros — "1.50" and "1.5" say different things about precision to a reader.
    expect(applyRounding('1.5', 'pct_2dp_half_even')).toBe('1.50');
  });

  it('refuses an unregistered rule rather than picking a default', () => {
    expect(() => applyRounding('1', 'two_dp_ish')).toThrow(UnknownRoundingRule);
  });

  it('every registered rule is self-consistent about its own id', () => {
    for (const [id, rule] of Object.entries(ROUNDING_RULES)) {
      expect(rule.id).toBe(id);
      expect(roundingRule(id)).toBe(rule);
    }
  });
});
