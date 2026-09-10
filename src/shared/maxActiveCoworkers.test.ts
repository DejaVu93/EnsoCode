import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_ACTIVE_COWORKERS,
  MAX_MAX_ACTIVE_COWORKERS,
  MIN_MAX_ACTIVE_COWORKERS,
  normalizeMaxActiveCoworkers,
  parseMaxActiveCoworkers,
} from './maxActiveCoworkers';

describe('normalizeMaxActiveCoworkers', () => {
  it('缺省、脏值和小数都回落到 5', () => {
    expect(DEFAULT_MAX_ACTIVE_COWORKERS).toBe(5);
    expect(normalizeMaxActiveCoworkers(undefined)).toBe(5);
    expect(normalizeMaxActiveCoworkers(null)).toBe(5);
    expect(normalizeMaxActiveCoworkers('5')).toBe(5);
    expect(normalizeMaxActiveCoworkers(5.5)).toBe(5);
    expect(normalizeMaxActiveCoworkers(Number.NaN)).toBe(5);
  });

  it('整数夹到 1–20', () => {
    expect(normalizeMaxActiveCoworkers(1)).toBe(MIN_MAX_ACTIVE_COWORKERS);
    expect(normalizeMaxActiveCoworkers(8)).toBe(8);
    expect(normalizeMaxActiveCoworkers(0)).toBe(MIN_MAX_ACTIVE_COWORKERS);
    expect(normalizeMaxActiveCoworkers(-3)).toBe(MIN_MAX_ACTIVE_COWORKERS);
    expect(normalizeMaxActiveCoworkers(99)).toBe(MAX_MAX_ACTIVE_COWORKERS);
  });
});

describe('parseMaxActiveCoworkers', () => {
  it('只接受闭区间内的整数', () => {
    expect(parseMaxActiveCoworkers(1)).toBe(1);
    expect(parseMaxActiveCoworkers(20)).toBe(20);
    expect(parseMaxActiveCoworkers(0)).toBeNull();
    expect(parseMaxActiveCoworkers(21)).toBeNull();
    expect(parseMaxActiveCoworkers(5.5)).toBeNull();
    expect(parseMaxActiveCoworkers('5')).toBeNull();
  });
});
