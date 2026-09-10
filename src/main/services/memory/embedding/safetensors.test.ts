import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSafetensors, f16Buffer, f32Buffer, f32ToF16 } from './model2vec.fixture';
import {
  bytesPerElement,
  decodeRow,
  f16ToF32,
  parseSafetensorsHeader,
  readSafetensorsHeader,
} from './safetensors';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('f16ToF32', () => {
  it('decodes zero, one, negative, subnormal, inf and nan', () => {
    expect(f16ToF32(0x0000)).toBe(0);
    expect(f16ToF32(0x3c00)).toBe(1);
    expect(f16ToF32(0xc000)).toBe(-2);
    expect(f16ToF32(0x0001)).toBeCloseTo(2 ** -24, 30);
    expect(f16ToF32(0x7c00)).toBe(Number.POSITIVE_INFINITY);
    expect(f16ToF32(0xfc00)).toBe(Number.NEGATIVE_INFINITY);
    expect(f16ToF32(0x7e00)).toBeNaN();
  });

  it('decodes -0, the largest normal and the smallest normal exactly', () => {
    // 0x8000：符号位 1，指数/尾数全 0 → -0
    expect(Object.is(f16ToF32(0x8000), -0)).toBe(true);
    // 0x7BFF：exp=30, mant=0x3FF → (1 + 1023/1024) * 2^15 = 65504
    expect(f16ToF32(0x7bff)).toBe(65504);
    // 0x0400：exp=1, mant=0 → 2^(1-15) = 2^-14 = 0.00006103515625
    expect(f16ToF32(0x0400)).toBe(0.00006103515625);
  });

  it('round-trips through the fixture encoder within f16 precision', () => {
    for (const v of [0.5, -0.25, Math.PI, 1000, -0.001]) {
      expect(f16ToF32(f32ToF16(v))).toBeCloseTo(v, 2);
    }
  });
});

describe('parseSafetensorsHeader', () => {
  it('parses tensors and skips __metadata__', () => {
    const h = parseSafetensorsHeader(
      JSON.stringify({
        __metadata__: { format: 'pt' },
        embeddings: { dtype: 'F16', shape: [3, 2], data_offsets: [0, 12] },
      }),
      100
    );
    expect(h.dataStart).toBe(108);
    expect(h.tensors.embeddings).toEqual({ dtype: 'F16', shape: [3, 2], begin: 0, end: 12 });
    expect(h.tensors.__metadata__).toBeUndefined();
  });

  it('rejects malformed JSON and array-shaped headers at the entry point', () => {
    expect(() => parseSafetensorsHeader('{not json', 9)).toThrow(/not valid JSON/);
    expect(() => parseSafetensorsHeader('[]', 2)).toThrow(/not an object/);
    expect(() => parseSafetensorsHeader('[{"dtype":"F16"}]', 16)).toThrow(/not an object/);
  });

  it('rejects data_offsets that extend past the data area', () => {
    const header = JSON.stringify({ e: { dtype: 'F16', shape: [2], data_offsets: [0, 4] } });
    expect(() => parseSafetensorsHeader(header, header.length, 3)).toThrow(/past end of file/);
    expect(parseSafetensorsHeader(header, header.length, 4).tensors.e.end).toBe(4);
  });

  it('rejects malformed entries', () => {
    expect(() => parseSafetensorsHeader('null', 4)).toThrow();
    expect(() =>
      parseSafetensorsHeader(JSON.stringify({ e: { dtype: 'F16', shape: [1] } }), 1)
    ).toThrow(/malformed/);
    expect(() =>
      parseSafetensorsHeader(
        JSON.stringify({ e: { dtype: 'F16', shape: [-1], data_offsets: [0, 2] } }),
        1
      )
    ).toThrow(/malformed/);
    expect(() =>
      parseSafetensorsHeader(
        JSON.stringify({ e: { dtype: 'F16', shape: [1], data_offsets: [4, 2] } }),
        1
      )
    ).toThrow(/malformed/);
  });
});

describe('readSafetensorsHeader / decodeRow', () => {
  it('reads header from file and decodes F16 and F32 rows', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'enso-safetensors-'));
    const file = path.join(dir, 'm.safetensors');
    writeFileSync(
      file,
      buildSafetensors({
        embeddings: { dtype: 'F16', shape: [2, 2], data: f16Buffer([1, -2, 0.5, 4]) },
        weights: { dtype: 'F32', shape: [2], data: f32Buffer([0.25, 2]) },
      })
    );
    const fd = openSync(file, 'r');
    try {
      const h = readSafetensorsHeader(fd);
      expect(h.tensors.embeddings.shape).toEqual([2, 2]);
      const rowBytes = 2 * bytesPerElement('F16');
      const row = new Float32Array(2);
      const buf = Buffer.alloc(rowBytes);
      readSync(fd, buf, 0, rowBytes, h.dataStart + h.tensors.embeddings.begin + rowBytes);
      decodeRow(buf, 'F16', row);
      expect(Array.from(row)).toEqual([0.5, 4]);
      const w = new Float32Array(2);
      const wbuf = Buffer.alloc(8);
      readSync(fd, wbuf, 0, 8, h.dataStart + h.tensors.weights.begin);
      decodeRow(wbuf, 'F32', w);
      expect(Array.from(w)).toEqual([0.25, 2]);
    } finally {
      closeSync(fd);
    }
  });

  it('rejects files that are too short or claim absurd header sizes', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'enso-safetensors-'));
    const short = path.join(dir, 'short.safetensors');
    writeFileSync(short, Buffer.alloc(3));
    let fd = openSync(short, 'r');
    expect(() => readSafetensorsHeader(fd)).toThrow(/too short/);
    closeSync(fd);

    const huge = path.join(dir, 'huge.safetensors');
    const len = Buffer.alloc(8);
    len.writeBigUInt64LE(BigInt(1024 * 1024 * 1024));
    writeFileSync(huge, len);
    fd = openSync(huge, 'r');
    expect(() => readSafetensorsHeader(fd)).toThrow(/bad header length/);
    closeSync(fd);
  });

  it('rejects a file whose data area is shorter than the header claims', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'enso-safetensors-'));
    const full = buildSafetensors({
      embeddings: { dtype: 'F16', shape: [2, 2], data: f16Buffer([1, 2, 3, 4]) },
    });
    const file = path.join(dir, 'trunc.safetensors');
    writeFileSync(file, full.subarray(0, full.length - 3));
    const fd = openSync(file, 'r');
    try {
      expect(() => readSafetensorsHeader(fd)).toThrow(/past end of file/);
    } finally {
      closeSync(fd);
    }
  });

  it('rejects unsupported dtypes', () => {
    expect(() => bytesPerElement('BF16')).toThrow(/unsupported/);
    expect(() => decodeRow(Buffer.alloc(4), 'I8', new Float32Array(1))).toThrow(/unsupported/);
  });
});
