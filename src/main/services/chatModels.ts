import { rmSync } from 'node:fs';
import path from 'node:path';
import type { ChatModelDto, EmbeddingDownloadProgressDto } from '@shared/memory/dto';
import { app } from 'electron';
import { releaseLocalChatSlot } from './llama/chat';
import {
  type ChatModelSpec,
  chatModelDir,
  listChatModelSpecs,
  resolveChatModelSpec,
} from './llama/chatModels';
import { downloadedBytes, downloadModel, isModelReady } from './memory/embedding/downloader';

/**
 * 本地 chat 模型的显式下载管理。与 memoryModels.ts 同层同模式：
 * 设置页只传 id，路径由 Main 按注册表推导。
 */

type ProgressSink = (progress: EmbeddingDownloadProgressDto) => void;

const running = new Map<string, AbortController>();
let sink: ProgressSink | null = null;
let rootOverride: string | null = null;

export function setChatModelProgressSink(next: ProgressSink | null): void {
  sink = next;
}

/** 仅供测试：指向临时目录，不碰真实 userData */
export function __setChatModelsRootForTest(root: string | null): void {
  rootOverride = root;
}

function modelsRoot(): string {
  return rootOverride ?? path.join(app.getPath('userData'), 'memory', 'chat-models');
}

function modelDir(spec: ChatModelSpec): string {
  return chatModelDir(modelsRoot(), spec);
}

function toDto(spec: ChatModelSpec): ChatModelDto {
  const downloadable = spec.files.length > 0;
  const dir = downloadable ? modelDir(spec) : '';
  const ready = downloadable ? isModelReady(dir, spec) : true;
  return {
    id: spec.id,
    label: spec.label,
    params: spec.params,
    contextSize: spec.contextSize,
    approxBytes: spec.approxBytes,
    downloadedBytes: downloadable ? downloadedBytes(dir, spec) : 0,
    state: !downloadable
      ? 'ready'
      : running.has(spec.id)
        ? 'downloading'
        : ready
          ? 'ready'
          : 'missing',
    downloadable,
  };
}

export function listChatModels(): ChatModelDto[] {
  return listChatModelSpecs().map(toDto);
}

export function chatModelsRoot(): string {
  return modelsRoot();
}

export async function startChatModelDownload(modelId: string): Promise<boolean> {
  const spec = resolveChatModelSpec(modelId);
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

export function cancelChatModelDownload(modelId: string): boolean {
  const controller = running.get(modelId);
  if (!controller) return false;
  controller.abort();
  running.delete(modelId);
  return true;
}

/** 删除已下载权重；正在下载的先取消。必须等 KV/模型槽释放完再 rm，否则 Windows 上 mmap 会让删除失败。 */
export async function deleteChatModel(modelId: string): Promise<boolean> {
  const spec = resolveChatModelSpec(modelId);
  if (!spec || spec.files.length === 0) return false;
  cancelChatModelDownload(modelId);
  await releaseLocalChatSlot();
  try {
    rmSync(modelDir(spec), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
