import { describe, expect, it } from 'vitest';
import { decorateMermaidSvg } from './mermaidSvg';

describe('decorateMermaidSvg', () => {
  it('给根 svg 加上不可聚焦，避免插入后被 scrollIntoView 吸走聊天滚动', () => {
    const out = decorateMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(out).toContain('focusable="false"');
    expect(out).toContain('tabindex="-1"');
  });

  it('已有 focusable 不重复改', () => {
    const src = '<svg focusable="false"></svg>';
    expect(decorateMermaidSvg(src)).toBe(src);
  });
});
