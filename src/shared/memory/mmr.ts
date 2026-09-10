export interface MmrItem {
  /** 最终混合分（已排序，越大越相关） */
  score: number;
  /** L2 归一化向量；无向量 / 模型不同则 null */
  vec: Float32Array | null;
}

/**
 * Maximal Marginal Relevance 贪心选取，返回被选条目在输入中的下标（按选中顺序）。
 * 相似度用余弦（库内向量已归一化 → 点积）；任一侧无向量或维度不同视为不可比，sim=0，
 * 即只惩罚「确实有向量证明相近」的冗余，纯 FTS 场景退化为原序（显式降级策略，见 search.test.ts）。
 */
export function mmrRerank(items: readonly MmrItem[], limit: number, lambda: number): number[] {
  const n = Math.min(limit, items.length);
  if (n <= 0) return [];
  const selected: number[] = [];
  const maxSim = new Array<number>(items.length).fill(0);
  const remaining = new Set(items.map((_, i) => i));
  while (selected.length < n) {
    let best = -1;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const i of remaining) {
      const value = lambda * items[i].score - (1 - lambda) * maxSim[i];
      // 平分时保留输入顺序（输入已按分数稳定排序）
      if (value > bestValue) {
        bestValue = value;
        best = i;
      }
    }
    selected.push(best);
    remaining.delete(best);
    const chosen = items[best].vec;
    if (!chosen) continue;
    for (const i of remaining) {
      const v = items[i].vec;
      if (!v || v.length !== chosen.length) continue;
      let dot = 0;
      for (let k = 0; k < v.length; k++) dot += v[k] * chosen[k];
      if (dot > maxSim[i]) maxSim[i] = dot;
    }
  }
  return selected;
}
