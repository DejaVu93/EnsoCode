import type { ConversationReloadResult, RendererAgentEvent } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { emptyProjection, type SessionProjection } from './reducer';
import { applyConversationReload } from './reload';

const identity = (generation = 'g1') => ({ sessionId: 's1', generation });
const text = (role: 'user' | 'assistant', value: string, optimistic?: true) => ({
  role,
  content: [{ type: 'text' as const, text: value }],
  ...(optimistic ? { optimistic } : {}),
});
const texts = (state: SessionProjection) =>
  state.messages.map((message) => (message.content[0] as { text: string }).text);

const base: SessionProjection = {
  ...emptyProjection,
  generation: 'g1',
  status: 'running',
  lastSeq: 5,
  runStartedAt: 100,
  activeMs: 30,
  dispatchMainEvents: { d1: { type: 'x' } as never },
  toolOutputs: { t1: 'partial' },
  messages: [text('user', 'q'), text('assistant', 'old'), text('user', 'steer', true)],
};

const live = (seq: number, messages = [text('user', 'q'), text('assistant', 'new')]) =>
  ({
    ok: true,
    source: 'live',
    seq,
    snapshot: { identity: identity(), status: 'running', messages, commands: [] },
  }) satisfies ConversationReloadResult;

describe('applyConversationReload', () => {
  it('live：快照成为权威正文，lastSeq 置为水位，乐观尾巴保留', () => {
    const next = applyConversationReload(base, 's1', live(9), []);
    expect(texts(next)).toEqual(['q', 'new', 'steer']);
    expect(next.lastSeq).toBe(9);
    expect(next.generation).toBe('g1');
  });

  it('live：同代保留运行计时、Main dispatch 流与工具输出，不清零', () => {
    const next = applyConversationReload(base, 's1', live(9), []);
    expect(next.runStartedAt).toBe(100);
    expect(next.activeMs).toBe(30);
    expect(next.dispatchMainEvents).toEqual(base.dispatchMainEvents);
    expect(next.toolOutputs).toEqual({ t1: 'partial' });
  });

  it('live：水位之后到达过的实时事件按序重放，水位之前的丢弃', () => {
    const buffered: RendererAgentEvent[] = [
      {
        type: 'message-upsert',
        identity: identity(),
        seq: 9,
        index: 1,
        message: text('assistant', 'stale-before-watermark'),
      },
      {
        type: 'message-upsert',
        identity: identity(),
        seq: 10,
        index: 2,
        message: text('assistant', 'after'),
      },
    ];
    const next = applyConversationReload(base, 's1', live(9), buffered, 200);
    expect(texts(next)).toEqual(['q', 'new', 'after', 'steer']);
    expect(next.lastSeq).toBe(10);
  });

  it('live：快照空正文也是权威结果，不因为空而跳过', () => {
    const next = applyConversationReload(base, 's1', live(9, []), []);
    expect(texts(next)).toEqual(['steer']);
    expect(next.lastSeq).toBe(9);
  });

  it('history：safe journal 投影替换正文与 customEntries，其余字段不动', () => {
    const next = applyConversationReload(
      base,
      's1',
      {
        ok: true,
        source: 'history',
        projection: {
          partial: false,
          records: [
            { type: 'safe-user-text', at: 1, text: 'hello' },
            { type: 'safe-assistant-text', at: 2, text: 'world' },
          ],
        },
      },
      []
    );
    expect(texts(next)).toEqual(['hello', 'world']);
    expect(next.status).toBe('running');
    expect(next.lastSeq).toBe(5);
    expect(next.dispatchMainEvents).toEqual(base.dispatchMainEvents);
  });

  it('tail：jsonl 尾窗替换权威正文并记绝对起点，乐观尾巴保留', () => {
    const next = applyConversationReload(
      base,
      's1',
      { ok: true, source: 'tail', messages: [text('assistant', 'tail')], baseIndex: 12 },
      []
    );
    expect(texts(next)).toEqual(['tail', 'steer']);
    expect(next.historyBaseIndex).toBe(12);
  });

  it('tail：baseIndex 为 0 时清掉尾窗起点', () => {
    const next = applyConversationReload(
      { ...base, historyBaseIndex: 40 },
      's1',
      { ok: true, source: 'tail', messages: [text('assistant', 'all')], baseIndex: 0 },
      []
    );
    expect(next.historyBaseIndex).toBeUndefined();
  });

  it('失败结果原对象返回，正文一字不改', () => {
    const next = applyConversationReload(base, 's1', { ok: false, error: 'boom' }, []);
    expect(next).toBe(base);
  });
});
