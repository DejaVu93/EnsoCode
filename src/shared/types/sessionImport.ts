/** 外部应用的会话条目（列表展示用） */
export interface ExternalSession {
  /** 会话文件绝对路径，作为唯一标识 */
  path: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export type ExternalSessionSourceId =
  | 'claude-code'
  | 'codex'
  | 'grok'
  | 'cursor'
  | 'pi'
  | 'oh-my-pi'
  | 'factory'
  | 'opencode'
  | 'gemini-cli';

export interface ExternalSessionSource {
  sourceId: ExternalSessionSourceId;
  sourceName: string;
  sessions: ExternalSession[];
}

/** 预览与导入用的拉平消息：只保留文本轮次 */
export interface SimpleMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: number;
}
