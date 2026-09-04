import { describe, expect, it } from 'vitest';
import { dec } from '../../../src/calc/decimal';
import { mad, maxDec, meanDec, median, minDec, populationStdev, sumDec } from '../../../src/calc/stats';

const d = (values: readonly string[]) => values.map(dec);

describe('F06 — decimal statistics', () => {
  it('sums and means exactly', () => {
    expect(sumDec(d(['1', '2', '3'])).toFixed()).toBe('6');
    expect(meanDec(d(['1', '2', '3'])).toFixed()).toBe('2');
  });

  it('takes the middle element for an odd-length array, sorted first', () => {
    expect(median(d(['5', '1', '3'])).toFixed()).toBe('3');
  });

  it('averages the two middle elements for an even-length array', () => {
    expect(median(d(['1', '2', '3', '4'])).toFixed()).toBe('2.5');
  });

  it('returns the single value for a one-element array', () => {
    expect(median(d(['7'])).toFixed()).toBe('7');
  });

  it('computes the median absolute deviation', () => {
    // median = 3; deviations = [2,1,0,1,2]; median of those = 1.
    expect(mad(d(['1', '2', '3', '4', '5'])).toFixed()).toBe('1');
  });

  it('computes population standard deviation exactly for a clean case', () => {
    // values 2,4,4,4,5,5,7,9 — textbook population stdev is exactly 2.
    expect(populationStdev(d(['2', '4', '4', '4', '5', '5', '7', '9'])).toFixed()).toBe('2');
  });

  it('finds max and min without disturbing order-independence', () => {
    expect(maxDec(d(['3', '9', '-2'])).toFixed()).toBe('9');
    expect(minDec(d(['3', '9', '-2'])).toFixed()).toBe('-2');
  });
});
