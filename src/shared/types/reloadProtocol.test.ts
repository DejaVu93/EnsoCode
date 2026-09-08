import { describe, expect, it } from 'vitest';
import { parseAgentCommand, parseAgentWorkerEvent } from './agent';

const request = { type: 'reload-session', requestId: 'reload-1', sessionId: 'conversation-1' };
const snapshot = {
  identity: { sessionId: 'conversation-1', generation: '11111111-1111-4111-8111-111111111111' },
  status: 'idle',
  messages: [],
  commands: [],
};

describe('手动重读的独立协议', () => {
  it('只读请求保留关联标识，不要求启动或恢复代理', () => {
    expect(parseAgentCommand(request)).toEqual(request);
  });

  it('不允许请求携带文件路径或缺少关联标识', () => {
    expect(parseAgentCommand({ ...request, sessionFile: '/private/history' })).toBeNull();
    expect(parseAgentCommand({ ...request, requestId: '' })).toBeNull();
  });

  it('成功结果包含快照与事件水位', () => {
    const event = {
      type: 'session-reloaded',
      requestId: 'reload-1',
      result: { ok: true, snapshot, seq: 7 },
    };
    expect(parseAgentWorkerEvent(event)).toEqual(event);
  });

  it('失败结果也可关联原请求', () => {
    const event = {
      type: 'session-reloaded',
      requestId: 'reload-1',
      result: { ok: false, error: 'Session unavailable' },
    };
    expect(parseAgentWorkerEvent(event)).toEqual(event);
  });

  it('缺失或非法水位的成功结果必须拒绝', () => {
    for (const seq of [undefined, -1, 1.5, '7']) {
      expect(
        parseAgentWorkerEvent({
          type: 'session-reloaded',
          requestId: 'reload-1',
          result: { ok: true, snapshot, seq },
        })
      ).toBeNull();
    }
  });
});
