import { describe, expect, it } from 'vitest';
import { expandTemporalRange, normalizeTemporalDate, rangesIntersect } from './temporal';

describe('normalizeTemporalDate', () => {
  it('normalizes year', () => {
    expect(normalizeTemporalDate('2020')).toEqual(['2020-01-01', 'year']);
  });

  it('normalizes month and day', () => {
    expect(normalizeTemporalDate('2020-03')).toEqual(['2020-03-01', 'month']);
    expect(normalizeTemporalDate('2020-03-05')).toEqual(['2020-03-05', 'day']);
  });

  it('trims whitespace', () => {
    expect(normalizeTemporalDate(' 2021-12 ')).toEqual(['2021-12-01', 'month']);
  });

  it('returns [null, null] for null / empty / invalid input', () => {
    expect(normalizeTemporalDate(null)).toEqual([null, null]);
    expect(normalizeTemporalDate(undefined)).toEqual([null, null]);
    expect(normalizeTemporalDate('')).toEqual([null, null]);
    expect(normalizeTemporalDate('   ')).toEqual([null, null]);
    expect(normalizeTemporalDate('abc')).toEqual([null, null]);
    expect(normalizeTemporalDate('2020-13')).toEqual([null, null]);
    expect(normalizeTemporalDate('2020-02-30')).toEqual([null, null]);
    expect(normalizeTemporalDate('2020-3-5')).toEqual([null, null]);
    expect(normalizeTemporalDate('20201')).toEqual([null, null]);
    // year 必须在 1000–9999
    expect(normalizeTemporalDate('0999')).toEqual([null, null]);
    expect(normalizeTemporalDate('0999-01')).toEqual([null, null]);
  });
});

describe('expandTemporalRange', () => {
  it('expands year to the whole year', () => {
    expect(expandTemporalRange('2020-01-01', 'year')).toEqual(['2020-01-01', '2020-12-31']);
  });

  it('expands month to the whole month, respecting leap years', () => {
    expect(expandTemporalRange('2020-02-01', 'month')).toEqual(['2020-02-01', '2020-02-29']);
    expect(expandTemporalRange('2021-02-01', 'month')).toEqual(['2021-02-01', '2021-02-28']);
    expect(expandTemporalRange('2021-12-01', 'month')).toEqual(['2021-12-01', '2021-12-31']);
  });

  it('expands day to itself', () => {
    expect(expandTemporalRange('2020-03-05', 'day')).toEqual(['2020-03-05', '2020-03-05']);
  });
});

describe('rangesIntersect', () => {
  it('detects closed-interval overlap', () => {
    expect(rangesIntersect('2020-01-01', '2020-12-31', '2020-06-01', '2020-06-30')).toBe(true);
    expect(rangesIntersect('2020-06-01', '2020-06-30', '2020-01-01', '2020-12-31')).toBe(true);
    expect(rangesIntersect('2020-01-01', '2020-06-30', '2020-06-30', '2020-12-31')).toBe(true);
  });

  it('rejects disjoint ranges', () => {
    expect(rangesIntersect('2020-01-01', '2020-06-29', '2020-06-30', '2020-12-31')).toBe(false);
    expect(rangesIntersect('2021-01-01', '2021-12-31', '2020-01-01', '2020-12-31')).toBe(false);
  });

  it('matches a year-precision event against a query year', () => {
    const [start, end] = expandTemporalRange('2020-01-01', 'year');
    const [qs, qe] = expandTemporalRange('2020-01-01', 'year');
    expect(rangesIntersect(start, end, qs, qe)).toBe(true);
  });
});
