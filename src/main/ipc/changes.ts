import path from 'node:path';
import { IPC_CHANNELS } from '@shared/types';
import { app, ipcMain } from 'electron';
import {
  liveConversationIds,
  pruneSnapshots,
  readSnapshots,
  writeSnapshots,
} from '../services/changesSnapshots';
import { readSettings } from './settings';

const snapshotsDir = (): string => path.join(app.getPath('userData'), 'changes-snapshots');

function conversationIdOf(request: unknown): string | null {
  const id = (request as { conversationId?: unknown } | null)?.conversationId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function snapshotsOf(request: unknown): Record<string, string> {
  const raw = (request as { snapshots?: unknown } | null)?.snapshots;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** 已删除会话的快照文件在首次访问时清一次；读不到会话表宁可不删 */
let pruned = false;
function pruneOnce(): void {
  if (pruned) return;
  pruned = true;
  const live = liveConversationIds(readSettings());
  if (live) pruneSnapshots(snapshotsDir(), live);
}

export function registerChangesHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.CHANGES_SNAPSHOTS_READ,
    (_event, request: unknown): Record<string, string> => {
      pruneOnce();
      const id = conversationIdOf(request);
      return id ? readSnapshots(snapshotsDir(), id) : {};
    }
  );

  ipcMain.handle(IPC_CHANNELS.CHANGES_SNAPSHOTS_WRITE, (_event, request: unknown): boolean => {
    pruneOnce();
    const id = conversationIdOf(request);
    return id ? writeSnapshots(snapshotsDir(), id, snapshotsOf(request)) : false;
  });
}
