import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DownloadProgress,
  downloadedBytes,
  downloadModel,
  fileUrl,
  isModelReady,
  ModelDownloadError,
} from './downloader';
import type { EmbeddingModelSpec } from './types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-model-dl-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const BODY = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'.repeat(10));
const SHA = createHash('sha256').update(BODY).digest('hex');
const ENDPOINTS = { huggingface: 'http://hf.test', modelscope: 'http://ms.test' } as const;

const spec = (over: Partial<EmbeddingModelSpec> = {}): EmbeddingModelSpec => ({
  id: 'local:tiny',
  runtime: 'model2vec',
  dim: 2,
  prefix: { passage: '', query: '' },
  approxBytes: BODY.length,
  files: [{ name: 'model.safetensors', sha256: SHA }, { name: 'sub/config.json' }],
  sources: { huggingface: 'org/tiny', modelscope: 'org/tiny' },
  ...over,
});

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** 模拟支持 Range 的静态文件服务；`hooks` 可按 host 注入故障 */
function server(hooks: Partial<Record<string, Handler>> = {}) {
  const calls: { url: string; range: string | null }[] = [];
  const doFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, range: headers.get('range') });
    const host = new URL(url).host;
    const hook = hooks[host];
    if (hook) return hook(url, init ?? {});
    const range = headers.get('range');
    if (range) {
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      if (start >= BODY.length) return new Response(null, { status: 416 });
      return new Response(BODY.subarray(start), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${BODY.length - 1}/${BODY.length}` },
      });
    }
    return new Response(BODY, {
      status: 200,
      headers: { 'content-length': String(BODY.length) },
    });
  };
  return { fetch: doFetch, calls };
}

const base = { endpoints: ENDPOINTS, retryDelayMs: 0 };

describe('fileUrl', () => {
  it('builds HF and ModelScope resolve URLs and encodes nested names', () => {
    expect(fileUrl('huggingface', 'org/m', 'onnx/model q.onnx', ENDPOINTS)).toBe(
      'http://hf.test/org/m/resolve/main/onnx/model%20q.onnx'
    );
    expect(fileUrl('modelscope', 'org/m', 'a.json', ENDPOINTS)).toBe(
      'http://ms.test/models/org/m/resolve/master/a.json'
    );
    expect(fileUrl('huggingface', 'org/m', 'a.json')).toMatch(/^https:\/\/huggingface\.co\//);
  });
});

describe('downloadModel', () => {
  it('downloads all files from HF, verifies sha256, writes .ready and reports progress', async () => {
    const s = server();
    const progress: DownloadProgress[] = [];
    const sp = spec();
    expect(isModelReady(dir, sp)).toBe(false);
    await downloadModel(sp, dir, { ...base, fetch: s.fetch, onProgress: (p) => progress.push(p) });
    expect(isModelReady(dir, sp)).toBe(true);
    expect(readFileSync(path.join(dir, 'model.safetensors'))).toEqual(BODY);
    expect(existsSync(path.join(dir, 'sub', 'config.json'))).toBe(true);
    expect(s.calls.every((c) => c.url.startsWith('http://hf.test/'))).toBe(true);
    const last = progress.at(-1);
    expect(last).toMatchObject({ file: 'sub/config.json', fileIndex: 1, fileCount: 2 });
    expect(last?.received).toBe(BODY.length);
    expect(readdirSync(dir).some((f) => f.endsWith('.part'))).toBe(false);
  });

  it('falls back to ModelScope when HF fails', async () => {
    const s = server({ 'hf.test': () => new Response('nope', { status: 503 }) });
    await downloadModel(spec(), dir, { ...base, fetch: s.fetch, maxAttempts: 1 });
    expect(isModelReady(dir, spec())).toBe(true);
    expect(s.calls.some((c) => c.url.startsWith('http://ms.test/'))).toBe(true);
  });

  it('throws all_sources_failed and leaves no partial file when every source fails', async () => {
    const s = server({
      'hf.test': () => new Response('x', { status: 500 }),
      'ms.test': () => new Response('x', { status: 500 }),
    });
    await expect(
      downloadModel(spec(), dir, { ...base, fetch: s.fetch, maxAttempts: 1 })
    ).rejects.toMatchObject({ code: 'all_sources_failed' });
    expect(isModelReady(dir, spec())).toBe(false);
    expect(existsSync(path.join(dir, 'model.safetensors'))).toBe(false);
  });

  it('resumes from an existing .part with a Range request', async () => {
    const s = server();
    writeFileSync(path.join(dir, 'model.safetensors.part'), BODY.subarray(0, 100));
    expect(downloadedBytes(dir, spec())).toBe(100);
    await downloadModel(spec(), dir, { ...base, fetch: s.fetch });
    expect(s.calls[0].range).toBe('bytes=100-');
    expect(readFileSync(path.join(dir, 'model.safetensors'))).toEqual(BODY);
  });

  it('restarts from scratch when the server ignores Range (200 instead of 206)', async () => {
    const s = server({
      'hf.test': () =>
        new Response(BODY, { status: 200, headers: { 'content-length': String(BODY.length) } }),
    });
    writeFileSync(path.join(dir, 'model.safetensors.part'), Buffer.from('garbage'));
    await downloadModel(spec(), dir, { ...base, fetch: s.fetch });
    expect(readFileSync(path.join(dir, 'model.safetensors'))).toEqual(BODY);
  });

  it('detects a corrupt .part via sha256, discards it and re-downloads from scratch', async () => {
    const s = server();
    // 与真身等长但内容错误：Range 请求返回 416（带 Content-Range 总长），长度对得上，只能靠 sha256 识别
    writeFileSync(path.join(dir, 'model.safetensors.part'), Buffer.alloc(BODY.length, 1));
    await downloadModel(spec(), dir, { ...base, fetch: s.fetch, maxAttempts: 1 });
    expect(s.calls[0].range).toBe(`bytes=${BODY.length}-`);
    expect(s.calls[1].range).toBeNull();
    expect(readFileSync(path.join(dir, 'model.safetensors'))).toEqual(BODY);
    expect(existsSync(path.join(dir, 'model.safetensors.part'))).toBe(false);
  });

  it('416 on a short .part is never accepted: Content-Range length mismatch forces a fresh download (Major 1)', async () => {
    // 网关对一切 Range 回 416，但能报总长；本地只有 100 字节，不得改名为成品
    const s = server({
      'hf.test': (_url, init) => {
        const range = new Headers(init.headers).get('range');
        if (range) {
          return new Response(null, {
            status: 416,
            headers: { 'content-range': `bytes */${BODY.length}` },
          });
        }
        return new Response(BODY, {
          status: 200,
          headers: { 'content-length': String(BODY.length) },
        });
      },
    });
    const noSha = spec({ files: [{ name: 'sub/config.json' }] });
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'config.json.part'), BODY.subarray(0, 100), { flag: 'w' });
    await downloadModel(noSha, dir, { ...base, fetch: s.fetch, maxAttempts: 2 });
    expect(s.calls.map((c) => c.range)).toEqual(['bytes=100-', null]);
    expect(readFileSync(path.join(dir, 'sub', 'config.json'))).toEqual(BODY);
  });

  it('416 without Content-Range falls back to HEAD; only an exactly-complete .part is kept (Major 1)', async () => {
    const hook: Handler = (_url, init) => {
      if (init.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': String(BODY.length) },
        });
      }
      if (new Headers(init.headers).get('range')) return new Response(null, { status: 416 });
      return new Response(BODY, {
        status: 200,
        headers: { 'content-length': String(BODY.length) },
      });
    };
    const noSha = spec({ files: [{ name: 'sub/config.json' }] });
    mkdirSync(path.join(dir, 'sub'));
    const part = path.join(dir, 'sub', 'config.json.part');

    // 短 .part：丢掉重下
    let s = server({ 'hf.test': hook });
    writeFileSync(part, BODY.subarray(0, 50), { flag: 'w' });
    await downloadModel(noSha, dir, { ...base, fetch: s.fetch, maxAttempts: 2 });
    expect(s.calls.map((c) => c.range)).toEqual(['bytes=50-', null, null]);
    expect(readFileSync(path.join(dir, 'sub', 'config.json'))).toEqual(BODY);

    // 完整 .part：长度核对通过后才改名，不重下
    rmSync(path.join(dir, 'sub', 'config.json'));
    s = server({ 'hf.test': hook });
    writeFileSync(part, BODY, { flag: 'w' });
    await downloadModel(noSha, dir, { ...base, fetch: s.fetch, maxAttempts: 1 });
    expect(s.calls.map((c) => c.range)).toEqual([`bytes=${BODY.length}-`, null]);
    expect(readFileSync(path.join(dir, 'sub', 'config.json'))).toEqual(BODY);
  });

  it('416 where the remote length is unknowable discards the .part instead of trusting it (Major 1)', async () => {
    const s = server({
      'hf.test': (_url, init) => {
        if (init.method === 'HEAD') return new Response(null, { status: 405 });
        if (new Headers(init.headers).get('range')) return new Response(null, { status: 416 });
        return new Response(BODY, {
          status: 200,
          headers: { 'content-length': String(BODY.length) },
        });
      },
    });
    const noSha = spec({ files: [{ name: 'sub/config.json' }] });
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'config.json.part'), BODY.subarray(0, 7), { flag: 'w' });
    await downloadModel(noSha, dir, { ...base, fetch: s.fetch, maxAttempts: 2 });
    expect(readFileSync(path.join(dir, 'sub', 'config.json'))).toEqual(BODY);
  });

  it('re-verifies existing files with sha256 and re-downloads a corrupt one (Major 3)', async () => {
    const s = server();
    writeFileSync(path.join(dir, 'model.safetensors'), Buffer.alloc(BODY.length, 7));
    writeFileSync(path.join(dir, '.ready'), '{}');
    await downloadModel(spec(), dir, { ...base, fetch: s.fetch });
    expect(s.calls.map((c) => c.url)).toEqual([
      'http://hf.test/org/tiny/resolve/main/model.safetensors',
      'http://hf.test/org/tiny/resolve/main/sub/config.json',
    ]);
    expect(readFileSync(path.join(dir, 'model.safetensors'))).toEqual(BODY);
  });

  it('an abort that lands mid-stream is reported as aborted, with no retry or source switch (Major 2)', async () => {
    const ac = new AbortController();
    const s = server({
      'hf.test': (_url, init) => {
        const signal = init.signal as AbortSignal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(BODY.subarray(0, 10));
            signal.addEventListener('abort', () =>
              controller.error(new DOMException('The operation was aborted.', 'AbortError'))
            );
            // 头一块到达后用户点了取消
            queueMicrotask(() => ac.abort());
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-length': String(BODY.length) },
        });
      },
    });
    await expect(
      downloadModel(spec(), dir, { ...base, fetch: s.fetch, signal: ac.signal, maxAttempts: 3 })
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].url.startsWith('http://hf.test/')).toBe(true);
    expect(existsSync(path.join(dir, 'model.safetensors'))).toBe(false);
  });

  it('fails with all_sources_failed when every source serves a corrupt file', async () => {
    const bad = () =>
      new Response(Buffer.alloc(BODY.length, 1), {
        status: 200,
        headers: { 'content-length': String(BODY.length) },
      });
    const s = server({ 'hf.test': bad, 'ms.test': bad });
    await expect(
      downloadModel(spec(), dir, { ...base, fetch: s.fetch, maxAttempts: 1 })
    ).rejects.toMatchObject({ code: 'all_sources_failed' });
    expect(existsSync(path.join(dir, 'model.safetensors.part'))).toBe(false);
    expect(existsSync(path.join(dir, 'model.safetensors'))).toBe(false);
  });

  it('fails when the body is shorter than Content-Length', async () => {
    const s = server({
      'hf.test': () =>
        new Response(BODY.subarray(0, 10), {
          status: 200,
          headers: { 'content-length': String(BODY.length) },
        }),
      'ms.test': () => new Response('x', { status: 500 }),
    });
    await expect(
      downloadModel(spec(), dir, { ...base, fetch: s.fetch, maxAttempts: 1 })
    ).rejects.toBeInstanceOf(ModelDownloadError);
    expect(existsSync(path.join(dir, 'model.safetensors'))).toBe(false);
  });

  it('skips files already present and clears a stale .ready before starting', async () => {
    const s = server();
    writeFileSync(path.join(dir, 'model.safetensors'), BODY);
    writeFileSync(path.join(dir, '.ready'), '{}');
    await downloadModel(spec(), dir, { ...base, fetch: s.fetch });
    expect(s.calls.map((c) => c.url)).toEqual([
      'http://hf.test/org/tiny/resolve/main/sub/config.json',
    ]);
  });

  it('honours an aborted signal without retrying or switching source', async () => {
    const s = server();
    const ac = new AbortController();
    ac.abort();
    await expect(
      downloadModel(spec(), dir, { ...base, fetch: s.fetch, signal: ac.signal })
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(s.calls).toHaveLength(0);
  });

  it('refuses specs with no sources or files escaping the model dir', async () => {
    await expect(downloadModel(spec({ sources: null }), dir)).rejects.toMatchObject({
      code: 'no_sources',
    });
    await expect(
      downloadModel(spec({ files: [{ name: '../evil' }] }), dir, { ...base, fetch: server().fetch })
    ).rejects.toThrow(/escapes/);
  });

  it('isModelReady is false while only .part files exist', () => {
    writeFileSync(path.join(dir, 'model.safetensors.part'), BODY.subarray(0, 5));
    expect(isModelReady(dir, spec())).toBe(false);
  });
});
