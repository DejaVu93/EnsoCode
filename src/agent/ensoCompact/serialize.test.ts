import { describe, expect, it } from 'vitest';
import { normalizeMessages, pruneMessages, serializeMessages } from './serialize';
import type { AgentMessage } from './types';

const call = (id: string, name = 'read', args: Record<string, unknown> = { path: 'a.ts' }) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name, arguments: args }],
});
const result = (id: string, text: string, isError = false) => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: 'read',
  content: [{ type: 'text', text }],
  isError,
});
const messages = (items: unknown[]) => items as unknown as AgentMessage[];
describe('serialize messages', () => {
  it('统一分支条目和顶层消息并丢弃无 role 条目', () => {
    const user = { role: 'user', content: 'hi' };
    expect(
      normalizeMessages([{ type: 'message', message: user }, user, { type: 'custom' }])
    ).toEqual([user, user]);
  });
  it('同纪元重复 read 只保留最后调用及结果并清理空消息', () => {
    const pruned = pruneMessages(
      messages([
        call('r1'),
        result('r1', 'old-1'),
        { role: 'assistant', content: [{ type: 'text', text: '保留文本' }, call('r2').content[0]] },
        result('r2', 'old-2'),
        call('r3'),
        result('r3', 'latest'),
      ])
    );
    expect(pruned).toEqual(
      messages([
        { role: 'assistant', content: [{ type: 'text', text: '保留文本' }] },
        call('r3'),
        result('r3', 'latest'),
      ])
    );
  });
  it('edit 推进纪元后保留前后两个相同 read', () => {
    const pruned = pruneMessages(
      messages([
        call('r1'),
        result('r1', 'before'),
        call('e1', 'edit'),
        result('e1', 'edited'),
        call('r2'),
        result('r2', 'after'),
      ])
    ) as unknown as Array<{ role: string; toolCallId?: string }>;
    expect(pruned.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId)).toEqual([
      'r1',
      'e1',
      'r2',
    ]);
  });
  it('截断普通结果的头尾并为错误结果保留末行', () => {
    const [normal, error] = pruneMessages(
      messages([
        result('r1', '0123456789MIDDLEabcdefghij'),
        result('r2', `ABC${'x'.repeat(20)}\nERR42`, true),
      ]),
      { maxToolResultChars: 20 }
    ) as never[];
    expect(JSON.stringify(normal)).toMatch(/0123456789.*chars truncated].*abcdefghij/);
    expect(JSON.stringify(error)).toMatch(/chars truncated].*ERR42/);
  });
  it('序列化覆盖用户、助手、工具调用和最后消息', () => {
    const text = serializeMessages(
      messages([
        { role: 'user', content: '用户正文' },
        { ...call('r1'), content: [{ type: 'text', text: '助手正文' }, call('r1').content[0]] },
        result('r1', '工具结果'),
        { role: 'user', content: '最后消息' },
      ])
    );
    for (const part of ['用户正文', '助手正文', 'read(', '最后消息']) expect(text).toContain(part);
  });
  it('无结果的末次重复读取不会淘汰有结果的读取', () => {
    const input = messages([call('r1'), result('r1', 'has-result'), call('r2')]);
    expect(pruneMessages(input)).toEqual(input);
  });
  it('任意非只读工具都会推进读取去重纪元', () => {
    const pruned = pruneMessages(
      messages([
        call('r1'),
        result('r1', 'a'),
        call('p1', 'apply_patch', { input: 'x' }),
        result('p1', 'ok'),
        call('r2'),
        result('r2', 'b'),
      ])
    ) as unknown as Array<{ role: string; toolCallId?: string }>;
    expect(pruned.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId)).toEqual([
      'r1',
      'p1',
      'r2',
    ]);
  });
});
