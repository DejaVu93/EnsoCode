import path from 'node:path';
import { type SessionEntry, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';
import { takeSnapshotTail } from '@shared/snapshotTail';
import type { ProjectedMessage } from '@shared/types/agent';
import { projectMessage } from '../../agent/projection';

export function resolveParentHistoryFile(
  sessionDir: string,
  sessionFile: string | undefined
): string | null {
  if (!sessionFile) return null;
  const root = path.resolve(sessionDir);
  const resolved = path.resolve(sessionFile);
  const within = resolved === root || resolved.startsWith(`${root}${path.sep}`);
  return within ? resolved : null;
}

export function projectParentHistoryTail(branch: readonly SessionEntry[]): {
  messages: ProjectedMessage[];
  baseIndex: number;
} {
  const raw = branch.flatMap(sessionEntryToContextMessages);
  const window = takeSnapshotTail(raw, raw.length);
  return {
    messages: window.messages
      .map(projectMessage)
      .filter((message): message is ProjectedMessage => message !== null),
    baseIndex: window.baseIndex,
  };
}
