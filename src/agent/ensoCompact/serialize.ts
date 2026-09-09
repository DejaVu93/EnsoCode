import { convertToLlm, serializeConversation } from '@earendil-works/pi-coding-agent';
import type { AgentMessage } from './types';

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['read', 'grep', 'find', 'ls', 'glob']);

export interface PruneOptions {
  maxToolResultChars?: number;
}

interface ToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}

type Loose = { role?: string; content?: unknown; toolCallId?: string; isError?: boolean };

export function normalizeMessages(input: unknown[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { role?: unknown; message?: unknown };
    const msg = typeof rec.role === 'string' ? rec : rec.message;
    if (!msg || typeof msg !== 'object' || typeof (msg as Loose).role !== 'string') continue;
    out.push(normalizeContent(msg as Loose) as AgentMessage);
  }
  return out;
}

/** pi 的 serializeConversation 对 assistant/toolResult 要求块数组且 toolCall 带 arguments，这里统一补齐。 */
function normalizeContent(msg: Loose): Loose {
  if (msg.role === 'user') return msg;
  if (typeof msg.content === 'string')
    return { ...msg, content: [{ type: 'text', text: msg.content }] };
  if (!Array.isArray(msg.content)) return { ...msg, content: [] };
  if (msg.role !== 'assistant') return msg;
  const needsArgs = msg.content.some(
    (b) =>
      b &&
      typeof b === 'object' &&
      (b as ToolCallBlock).type === 'toolCall' &&
      !(b as ToolCallBlock).arguments
  );
  if (!needsArgs) return msg;
  return {
    ...msg,
    content: msg.content.map((b) =>
      b &&
      typeof b === 'object' &&
      (b as ToolCallBlock).type === 'toolCall' &&
      !(b as ToolCallBlock).arguments
        ? { ...b, arguments: {} }
        : b
    ),
  };
}

export function toolCallBlocks(content: unknown): ToolCallBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (b): b is ToolCallBlock =>
      !!b &&
      typeof b === 'object' &&
      (b as ToolCallBlock).type === 'toolCall' &&
      !!(b as ToolCallBlock).id
  );
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) =>
      b && typeof b === 'object' && (b as { type?: string }).type === 'text'
        ? ((b as { text?: string }).text ?? '')
        : ''
    )
    .join('\n');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : v
  );
}

function truncate(text: string, max: number, isError: boolean): string {
  if (text.length <= max) return text;
  const head = isError ? Math.floor(max / 4) : Math.floor(max / 2);
  const tail = max - head;
  return `${text.slice(0, head)}\n[... ${text.length - max} chars truncated]\n${text.slice(-tail)}`;
}

export function pruneMessages(messages: AgentMessage[], opts: PruneOptions = {}): AgentMessage[] {
  const max = opts.maxToolResultChars ?? 800;
  const resultIds = new Set<string>();
  for (const msg of messages as Loose[]) {
    if (msg.role === 'toolResult' && msg.toolCallId) resultIds.add(msg.toolCallId);
  }
  // 同纪元内同参只读调用，保留最后一次“带结果”的；任何非只读工具推进纪元
  const lastByKey = new Map<string, string>();
  const keyOf = new Map<string, string>();
  let epoch = 0;
  for (const msg of messages as Loose[]) {
    if (msg.role !== 'assistant') continue;
    for (const call of toolCallBlocks(msg.content)) {
      if (!READ_ONLY_TOOLS.has(call.name)) {
        epoch++;
        continue;
      }
      if (!resultIds.has(call.id)) continue;
      const key = `${epoch}\0${call.name}\0${stableJson(call.arguments ?? {})}`;
      keyOf.set(call.id, key);
      lastByKey.set(key, call.id);
    }
  }
  const dropped = new Set<string>();
  for (const [id, key] of keyOf) if (lastByKey.get(key) !== id) dropped.add(id);

  const out: AgentMessage[] = [];
  for (const msg of messages as Loose[]) {
    if (msg.role === 'assistant' && Array.isArray(msg.content) && dropped.size) {
      const content = msg.content.filter((b) => {
        const call = toolCallBlocks([b])[0];
        return !call || !dropped.has(call.id);
      });
      if (content.length === 0) continue;
      out.push((content.length === msg.content.length ? msg : { ...msg, content }) as AgentMessage);
      continue;
    }
    if (msg.role === 'toolResult') {
      if (msg.toolCallId && dropped.has(msg.toolCallId)) continue;
      const text = textOf(msg.content);
      if (text.length > max) {
        out.push({
          ...msg,
          content: [{ type: 'text', text: truncate(text, max, msg.isError === true) }],
        } as AgentMessage);
        continue;
      }
    }
    out.push(msg as AgentMessage);
  }
  return out;
}

export function serializeMessages(messages: AgentMessage[]): string {
  return serializeConversation(convertToLlm(messages));
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
