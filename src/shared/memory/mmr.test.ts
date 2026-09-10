import { describe, expect, it } from 'vitest';
import { MMR_LAMBDA } from './constants';
import { mmrRerank } from './mmr';

const v = (...xs: number[]) => Float32Array.from(xs);

describe('mmrRerank', () => {
  it('λ=0.7：三条近似 + 一条异题，limit=2 时把异题捞进第二位', () => {
    // 相关度递减 1, .95, .9, .6；前三条向量几乎相同，第四条正交
    const items = [
      { score: 1, vec: v(1, 0) },
      { score: 0.95, vec: v(0.99, 0.14) },
      { score: 0.9, vec: v(0.98, 0.2) },
      { score: 0.6, vec: v(0, 1) },
    ];
    expect(mmrRerank(items, 2, MMR_LAMBDA)).toEqual([0, 3]);
    // λ=1 退化为纯相关度排序
    expect(mmrRerank(items, 2, 1)).toEqual([0, 1]);
  });

  it('limit ≥ 条数时只重排不丢条；首位永远是相关度最高者', () => {
    const items = [
      { score: 0.5, vec: v(1, 0) },
      { score: 0.9, vec: v(1, 0) },
      { score: 0.7, vec: v(0, 1) },
    ];
    expect(mmrRerank(items, 10, MMR_LAMBDA)).toEqual([1, 2, 0]);
  });

  it('无向量的条目不参与相似度惩罚（sim=0），全部无向量时保持原序', () => {
    const none = [
      { score: 1, vec: null },
      { score: 0.9, vec: null },
      { score: 0.8, vec: null },
    ];
    expect(mmrRerank(none, 2, MMR_LAMBDA)).toEqual([0, 1]);
    // 维度不同的向量不可比，也按 sim=0 处理
    const mixed = [
      { score: 1, vec: v(1, 0) },
      { score: 0.95, vec: v(1, 0, 0) },
      { score: 0.9, vec: v(1, 0) },
    ];
    expect(mmrRerank(mixed, 2, MMR_LAMBDA)).toEqual([0, 1]);
  });

  it('空输入 / limit 0 → 空', () => {
    expect(mmrRerank([], 3, MMR_LAMBDA)).toEqual([]);
    expect(mmrRerank([{ score: 1, vec: null }], 0, MMR_LAMBDA)).toEqual([]);
  });
});
