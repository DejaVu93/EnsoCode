import path from 'node:path';
import { acquireModel, type LlamaModelLike } from '../../llama/runtime';
import type { EmbedKind } from '../types';
import { withPrefix } from './prefix';
import type { EmbeddingModelSpec, EmbeddingProvider } from './types';
import { finalize } from './vector';

export interface GgufProviderContext {
  modelDir: string;
  /** 测试注入；生产走 runtime 的模型槽 */
  acquire?: (modelPath: string) => Promise<LlamaModelLike>;
}

/**
 * llama.cpp 驱动的 embedding。相比 onnx 路径省掉了外部 tokenizer 和手写池化：
 * GGUF 内嵌 tokenizer，池化由模型元数据（pooling_type）决定，llama.cpp 直接吐句向量。
 *
 * 向量口径：必须走共享的 finalize（MRL 截断 + L2 归一化）。
 * 实测 node-llama-cpp 返回的是**未归一化**的原始句向量（bge-small 实测模长约 9.0），
 * 与「llama.cpp 默认 --embd-normalize 2」的直觉相反；不归一化会让余弦距离表退化成点积，
 * 长文本天然得分更高。这条不要凭直觉改。
 */
export async function createGgufEmbeddingProvider(
  spec: EmbeddingModelSpec,
  ctx: GgufProviderContext
): Promise<EmbeddingProvider> {
  const cfg = spec.gguf;
  if (!cfg) throw new Error(`embedding: ${spec.id} has no gguf settings`);

  const modelPath = path.join(ctx.modelDir, cfg.file);
  const acquire = ctx.acquire ?? ((p: string) => acquireModel('embedding', p));
  const model = await acquire(modelPath);

  // 上下文持有 KV cache，建一次复用：每条记忆都新建会让吞吐掉一个数量级。
  // contextSize 取模型训练长度与 maxTokens 的较小值，交给 llama.cpp 按显存自适应。
  const context = await model.createEmbeddingContext({
    contextSize: { max: cfg.maxTokens },
  });

  return {
    spec,
    async embed(texts: string[], kind: EmbedKind): Promise<(Float32Array | null)[]> {
      const out: (Float32Array | null)[] = new Array(texts.length).fill(null);
      for (const [index, text] of texts.entries()) {
        if (!text.trim()) continue;
        // 超长截断交给 llama.cpp（按 contextSize），不在这里按字符猜 token 数
        const embedding = await context.getEmbeddingFor(withPrefix(spec, kind, text));
        out[index] = finalize(Float32Array.from(embedding.vector), cfg.truncateDim);
      }
      return out;
    },
    close: () => {
      void context.dispose();
    },
  };
}
