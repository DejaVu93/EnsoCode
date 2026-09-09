import { describe, expect, it } from 'vitest';
import { useI18n } from './i18n';

describe('phone useI18n', () => {
  it('t 跨调用身份稳定，避免 MermaidRenderer 等依赖 t 的 effect 反复重绘', () => {
    expect(useI18n().t).toBe(useI18n().t);
  });
});
