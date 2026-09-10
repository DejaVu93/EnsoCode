import fs from 'node:fs';
import path from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import { bytesPerElement, decodeRow, readSafetensorsHeader } from './safetensors';

// 算法照 model2vec/model.py:147-174（tokenize）与 426-442（_encode_batch）：
// 先按 max_length*median_token_length 截字符 → 无特殊符号 tokenize → 去 unk → 截 max_length →
// 查表（可选乘 weights）→ 平均池化 → 可选 L2 归一化。纯查表，无前向。
const DEFAULT_MAX_LENGTH = 512;
// 嵌入矩阵不整块进内存（potion-multilingual F32 达 512MB），按行 pread + 小 LRU
const ROW_CACHE_MAX = 4096;

interface Model2VecConfig {
  normalize: boolean;
}

export interface Model2VecLoadOptions {
  /** 行缓存上限；测试用小值观察淘汰 */
  rowCacheMax?: number;
}

/** Python `sentence[:n]` 按码点截，JS slice 按 UTF-16：emoji/增补平面字符要按码点对齐 */
export function clipCodePoints(text: string, n: number): string {
  if (text.length <= n) return text;
  let count = 0;
  let i = 0;
  while (i < text.length && count < n) {
    i += text.codePointAt(i)! > 0xffff ? 2 : 1;
    count++;
  }
  return text.slice(0, i);
}

export class Model2VecModel {
  readonly dim: number;
  readonly vocabSize: number;
  private readonly rowCache = new Map<number, Float32Array>();
  private readonly rowBytes: number;
  private readonly medianTokenLength: number;
  private readonly rowCacheMax: number;

  private constructor(
    private readonly fd: number,
    private readonly tokenizer: Tokenizer,
    private readonly rowsOffset: number,
    private readonly dtype: string,
    shape: [number, number],
    private readonly weights: Float32Array | null,
    private readonly unkId: number | null,
    private readonly config: Model2VecConfig,
    rowCacheMax: number
  ) {
    [this.vocabSize, this.dim] = shape;
    this.rowCacheMax = Math.max(1, rowCacheMax);
    this.rowBytes = this.dim * bytesPerElement(dtype);
    const lengths = Array.from(tokenizer.get_vocab().keys(), (t) => t.length).sort((a, b) => a - b);
    // model.py:76 `int(np.median(...))`：偶数长度取均值再截断
    const mid = lengths.length >> 1;
    this.medianTokenLength =
      lengths.length === 0
        ? 1
        : lengths.length % 2
          ? lengths[mid]
          : Math.trunc((lengths[mid - 1] + lengths[mid]) / 2);
  }

  static load(dir: string, opts: Model2VecLoadOptions = {}): Model2VecModel {
    const tokJson = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8'));
    const tokConfigPath = path.join(dir, 'tokenizer_config.json');
    const tokConfig = fs.existsSync(tokConfigPath)
      ? JSON.parse(fs.readFileSync(tokConfigPath, 'utf8'))
      : {};
    const tokenizer = new Tokenizer(tokJson, tokConfig);
    const rawConfig = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) as {
      normalize?: unknown;
    };
    const config: Model2VecConfig = { normalize: rawConfig.normalize === true };

