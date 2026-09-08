import type { convertToLlm } from '@earendil-works/pi-coding-agent';

/** pi-agent-core 不是直接依赖，从 convertToLlm 的入参反推消息类型。 */
export type AgentMessage = Parameters<typeof convertToLlm>[0][number];

export interface CompactBranchEntry {
  id?: string;
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
    toolCallId?: string;
    tool_call_id?: string;
    usage?: {
      totalTokens?: number;
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
    stopReason?: string;
  };
}

export interface CompactFacts {
  goal: string;
  constraints: string[];
  errors: string[];
  /** 所有提及的路径 */
  files: string[];
  readFiles: string[];
  modifiedFiles: string[];
  completedTodos: string[];
  activeTodos: string[];
  openLoops: string[];
}

export interface FileOpsLike {
  read: Iterable<string>;
  written: Iterable<string>;
  edited: Iterable<string>;
}

export interface CompactSummaryModelRef {
  provider: string;
  id: string;
}

export interface EnsoCompactOptions {
  mode?: 'auto' | 'fast' | 'balanced' | 'thorough';
  summaryModel?: CompactSummaryModelRef | null;
}
