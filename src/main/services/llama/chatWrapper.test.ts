import { describe, expect, it, vi } from 'vitest';
import { withoutReasoning } from './chatWrapper';

class FakeReasoningWrapper {
  readonly reasoning: boolean;
  constructor(opts: { reasoning?: boolean } = {}) {
    this.reasoning = opts.reasoning ?? true;
  }
}

class FakePlainWrapper {
  readonly wrapperName = 'plain';
}

/** 构造需要必填参数的 wrapper（如 Jinja 模板），无法只用 {reasoning} 重建 */
class FakeTemplateWrapper {
  readonly reasoning: boolean;
  constructor(opts: { template: string; reasoning?: boolean }) {
    if (!opts.template) throw new Error('template is required');
    this.reasoning = opts.reasoning ?? true;
  }
}

/** Qwen 系用 thoughts 字符串而不是 reasoning 布尔 */
class FakeQwenWrapper {
  readonly thoughts: string;
  constructor(opts: { thoughts?: string } = {}) {
    this.thoughts = opts.thoughts ?? 'auto';
  }
}

describe('withoutReasoning', () => {
  it('discourages thoughts on wrappers that use the Qwen-style switch', () => {
    // Qwen 的开关不叫 reasoning，只认 reasoning 会让 Qwen 系静默继续跑 CoT
    const off = withoutReasoning(new FakeQwenWrapper()) as FakeQwenWrapper;
    expect(off.thoughts).toBe('discourage');
  });

  it('leaves an already discouraged Qwen wrapper alone', () => {
    const already = new FakeQwenWrapper({ thoughts: 'discourage' });
    expect(withoutReasoning(already)).toBe(already);
  });

  it('rebuilds a reasoning wrapper with reasoning turned off', () => {
    // 实测 gemma-4-E2B：开 CoT 65.6s / 1.1 tok/s，关掉 15-18s / 3-4 tok/s。
    // 提炼是结构化抽取，CoT 只烧时间不提升产出。
    const off = withoutReasoning(new FakeReasoningWrapper()) as FakeReasoningWrapper;
    expect(off.reasoning).toBe(false);
  });

  it('leaves wrappers without a reasoning switch untouched', () => {
    const plain = new FakePlainWrapper();
    expect(withoutReasoning(plain)).toBe(plain);
  });

  it('keeps the original when it already has reasoning off', () => {
    const already = new FakeReasoningWrapper({ reasoning: false });
    expect(withoutReasoning(already)).toBe(already);
  });

  it('falls back to the original when rebuilding throws', () => {
    // 宁可保留 CoT 也不能让提炼直接失败
    const tpl = new FakeTemplateWrapper({ template: 'x' });
    expect(withoutReasoning(tpl)).toBe(tpl);
  });

  it('falls back when the rebuilt wrapper did not actually turn it off', () => {
    class Stubborn {
      readonly reasoning = true;
    }
    const stubborn = new Stubborn();
    expect(withoutReasoning(stubborn)).toBe(stubborn);
  });
});
