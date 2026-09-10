import { describe, expect, it } from 'vitest';
import {
  IMPORTANCE_CRITICAL,
  IMPORTANCE_IMPORTANT,
  IMPORTANCE_USEFUL,
  importanceTier,
} from './constants';
import { DISTILL_THREAD_PROMPT } from './prompts';

describe('importanceTier', () => {
  it('maps each band to the tier the prompt describes', () => {
    expect(importanceTier(1)).toBe('critical');
    expect(importanceTier(0.9)).toBe('critical');
    expect(importanceTier(0.89)).toBe('important');
    expect(importanceTier(0.7)).toBe('important');
    expect(importanceTier(0.69)).toBe('useful');
    expect(importanceTier(0.5)).toBe('useful');
    expect(importanceTier(0.49)).toBe('low');
    expect(importanceTier(0)).toBe('low');
  });

  it('treats garbage as low instead of trusting it', () => {
    // importance 来自模型输出，坏值不该让列表炸掉。
    // Infinity 特意归到 low 而不是 critical：它只可能来自 bug 或脏输入，
    // 把不可信的值显示成最高优先级会直接误导用户。
    expect(importanceTier(Number.NaN)).toBe('low');
    expect(importanceTier(Number.POSITIVE_INFINITY)).toBe('low');
    expect(importanceTier(-1)).toBe('low');
  });

  it('keeps the UI bands identical to what the prompt tells the model', () => {
    // 界面分档和打分标准漂移不会报错，只会让显示骗人：
    // 从提示词原文里解析出阈值，和常量对照。
    const line = DISTILL_THREAD_PROMPT.split('\n').find((l) => l.startsWith('importance:'));
    expect(line, 'prompt must still document the importance bands').toBeTruthy();
    const numbers = (line as string).match(/\d+\.\d+/g)?.map(Number) ?? [];
    // 原文形如：0.9+ critical; 0.7-0.9 important; 0.5-0.7 useful; <0.5 omit
    expect(numbers).toContain(IMPORTANCE_CRITICAL);
    expect(numbers).toContain(IMPORTANCE_IMPORTANT);
    expect(numbers).toContain(IMPORTANCE_USEFUL);
  });
});
