import { describe, expect, it } from 'vitest';
import type { SettingsCategory } from './constants';
import { isCategoryVisible, resolveActiveCategory, visibleCategories } from './settingsCategories';

const cats = [
  { id: 'general' as SettingsCategory },
  { id: 'tools' as SettingsCategory },
  { id: 'memory' as SettingsCategory },
  { id: 'usage' as SettingsCategory },
];

describe('visibleCategories', () => {
  it('hides the memory page while the memory tool is off', () => {
    expect(visibleCategories(cats, ['memory']).map((c) => c.id)).toEqual([
      'general',
      'tools',
      'usage',
    ]);
  });

  it('shows it once the tool is enabled', () => {
    expect(visibleCategories(cats, []).map((c) => c.id)).toContain('memory');
  });

  it('never hides pages that do not depend on a tool', () => {
    const ids = visibleCategories(cats, ['memory', 'browser', 'isolated_sandbox']).map((c) => c.id);
    expect(ids).toEqual(['general', 'tools', 'usage']);
  });
});

describe('resolveActiveCategory', () => {
  it('falls back to Built-in tools when the active page just got hidden', () => {
    // 落在能把它重新打开的地方，而不是通用页
    expect(resolveActiveCategory('memory', ['memory'])).toBe('tools');
  });

  it('leaves the active page alone when it is still visible', () => {
    expect(resolveActiveCategory('memory', [])).toBe('memory');
    expect(resolveActiveCategory('usage', ['memory'])).toBe('usage');
  });

  it('also catches a deep link pointing at a disabled feature', () => {
    // deeplink 可能来自通知/外部跳转，指向一个当前没启用的功能
    expect(resolveActiveCategory('memory', ['memory'])).toBe('tools');
  });
});

describe('isCategoryVisible', () => {
  it('treats an unrelated disabled tool as irrelevant', () => {
    expect(isCategoryVisible('memory', ['browser'])).toBe(true);
  });
});
