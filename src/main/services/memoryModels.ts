import { rmSync } from 'node:fs';
import path from 'node:path';
import type { EmbeddingDownloadProgressDto, EmbeddingModelDto } from '@shared/memory/dto';
import { app } from 'electron';
import { downloadedBytes, downloadModel, isModelReady } from './memory/embedding/downloader';
import {
  embeddingModelDirName,
  listEmbeddingModelSpecs,
  resolveEmbeddingModelSpec,
} from './memory/embedding/registry';
import type { EmbeddingModelSpec } from './memory/embedding/types';

/**
 * 嵌入模型的显式下载管理。`memoryHost` 的 autoDownload 是「用到时顺手拉」，
 * 这里是设置页主动触发的那条路径：可看状态、可取消、可删除。两者共用同一缓存目录。
 */

type ProgressSink = (progress: EmbeddingDownloadProgressDto) => void;

const running = new Map<string, AbortController>();
let sink: ProgressSink | null = null;

/** 由接线层注入，用于把进度推给设置窗；未注入时下载静默进行 */
export function setEmbeddingProgressSink(next: ProgressSink | null): void {
  sink = next;
}

function modelDir(spec: EmbeddingModelSpec): string {
  return path.join(app.getPath('userData'), 'memory', 'models', embeddingModelDirName(spec));
}

function toDto(spec: EmbeddingModelSpec): EmbeddingModelDto {
  const downloadable = spec.files.length > 0;
  const dir = downloadable ? modelDir(spec) : '';
  const ready = downloadable ? isModelReady(dir, spec) : true;
  return {
    id: spec.id,
    runtime: spec.runtime,
    dim: spec.dim,
    approxBytes: spec.approxBytes,
    downloadedBytes: downloadable ? downloadedBytes(dir, spec) : 0,
    state: !downloadable
      ? 'unavailable'
      : running.has(spec.id)
        ? 'downloading'
        : ready
          ? 'ready'
          : 'missing',
    downloadable,
  };
}

export function listEmbeddingModels(): EmbeddingModelDto[] {
  return listEmbeddingModelSpecs().map(toDto);
}

/** 已在下载中则复用那一次；不可下载的档（none / remote）直接返回 false */
export async function startEmbeddingModelDownload(modelId: string): Promise<boolean> {
  const spec = resolveEmbeddingModelSpec(modelId);
  if (!spec || spec.files.length === 0 || running.has(modelId)) return false;
  const controller = new AbortController();
  running.set(modelId, controller);
  try {
    await downloadModel(spec, modelDir(spec), {
      signal: controller.signal,
      onProgress: (p) => sink?.({ modelId, ...p }),
    });
    sink?.({ modelId, file: '', fileIndex: 0, fileCount: 0, received: 0, total: null, done: true });
    return true;
  } catch (error) {
    sink?.({
      modelId,
      file: '',
      fileIndex: 0,
      fileCount: 0,
      received: 0,
      total: null,
      done: true,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    running.delete(modelId);
  }
}

export function cancelEmbeddingModelDownload(modelId: string): boolean {
  const controller = running.get(modelId);
  if (!controller) return false;
  controller.abort();
  running.delete(modelId);
  return true;
}

/** 删除已下载权重；正在下载的先取消。部分文件已被占用时按失败返回，不留半个目录 */
export function deleteEmbeddingModel(modelId: string): boolean {
  const spec = resolveEmbeddingModelSpec(modelId);
  if (!spec || spec.files.length === 0) return false;
  cancelEmbeddingModelDownload(modelId);
  try {
    rmSync(modelDir(spec), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
