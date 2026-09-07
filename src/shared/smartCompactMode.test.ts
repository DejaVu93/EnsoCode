import { describe, expect, it } from 'vitest';
import { parseSmartCompactMode } from './smartCompactMode';

describe('parseSmartCompactMode', () => {
  it('只接受扩展档位', () => {
    expect(parseSmartCompactMode('auto')).toBe('auto');
    expect(parseSmartCompactMode('fast')).toBe('fast');
    expect(parseSmartCompactMode('balanced')).toBe('balanced');
    expect(parseSmartCompactMode('thorough')).toBe('thorough');
    expect(parseSmartCompactMode('aggressive')).toBeNull();
    expect(parseSmartCompactMode('')).toBeNull();
    expect(parseSmartCompactMode(undefined)).toBeNull();
  });
});
