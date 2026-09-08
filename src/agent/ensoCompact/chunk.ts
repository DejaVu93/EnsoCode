import { estimateTextTokens, serializeMessages, toolCallBlocks } from './serialize';
import type { AgentMessage } from './types';

export type CompactMode = 'auto' | 'fast' | 'balanced' | 'thorough';

export const BUDGETS: Record<CompactMode, { singlePassMaxTokens: number; maxChunkTokens: number }> =
  {
    fast: { singlePassMaxTokens: 20_000, maxChunkTokens: 6_000 },
    auto: { singlePassMaxTokens: 30_000, maxChunkTokens: 8_000 },
    balanced: { singlePassMaxTokens: 30_000, maxChunkTokens: 8_000 },
    thorough: { singlePassMaxTokens: 40_000, maxChunkTokens: 12_000 },
  };

export interface MessageChunk {
  index: number;
  messages: AgentMessage[];
  tokens: number;
}

/** 把 assistant(toolCall…) 与其全部对应 toolResult（含中间插入的消息）打成不可分割的一组。 */
function atomicGroups(messages: AgentMessage[]): AgentMessage[][] {
  const resultIds = new Set(
    messages.flatMap((m) => (m.role === 'toolResult' && m.toolCallId ? [m.toolCallId] : []))
  );
  const groups: AgentMessage[][] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    const group = [msg];
    i++;
    const pending = new Set(
      msg.role === 'assistant'
        ? toolCallBlocks(msg.content)
            .map((c) => c.id)
            .filter((id) => resultIds.has(id))
        : []
    );
    while (pending.size && i < messages.length) {
      const next = messages[i];
      if (next.role === 'toolResult' && next.toolCallId) pending.delete(next.toolCallId);
      group.push(next);
      i++;
    }
    groups.push(group);
  }
  return groups;
}

const tokensOf = (msgs: AgentMessage[]) => estimateTextTokens(serializeMessages(msgs));

export function chunkMessages(messages: AgentMessage[], maxChunkTokens: number): MessageChunk[] {
  const chunks: MessageChunk[] = [];
  let current: AgentMessage[] = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length)
      chunks.push({ index: chunks.length, messages: current, tokens: currentTokens });
    current = [];
    currentTokens = 0;
  };
  for (const group of atomicGroups(messages)) {
    const t = tokensOf(group);
    if (current.length && currentTokens + t > maxChunkTokens) flush();
    current.push(...group);
    currentTokens += t;
  }
  flush();
  const last = chunks.at(-1);
  if (chunks.length > 1 && last && last.tokens < maxChunkTokens / 10) {
    chunks.pop();
    const prev = chunks[chunks.length - 1];
    prev.messages = [...prev.messages, ...last.messages];
    prev.tokens += last.tokens;
  }
  return chunks;
}
