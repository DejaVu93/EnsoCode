import { describe, expect, it } from 'vitest';
import { BUDGETS, chunkMessages } from './chunk';
import type { AgentMessage } from './types';

const pair = (id: string) =>
  [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id, name: 'read', arguments: { path: `${id}.ts` } }],
    },
    {
      role: 'toolResult',
      toolCallId: id,
      toolName: 'read',
      content: [{ type: 'text', text: 'x'.repeat(2000) }],
    },
  ] as unknown as AgentMessage[];
const many = () => Array.from({ length: 12 }, (_, i) => pair(`r${i}`)).flat();

describe('chunkMessages', () => {
  it('提供各模式约定的预算', () => {
    expect(BUDGETS.fast.singlePassMaxTokens).toBe(20_000);
    expect(BUDGETS.thorough.maxChunkTokens).toBe(12_000);
  });
  it('按工具调用与结果成组切块且保持原始顺序', () => {
    const input = many();
    const chunks = chunkMessages(input, 1200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const results = new Set(
        chunk.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId)
      );
      const calls = chunk.messages.flatMap((m) =>
        m.role === 'assistant' && Array.isArray(m.content)
          ? m.content.filter((b) => b.type === 'toolCall')
          : []
      );
      expect(calls.every((call) => results.has(call.id))).toBe(true);
    }
    expect(chunks.flatMap((chunk) => chunk.messages)).toEqual(input);
  });
  it('把不足十分之一预算的末尾消息并入前块', () => {
    const trailing = { role: 'user', content: 'tail' } as unknown as AgentMessage;
    const chunks = chunkMessages([...many(), trailing], 1200);
    expect(chunks).toHaveLength(chunkMessages(many(), 1200).length);
    expect(chunks.at(-1)?.messages).toContain(trailing);
    expect(chunks.at(-1)?.messages.length).toBeGreaterThan(1);
  });
  it('小输入只返回 index 为零的单块', () => {
    const chunks = chunkMessages([{ role: 'user', content: 'hi' } as AgentMessage], 10_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
  });
  it('交错消息不会拆散多工具调用及其结果', () => {
    const input = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'r1', name: 'read', arguments: { path: 'a' } },
          { type: 'toolCall', id: 'r2', name: 'read', arguments: { path: 'b' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'r1', content: 'one' },
      { role: 'user', content: 'note' },
      { role: 'toolResult', toolCallId: 'r2', content: 'two' },
      { role: 'user', content: 'after' },
    ] as unknown as AgentMessage[];
    const chunk = chunkMessages(input, 1).find((c) => c.messages.includes(input[0]))!;
    const results = new Set(
      chunk.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId)
    );
    const calls = chunk.messages.flatMap((m) =>
      m.role === 'assistant' && Array.isArray(m.content)
        ? m.content.filter((b) => b.type === 'toolCall')
        : []
    );
    expect(calls.every((call) => results.has(call.id))).toBe(true);
    expect(results).toEqual(new Set(['r1', 'r2']));
  });
});
