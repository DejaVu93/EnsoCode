/**
 * 向量后处理。抽成共享模块是为了让 onnx 与 gguf 两个运行时产出的向量口径完全一致——
 * 归一化或截断口径不同不会报错，只会让检索质量悄悄劣化，很难发现。
 */

/** MRL 截断后再 L2 归一化（截断改变模长，必须重归一）；零向量返回 null */
export function finalize(vec: Float32Array, truncateDim: number | null): Float32Array | null {
  const v = truncateDim !== null && truncateDim < vec.length ? vec.slice(0, truncateDim) : vec;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm === 0) return null;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
