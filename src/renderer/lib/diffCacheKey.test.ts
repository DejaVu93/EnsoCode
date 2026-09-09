import { describe, expect, it } from 'vitest';
import { diffCacheKey } from './diffCacheKey';

describe('diffCacheKey', () => {
  it('同名同内容 → 同 key（worker 池可复用高亮）', () => {
    expect(diffCacheKey('a.ts', 'x', 'y')).toBe(diffCacheKey('a.ts', 'x', 'y'));
  });

  it('同名不同内容 → 不同 key（避免命中旧高亮结果）', () => {
    const base = diffCacheKey('a.ts', 'x', 'y');
    expect(diffCacheKey('a.ts', 'x', 'z')).not.toBe(base);
    expect(diffCacheKey('a.ts', 'w', 'y')).not.toBe(base);
  });

  it('old/new 互换 → 不同 key', () => {
    expect(diffCacheKey('a.ts', 'x', 'y')).not.toBe(diffCacheKey('a.ts', 'y', 'x'));
  });

  it('不同文件名 → 不同 key', () => {
    expect(diffCacheKey('a.ts', 'x', 'y')).not.toBe(diffCacheKey('b.ts', 'x', 'y'));
  });
});
