import fs, { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clipCodePoints, Model2VecModel } from './model2vec';
import { buildSafetensors, f16Buffer, writeTinyModel2Vec } from './model2vec.fixture';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-model2vec-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const norm = (v: Float32Array) => Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));

describe('Model2VecModel', () => {
  it('loads shape from safetensors and exposes dim / vocabSize', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['redis', 'cache'],
      rows: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
    const m = Model2VecModel.load(dir);
    expect(m.dim).toBe(3);
    expect(m.vocabSize).toBe(4);
    m.close();
  });

  it('tokenizes with lowercase, drops unknown tokens and clips to max length', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['redis', 'cache'],
      rows: [
        [1, 0],
        [0, 1],
      ],
    });
    const m = Model2VecModel.load(dir);
    expect(m.tokenize('Redis CACHE unknownword')).toEqual([2, 3]);
    // 先按 maxLength*medianTokenLength(=5) 截字符再切 token（model.py:155-157）：1*5 → 'redis'
    expect(m.tokenize('redis cache redis', 1)).toEqual([2]);
    // 4*5=20 字符 → 'redis cache redis ca'，尾部残词成 unk 被丢
    expect(m.tokenize('redis cache redis cache redis', 4)).toEqual([2, 3, 2]);
    // unk 不占 token 配额：3*5=15 字符 'a b c redis cac' → 只剩 redis
    expect(m.tokenize('a b c redis cache', 3)).toEqual([2]);
    m.close();
  });

  it('mean-pools rows and L2 normalizes when config.normalize=true', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['a', 'b'],
      rows: [
        [2, 0],
        [0, 2],
      ],
    });
    const m = Model2VecModel.load(dir);
    const v = m.embed('a b') as Float32Array;
    expect(norm(v)).toBeCloseTo(1, 5);
    expect(v[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(v[1]).toBeCloseTo(Math.SQRT1_2, 5);
    // 单 token 直接取该行方向
    const a = m.embed('a') as Float32Array;
    expect(Array.from(a)).toEqual([1, 0]);
    m.close();
  });

  it('keeps raw mean when normalize=false', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['a', 'b'],
      rows: [
        [2, 0],
        [0, 4],
      ],
      normalize: false,
    });
    const m = Model2VecModel.load(dir);
    expect(Array.from(m.embed('a b') as Float32Array)).toEqual([1, 2]);
    m.close();
  });

  it('applies per-token weights before pooling', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['a', 'b'],
      rows: [
        [1, 0],
        [0, 1],
      ],
      weights: [3, 1],
      normalize: false,
    });
    const m = Model2VecModel.load(dir);
    expect(Array.from(m.embed('a b') as Float32Array)).toEqual([1.5, 0.5]);
    m.close();
  });

  it('returns null for empty text, whitespace, or text with only unknown tokens', () => {
    writeTinyModel2Vec(dir, { tokens: ['a'], rows: [[1, 0]] });
    const m = Model2VecModel.load(dir);
    expect(m.embed('')).toBeNull();
    expect(m.embed('   ')).toBeNull();
    expect(m.embed('zzz')).toBeNull();
    m.close();
  });

  it('returns null instead of NaN when the pooled vector is all zeros under normalize', () => {
    writeTinyModel2Vec(dir, { tokens: ['zero'], rows: [[0, 0]] });
    const m = Model2VecModel.load(dir);
    expect(m.embed('zero')).toBeNull();
    m.close();
  });

  it('reads F32 weights the same as F16', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['a'],
      rows: [[0.5, -0.25]],
      dtype: 'F32',
      normalize: false,
    });
    const m = Model2VecModel.load(dir);
    expect(Array.from(m.embed('a') as Float32Array)).toEqual([0.5, -0.25]);
    m.close();
  });

  it('is deterministic across the row cache (repeat calls give identical vectors)', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['a', 'b'],
      rows: [
        [1, 2],
        [3, 4],
      ],
    });
    const m = Model2VecModel.load(dir);
    const first = Array.from(m.embed('a b') as Float32Array);
    expect(Array.from(m.embed('a b') as Float32Array)).toEqual(first);
    expect(Array.from(m.embed('b a') as Float32Array)).toEqual(first);
    m.close();
  });

  it('clips by code point like Python `sentence[:n]`, not by UTF-16 unit (Minor 4)', () => {
    expect(clipCodePoints('a\u{1F600}b', 3)).toBe('a\u{1F600}b');
    expect(clipCodePoints('a\u{1F600}b', 2)).toBe('a\u{1F600}');
    expect(clipCodePoints('abc', 5)).toBe('abc');
    writeTinyModel2Vec(dir, {
      tokens: ['a', 'b'],
      rows: [
        [1, 0],
        [0, 1],
      ],
    });
    const m = Model2VecModel.load(dir);
    // 词表长度 [1,1,5,5] → medianTokenLength 3；maxLength 2 → 6 个码点 'a \u{1F600}  b' 完整保留，
    // UTF-16 截 6 个单元会在 b 之前停下
    expect(m.tokenize('a \u{1F600}  b', 2)).toEqual([2, 3]);
    m.close();
  });

  it('throws on a short read instead of pooling zeros from a truncated file (Major 5)', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['a', 'b'],
      rows: [
        [1, 0],
        [0, 1],
      ],
    });
    const file = path.join(dir, 'model.safetensors');
    // 截断文件在 load 时就被 header 校验拒绝
    const size = fs.statSync(file).size;
    truncateSync(file, size - 2);
    expect(() => Model2VecModel.load(dir)).toThrow(/past end of file|truncated/);

    // 加载后才被截断（下载器覆写 / 磁盘损坏）：pread 短读必须报错而不是返回脏向量
    writeTinyModel2Vec(dir, {
      tokens: ['a', 'b'],
      rows: [
        [1, 0],
        [0, 1],
      ],
    });
    const m = Model2VecModel.load(dir);
    truncateSync(file, fs.statSync(file).size - 2);
    expect(() => m.embed('b')).toThrow(/short read/);
    m.close();
  });

  it('row cache is a true LRU: a re-hit row survives eviction (Minor 3)', () => {
    writeTinyModel2Vec(dir, {
      tokens: ['a', 'b', 'c'],
      rows: [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
    });
    const m = Model2VecModel.load(dir, { rowCacheMax: 2 });
    const reads = vi.spyOn(fs, 'readSync');
    m.embed('a'); // miss a
    m.embed('b'); // miss b            cache: a,b
    m.embed('a'); // hit a  → 挖到队尾  cache: b,a
    m.embed('c'); // miss c → 淘汰 b     cache: a,c
    m.embed('a'); // FIFO 会在这里 miss，LRU 命中
    expect(reads).toHaveBeenCalledTimes(3);
    m.embed('b'); // miss b
    expect(reads).toHaveBeenCalledTimes(4);
    reads.mockRestore();
    m.close();
  });

  it('rejects models whose embeddings tensor size does not match its shape', () => {
    writeTinyModel2Vec(dir, { tokens: ['a'], rows: [[1, 0]] });
    writeFileSync(
      path.join(dir, 'model.safetensors'),
      buildSafetensors({ embeddings: { dtype: 'F16', shape: [3, 2], data: f16Buffer([1, 0]) } })
    );
    expect(() => Model2VecModel.load(dir)).toThrow(/size mismatch/);
  });

  it('rejects models without an embeddings tensor or with token_mapping', () => {
    writeTinyModel2Vec(dir, { tokens: ['a'], rows: [[1, 0]] });
    writeFileSync(
      path.join(dir, 'model.safetensors'),
      buildSafetensors({ other: { dtype: 'F16', shape: [1, 2], data: f16Buffer([1, 0]) } })
    );
    expect(() => Model2VecModel.load(dir)).toThrow(/missing embeddings/);

    writeFileSync(
      path.join(dir, 'model.safetensors'),
      buildSafetensors({
        embeddings: { dtype: 'F16', shape: [3, 2], data: f16Buffer([0, 0, 0, 0, 1, 0]) },
        token_mapping: { dtype: 'F32', shape: [3], data: Buffer.alloc(12) },
      })
    );
    expect(() => Model2VecModel.load(dir)).toThrow(/token_mapping/);
  });
});
