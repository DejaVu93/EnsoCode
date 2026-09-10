import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 按 safetensors 格式拼文件：8 字节 LE 长度 + JSON header + 数据区 */
export function buildSafetensors(
  tensors: Record<string, { dtype: 'F32' | 'F16'; shape: number[]; data: Buffer }>
): Buffer {
  const header: Record<string, unknown> = {};
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const [name, t] of Object.entries(tensors)) {
    header[name] = {
      dtype: t.dtype,
      shape: t.shape,
      data_offsets: [offset, offset + t.data.length],
    };
    chunks.push(t.data);
    offset += t.data.length;
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([len, json, ...chunks]);
}

export function f32ToF16(v: number): number {
  const f = new Float32Array([v]);
  const x = new Uint32Array(f.buffer)[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 0x1f) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >> 13);
}

export function f16Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => {
    buf.writeUInt16LE(f32ToF16(v), i * 2);
  });
  return buf;
}

export function f32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => {
    buf.writeFloatLE(v, i * 4);
  });
  return buf;
}

export interface TinyModelOptions {
  /** 词表（不含 [PAD]/[UNK]，二者固定占 id 0/1） */
  tokens: string[];
  /** 每 token 一行，长度 = dim */
  rows: number[][];
  weights?: number[];
  normalize?: boolean;
  dtype?: 'F32' | 'F16';
  tokenizerConfig?: Record<string, unknown>;
  /** 为真：加 `[EOS]`（id = tokens.length + 2）并用 TemplateProcessing 在序列末尾追加，模拟 qwen3 类 tokenizer */
  appendEos?: boolean;
}

/**
 * 在 dir 下生成一个最小 model2vec 模型：WordPiece tokenizer（BertNormalizer lowercase + BertPreTokenizer）、
 * `embeddings` 张量、可选 `weights`。id 0=[PAD] 1=[UNK]，其后按 tokens 顺序。
 */
export function writeTinyModel2Vec(dir: string, opts: TinyModelOptions): void {
  mkdirSync(dir, { recursive: true });
  const vocab: Record<string, number> = { '[PAD]': 0, '[UNK]': 1 };
  opts.tokens.forEach((t, i) => {
    vocab[t] = i + 2;
  });
  const eosId = opts.tokens.length + 2;
  if (opts.appendEos) vocab['[EOS]'] = eosId;
  const dim = opts.rows[0]?.length ?? 0;
  const allRows = [
    new Array(dim).fill(0),
    new Array(dim).fill(0),
    ...opts.rows,
    ...(opts.appendEos ? [new Array(dim).fill(0)] : []),
  ];
  const dtype = opts.dtype ?? 'F16';
  const flat = allRows.flat();
  const tensors: Parameters<typeof buildSafetensors>[0] = {
    embeddings: {
      dtype,
      shape: [allRows.length, dim],
      data: dtype === 'F16' ? f16Buffer(flat) : f32Buffer(flat),
    },
  };
  if (opts.weights) {
    tensors.weights = {
      dtype: 'F32',
      shape: [allRows.length],
      data: f32Buffer([0, 0, ...opts.weights]),
    };
  }
  writeFileSync(path.join(dir, 'model.safetensors'), buildSafetensors(tensors));
  writeFileSync(
    path.join(dir, 'tokenizer.json'),
    JSON.stringify({
      version: '1.0',
      truncation: null,
      padding: null,
      added_tokens: [
        { id: 0, content: '[PAD]', special: true },
        { id: 1, content: '[UNK]', special: true },
        ...(opts.appendEos ? [{ id: eosId, content: '[EOS]', special: true }] : []),
      ],
      normalizer: {
        type: 'BertNormalizer',
        clean_text: true,
        handle_chinese_chars: true,
        strip_accents: null,
        lowercase: true,
      },
      pre_tokenizer: { type: 'BertPreTokenizer' },
      post_processor: opts.appendEos
        ? {
            type: 'TemplateProcessing',
            single: [
              { Sequence: { id: 'A', type_id: 0 } },
              { SpecialToken: { id: '[EOS]', type_id: 0 } },
            ],
            pair: [
              { Sequence: { id: 'A', type_id: 0 } },
              { SpecialToken: { id: '[EOS]', type_id: 0 } },
              { Sequence: { id: 'B', type_id: 1 } },
              { SpecialToken: { id: '[EOS]', type_id: 1 } },
            ],
            special_tokens: { '[EOS]': { id: '[EOS]', ids: [eosId], tokens: ['[EOS]'] } },
          }
        : null,
      decoder: { type: 'WordPiece', prefix: '##', cleanup: true },
      model: {
        type: 'WordPiece',
        unk_token: '[UNK]',
        continuing_subword_prefix: '##',
        max_input_chars_per_word: 100,
        vocab,
      },
    })
  );
  if (opts.tokenizerConfig) {
    writeFileSync(path.join(dir, 'tokenizer_config.json'), JSON.stringify(opts.tokenizerConfig));
  }
  writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ model_type: 'model2vec', normalize: opts.normalize ?? true })
  );
}
