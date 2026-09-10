import { describe, expect, it, vi } from 'vitest';
import type { LlamaEmbeddingContextLike, LlamaModelLike } from '../../llama/runtime';
import { createGgufEmbeddingProvider } from './gguf';
import type { EmbeddingModelSpec } from './types';

const spec: EmbeddingModelSpec = {
  id: 'local:qwen3-0.6b-gguf',
  runtime: 'gguf',
  dim: 512,
  prefix: { passage: '', query: 'Query: ' },
  approxBytes: 0,
  files: [{ name: 'model.gguf' }],
  gguf: { file: 'model.gguf', maxTokens: 512, truncateDim: 512 },
  sources: null,
};

/** 造一个可预测的假 embedding：第 i 维 = i+1，便于验证截断与归一化 */
function ramp(dim: number): number[] {
  return Array.from({ length: dim }, (_, i) => i + 1);
}

function fakeModel(opts: {
  vectorFor?: (input: string) => number[];
  seen?: string[];
  onDispose?: () => void;
}): LlamaModelLike {
  const ctx: LlamaEmbeddingContextLike = {
    getEmbeddingFor: vi.fn(async (input: string) => {
      opts.seen?.push(input);
      return { vector: opts.vectorFor?.(input) ?? ramp(1024) };
    }),
    dispose: vi.fn(async () => opts.onDispose?.()),
  };
  return {
    createEmbeddingContext: vi.fn(async () => ctx),
    dispose: vi.fn(async () => {}),
  } as unknown as LlamaModelLike;
}

function provider(model: LlamaModelLike, override: Partial<EmbeddingModelSpec> = {}) {
  return createGgufEmbeddingProvider(
    { ...spec, ...override },
    { modelDir: '/models/qwen3', acquire: async () => model }
  );
}

describe('createGgufEmbeddingProvider', () => {
  it('returns one L2-normalized vector per input', async () => {
    const p = await provider(fakeModel({}));
    const [vec] = await p.embed(['hello'], 'passage');
    expect(vec).not.toBeNull();
    let norm = 0;
    for (const x of vec as Float32Array) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it('normalizes vectors that arrive un-normalized from llama.cpp', async () => {
    // 实测 node-llama-cpp 返回原始模长（bge-small 约 9.0），不是单位向量。
    // 少了这步，余弦表会退化成点积，长文本天然得分更高。
    const p = await provider(fakeModel({ vectorFor: () => new Array(1024).fill(3) }));
    const [vec] = await p.embed(['hello'], 'passage');
    let norm = 0;
    for (const x of vec as Float32Array) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it('applies MRL truncation to the configured dim', async () => {
    const p = await provider(fakeModel({}));
    const [vec] = await p.embed(['hello'], 'passage');
    // 存库维度必须等于 spec.dim，否则写入时维度不匹配
    expect(vec?.length).toBe(512);
  });

  it('uses the full vector when truncateDim is null', async () => {
    const p = await provider(fakeModel({}), {
      gguf: { file: 'model.gguf', maxTokens: 512, truncateDim: null },
    });
    const [vec] = await p.embed(['hello'], 'passage');
    expect(vec?.length).toBe(1024);
  });

  it('adds the query prefix only for queries', async () => {
    const seen: string[] = [];
    const p = await provider(fakeModel({ seen }));
    await p.embed(['find me'], 'query');
    await p.embed(['store me'], 'passage');
    // Qwen3-Embedding 模型卡：只有查询侧加 instruction，写入侧不加
    expect(seen).toEqual(['Query: find me', 'store me']);
  });

  it('returns null for blank input without calling the model', async () => {
    const seen: string[] = [];
    const p = await provider(fakeModel({ seen }));
    const out = await p.embed(['', '   ', '\n'], 'passage');
    expect(out).toEqual([null, null, null]);
    expect(seen).toEqual([]);
  });

  it('keeps result positions aligned when some inputs are blank', async () => {
    const p = await provider(fakeModel({}));
    const out = await p.embed(['a', '', 'b'], 'passage');
    // 位置错位会把向量安到别的记忆上，且不会报错
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).not.toBeNull();
  });

  it('returns null for an all-zero vector instead of storing it', async () => {
    const p = await provider(fakeModel({ vectorFor: () => new Array(1024).fill(0) }));
    const [vec] = await p.embed(['hello'], 'passage');
    // 零向量归一化会产生 NaN，落库后污染检索
    expect(vec).toBeNull();
  });

  it('reuses one embedding context across calls', async () => {
    const model = fakeModel({});
    const p = await provider(model);
    await p.embed(['a'], 'passage');
    await p.embed(['b'], 'passage');
    expect(model.createEmbeddingContext).toHaveBeenCalledTimes(1);
  });

  it('disposes the context on close', async () => {
    const onDispose = vi.fn();
    const p = await provider(fakeModel({ onDispose }));
    await p.embed(['a'], 'passage');
    p.close?.();
    await vi.waitFor(() => expect(onDispose).toHaveBeenCalled());
  });

  it('rejects a spec without gguf settings', async () => {
    await expect(
      createGgufEmbeddingProvider(
        { ...spec, gguf: undefined },
        { modelDir: '/models/x', acquire: async () => fakeModel({}) }
      )
    ).rejects.toThrow(/gguf/i);
  });
});
