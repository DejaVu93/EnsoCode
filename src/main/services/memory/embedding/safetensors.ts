import fs from 'node:fs';

export interface SafetensorsTensor {
  dtype: string;
  shape: number[];
  /** 相对数据区起点的字节偏移 */
  begin: number;
  end: number;
}

export interface SafetensorsHeader {
  tensors: Record<string, SafetensorsTensor>;
  /** 数据区在文件内的绝对起点 = 8 + header 长度 */
  dataStart: number;
}

// 格式：8 字节 uint64 LE = header 长度，随后 JSON header，随后数据区
const HEADER_LEN_BYTES = 8;
const MAX_HEADER_BYTES = 100 * 1024 * 1024;

/**
 * @param dataSize 数据区字节数（文件长 - dataStart）；给定时拒绝 data_offsets 越界的张量，截断文件在这里就报错
 */
export function parseSafetensorsHeader(
  headerJson: string,
  headerLen: number,
  dataSize?: number
): SafetensorsHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(headerJson);
  } catch {
    throw new Error('safetensors: header is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('safetensors: header is not an object');
  const tensors: Record<string, SafetensorsTensor> = {};
  for (const [name, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (name === '__metadata__') continue;
    const t = raw as { dtype?: unknown; shape?: unknown; data_offsets?: unknown };
    const offsets = t.data_offsets;
    if (
      typeof t.dtype !== 'string' ||
      !Array.isArray(t.shape) ||
      !t.shape.every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !Array.isArray(offsets) ||
      offsets.length !== 2 ||
      !offsets.every((n) => Number.isSafeInteger(n) && n >= 0) ||
      offsets[0] > offsets[1]
    ) {
      throw new Error(`safetensors: malformed tensor entry "${name}"`);
    }
    if (dataSize !== undefined && (offsets[1] as number) > dataSize) {
      throw new Error(`safetensors: tensor "${name}" extends past end of file (truncated?)`);
    }
    tensors[name] = {
      dtype: t.dtype,
      shape: t.shape as number[],
      begin: offsets[0] as number,
      end: offsets[1] as number,
    };
  }
  return { tensors, dataStart: HEADER_LEN_BYTES + headerLen };
}

export function readSafetensorsHeader(fd: number): SafetensorsHeader {
  const lenBuf = Buffer.alloc(HEADER_LEN_BYTES);
  if (fs.readSync(fd, lenBuf, 0, HEADER_LEN_BYTES, 0) !== HEADER_LEN_BYTES) {
    throw new Error('safetensors: file too short');
  }
  const len = lenBuf.readBigUInt64LE(0);
  if (len <= 0n || len > BigInt(MAX_HEADER_BYTES))
    throw new Error('safetensors: bad header length');
  const headerLen = Number(len);
  const header = Buffer.alloc(headerLen);
  if (fs.readSync(fd, header, 0, headerLen, HEADER_LEN_BYTES) !== headerLen) {
    throw new Error('safetensors: truncated header');
  }
  const dataStart = HEADER_LEN_BYTES + headerLen;
  const fileSize = fs.fstatSync(fd).size;
  if (fileSize < dataStart) throw new Error('safetensors: truncated header');
  return parseSafetensorsHeader(header.toString('utf8'), headerLen, fileSize - dataStart);
}

/** IEEE 754 binary16 → binary32，覆盖 ±0、次正规数、±Inf、NaN */
export function f16ToF32(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

export function bytesPerElement(dtype: string): number {
  if (dtype === 'F32') return 4;
  if (dtype === 'F16') return 2;
  throw new Error(`safetensors: unsupported dtype ${dtype}`);
}

/** 把一段原始张量字节解码成 f32；`dtype` 只支持 F32/F16 */
export function decodeRow(buf: Buffer, dtype: string, out: Float32Array): void {
  if (dtype === 'F32') {
    for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
    return;
  }
  if (dtype === 'F16') {
    for (let i = 0; i < out.length; i++) out[i] = f16ToF32(buf.readUInt16LE(i * 2));
    return;
  }
  throw new Error(`safetensors: unsupported dtype ${dtype}`);
}
