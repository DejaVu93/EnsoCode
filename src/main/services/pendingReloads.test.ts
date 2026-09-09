import { describe, expect, it, vi } from 'vitest';
import { PendingReloadRegistry } from './pendingReloads';

const ok = {
  ok: true as const,
  seq: 3,
  snapshot: {
    identity: { sessionId: 's1', generation: 'g1' },
    status: 'idle' as const,
    messages: [],
    commands: [],
  },
};

describe('PendingReloadRegistry', () => {
  it('匹配 requestId 的响应结算对应等待者，其它请求不受影响', async () => {
    vi.useFakeTimers();
    const registry = new PendingReloadRegistry({ timeoutMs: 1000 });
    const first = registry.wait('r1');
    const second = registry.wait('r2');
    expect(registry.settle({ type: 'session-reloaded', requestId: 'r1', result: ok })).toBe(true);
    await expect(first).resolves.toEqual(ok);
    expect(registry.size).toBe(1);
    registry.settle({
      type: 'session-reloaded',
      requestId: 'r2',
      result: { ok: false, error: 'gone' },
    });
    await expect(second).resolves.toEqual({ ok: false, error: 'gone' });
    vi.useRealTimers();
  });

  it('未知 requestId 的响应被忽略且不算消费', () => {
    const registry = new PendingReloadRegistry({ timeoutMs: 1000 });
    expect(registry.settle({ type: 'session-reloaded', requestId: 'nope', result: ok })).toBe(
      false
    );
  });

  it('非 session-reloaded 事件不触碰等待者', () => {
    const registry = new PendingReloadRegistry({ timeoutMs: 1000 });
    void registry.wait('r1');
    expect(registry.settle({ type: 'snapshot', sessions: [] })).toBe(false);
    expect(registry.size).toBe(1);
  });

  it('超时以失败结算，不永久挂起', async () => {
    vi.useFakeTimers();
    const registry = new PendingReloadRegistry({ timeoutMs: 500 });
    const pending = registry.wait('r1');
    vi.advanceTimersByTime(500);
    await expect(pending).resolves.toEqual({ ok: false, error: expect.stringMatching(/time/i) });
    expect(registry.size).toBe(0);
    vi.useRealTimers();
  });

  it('worker 退出时全部在途请求立即失败', async () => {
    const registry = new PendingReloadRegistry({ timeoutMs: 1000 });
    const a = registry.wait('a');
    const b = registry.wait('b');
    registry.failAll('agent worker exited');
    await expect(a).resolves.toEqual({ ok: false, error: 'agent worker exited' });
    await expect(b).resolves.toEqual({ ok: false, error: 'agent worker exited' });
    expect(registry.size).toBe(0);
  });

  it('已结算的请求再次结算不生效', async () => {
    const registry = new PendingReloadRegistry({ timeoutMs: 1000 });
    const pending = registry.wait('r1');
    registry.settle({ type: 'session-reloaded', requestId: 'r1', result: ok });
    await pending;
    expect(registry.settle({ type: 'session-reloaded', requestId: 'r1', result: ok })).toBe(false);
  });
});
