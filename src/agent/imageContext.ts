/**
 * 发给模型的上下文里，历史轮次的图片换成文本占位。
 *
 * 背景：图片一旦进了 toolResult / user 消息，之后每一轮请求都会原样重发。
 * 有的 provider（如 anthropic-messages 兼容代理）按 base64 字符计 token，一张 1.7MB 的
 * read 结果就是百万级 tokens，直接 `Input token limit exceeded`；而 pi 的 compaction
 * 切点算法对图片按固定 1200 tokens 估算，会把这几张图当成"便宜"的尾巴保留下来，
 * 压缩多少次都无法解困。
 *
 * 策略沿用业界通行做法（Anthropic clear_tool_uses、opencode 媒体占位、image-context-cascade）：
 * - 只改 `context` 钩子里的消息副本，jsonl / 时间线一字不动；
 * - 当前轮（最后一条 user 消息及之后）的图片原样保留，模型看得到刚读的图；
 * - 历史轮工具结果里的图片全部换占位，占位写明工具名 / 路径 / mime，需要时可以再 read；
 * - 用户自己贴的图保留最近 `KEEP_USER_IMAGE_TURNS` 条 user 消息里的，更早的换占位；
 * - 无法判定当前轮（没有 user 消息）时 fail-open，不动。
 */

export interface ContextMessage {
  role: string;
  content?: unknown;
  toolCallId?: string;
  toolName?: string;
  [key: string]: unknown;
}

interface ImageBlock {
  type: 'image';
  data?: string;
  mimeType?: string;
}

interface ToolCallBlock {
  type: 'toolCall';
  id?: string;
  name?: string;
  arguments?: unknown;
}

const KEEP_USER_IMAGE_TURNS = 2;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isImage = (b: unknown): b is ImageBlock => isRecord(b) && b.type === 'image';
const isToolCall = (b: unknown): b is ToolCallBlock => isRecord(b) && b.type === 'toolCall';
const hasImage = (m: ContextMessage): boolean =>
  Array.isArray(m.content) && m.content.some(isImage);

function pathOfCall(call: ToolCallBlock | undefined): string | undefined {
  const args = call?.arguments;
  if (!isRecord(args)) return undefined;
  const path = args.path ?? args.file ?? args.filePath;
  return typeof path === 'string' && path.length > 0 ? path : undefined;
}

function placeholder(block: ImageBlock, source: string): { type: 'text'; text: string } {
  const mime = block.mimeType ?? 'image';
  return {
    type: 'text',
    text: `[image omitted from context: ${mime}${source ? `, ${source}` : ''} — already seen earlier in this conversation; re-read the file if you need it again]`,
  };
}

function replaceImages(message: ContextMessage, source: string): ContextMessage {
  const content = (message.content as unknown[]).map((b) =>
    isImage(b) ? placeholder(b, source) : b
  );
  return { ...message, content };
}

export function pruneHistoricalImages(messages: ContextMessage[]): ContextMessage[] {
  let lastUserIndex = -1;
  const userIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') {
      userIndices.push(i);
      lastUserIndex = i;
    }
  }
  if (lastUserIndex < 0) return messages;
  const keepUserFrom =
    userIndices.length > KEEP_USER_IMAGE_TURNS
      ? userIndices[userIndices.length - KEEP_USER_IMAGE_TURNS]
      : 0;

  // toolCallId → 发起调用的 toolCall block，用来在占位里写明路径
  const calls = new Map<string, ToolCallBlock>();
  for (let i = 0; i < lastUserIndex; i++) {
    const m = messages[i];
    if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (isToolCall(b) && typeof b.id === 'string') calls.set(b.id, b);
    }
  }

  let out: ContextMessage[] | undefined;
  for (let i = 0; i < lastUserIndex; i++) {
    const m = messages[i];
    if (!m || !hasImage(m)) continue;
    let replaced: ContextMessage | undefined;
    if (m.role === 'toolResult') {
      const call = typeof m.toolCallId === 'string' ? calls.get(m.toolCallId) : undefined;
      const tool = m.toolName ?? call?.name ?? 'tool';
      const path = pathOfCall(call);
      replaced = replaceImages(m, path ? `${tool} ${path}` : `from ${tool}`);
    } else if (m.role === 'user' && i < keepUserFrom) {
      replaced = replaceImages(m, 'attached by user');
    }
    if (!replaced) continue;
    out ??= [...messages];
    out[i] = replaced;
  }
  return out ?? messages;
}
