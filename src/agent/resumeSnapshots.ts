import { takeSnapshotTail } from '@shared/snapshotTail';
import type { ProjectedMessage } from '@shared/types/agent';
import { projectMessage } from './projection';

export interface ResumeSnapshotPayload {
  messages: ProjectedMessage[];
  baseIndex: number;
}

export function projectMessages(raw: unknown[]): ProjectedMessage[] {
  return raw.map(projectMessage).filter((message): message is ProjectedMessage => message !== null);
}

/** 尾窗立刻给 UI；是否还要全量由调用方在门外投影，避免挡住 prompt。 */
export function projectResumeTail(raw: unknown[]): {
  immediate: ResumeSnapshotPayload;
  deferFull: boolean;
} {
  const window = takeSnapshotTail(raw, raw.length);
  return {
    immediate: {
      messages: projectMessages(window.messages),
      baseIndex: window.baseIndex,
    },
    deferFull: window.baseIndex > 0 || window.messages.length !== raw.length,
  };
}