    const fd = fs.openSync(path.join(dir, 'model.safetensors'), 'r');
    try {
      const header = readSafetensorsHeader(fd);
      const emb = header.tensors.embeddings;
      if (emb?.shape.length !== 2) throw new Error('model2vec: missing embeddings tensor');
      const [vocab, dim] = emb.shape;
      if (emb.end - emb.begin !== vocab * dim * bytesPerElement(emb.dtype)) {
        throw new Error('model2vec: embeddings size mismatch');
      }
      // header 层已按文件长校验 data_offsets；这里再断言一次，避免上游改动后截断文件溣到 pread
      if (header.dataStart + emb.end > fs.fstatSync(fd).size) {
        throw new Error('model2vec: model.safetensors is truncated');
      }
      let weights: Float32Array | null = null;
      const w = header.tensors.weights;
      if (w) {
        if (w.shape.length !== 1 || w.shape[0] !== vocab) {
          throw new Error('model2vec: weights shape mismatch');
        }
        const buf = Buffer.alloc(w.end - w.begin);
        fs.readSync(fd, buf, 0, buf.length, header.dataStart + w.begin);
        weights = new Float32Array(vocab);
        decodeRow(buf, w.dtype, weights);
      }
      if (header.tensors.token_mapping) {
        throw new Error('model2vec: vocabulary-quantized models (token_mapping) are not supported');
      }
      return new Model2VecModel(
        fd,
        tokenizer,
        header.dataStart + emb.begin,
        emb.dtype,
        [vocab, dim],
        weights,
        resolveUnkId(tokJson, tokenizer),
        config,
        opts.rowCacheMax ?? ROW_CACHE_MAX
      );
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }

  close(): void {
    fs.closeSync(this.fd);
    this.rowCache.clear();
  }

  tokenize(text: string, maxLength = DEFAULT_MAX_LENGTH): number[] {
    const clipped = clipCodePoints(text, maxLength * this.medianTokenLength);
    const ids = this.tokenizer.encode(clipped, { add_special_tokens: false }).ids;
    const kept = ids.filter((id) => id !== this.unkId && id >= 0 && id < this.vocabSize);
    return kept.slice(0, maxLength);
  }

  /** 空文本 / 全 unknown → null（零向量对余弦检索无意义，这里不产出向量） */
  embed(text: string): Float32Array | null {
    const ids = this.tokenize(text);
    if (ids.length === 0) return null;
    const sum = new Float64Array(this.dim);
    for (const id of ids) {
      const row = this.row(id);
      const w = this.weights ? this.weights[id] : 1;
      for (let i = 0; i < this.dim; i++) sum[i] += row[i] * w;
    }
    const out = new Float32Array(this.dim);
    let norm = 0;
    for (let i = 0; i < this.dim; i++) {
      out[i] = sum[i] / ids.length;
      norm += out[i] * out[i];
    }
    if (this.config.normalize) {
      norm = Math.sqrt(norm);
      if (norm === 0) return null;
      for (let i = 0; i < this.dim; i++) out[i] /= norm;
    }
    return out;
  }

  private row(id: number): Float32Array {
    const cached = this.rowCache.get(id);
    if (cached) {
      // 命中挖到队尾，Map 迭代序才是真正的 LRU；否则热 token 会被先挤出
      this.rowCache.delete(id);
      this.rowCache.set(id, cached);
      return cached;
    }
    const buf = Buffer.alloc(this.rowBytes);
    const n = fs.readSync(this.fd, buf, 0, this.rowBytes, this.rowsOffset + id * this.rowBytes);
    // 短读会把 0 当成权重算进均值，产出看似正常的脏向量；必须报错
    if (n !== this.rowBytes) {
      throw new Error(`model2vec: short read for row ${id} (${n}/${this.rowBytes} bytes)`);
    }
    const row = new Float32Array(this.dim);
    decodeRow(buf, this.dtype, row);
    if (this.rowCache.size >= this.rowCacheMax) {
      this.rowCache.delete(this.rowCache.keys().next().value as number);
    }
    this.rowCache.set(id, row);
    return row;
  }
}

// model.py:70-74：只当 tokenizer.model 暴露 unk_token（WordPiece/BPE）才去 unk；Unigram 只有 unk_id，
// 不去 unk 时 [UNK] 行参与平均——与 Python 结果可比
function resolveUnkId(tokJson: unknown, tokenizer: Tokenizer): number | null {
  const model = (tokJson as { model?: { unk_token?: unknown } }).model;
  if (typeof model?.unk_token === 'string') return tokenizer.token_to_id(model.unk_token) ?? null;
  return null;
}
