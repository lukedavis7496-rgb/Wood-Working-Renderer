import { describe, expect, it } from 'vitest';
import { parseLength, parseLengthList } from '../src/core/units';

describe('parseLength', () => {
  it.each([
    ['1.75', 1.75],
    ['1-3/4', 1.75],
    ['1 3/4', 1.75],
    ['3/4', 0.75],
    ['29-1/4″', 29.25],
    ['36"', 36],
    ['.5', 0.5],
    ['40in', 40],
  ])('%s → %d', (text, value) => expect(parseLength(text)).toBeCloseTo(value));

  it.each(['', 'abc', '1/0', '1.5-1/2', '13/4/2', '-2'])('rejects %s', (text) => expect(parseLength(text)).toBeNull());

  it('reads 13/4 as thirteen quarters, not 1-3/4', () => expect(parseLength('13/4')).toBe(3.25));

  it('parses comma-separated lists', () => {
    expect(parseLengthList('40, 38-1/2, 36')).toEqual([40, 38.5, 36]);
    expect(parseLengthList('40, x')).toBeNull();
  });
});
