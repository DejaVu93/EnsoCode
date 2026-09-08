import type { AgentWorkerEvent, SessionReloadResult } from '@shared/types/agent';

interface Waiter {
  resolve: (result: SessionReloadResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 手动重读的请求关联表：requestId → 等待者。
 * worker 的 `session-reloaded` 按 requestId 结算；超时 / worker 退出一律以失败结算，
 * 不让调用方拿「已入队」当「已读到」，也不永久挂起。纯逻辑，独立于 utilityProcess 生命周期。
 */
export class PendingReloadRegistry {
  private readonly waiters = new Map<string, Waiter>();

  constructor(private readonly options: { timeoutMs: number }) {}

  get size(): number {
    return this.waiters.size;
  }

  wait(requestId: string): Promise<SessionReloadResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.finish(requestId, { ok: false, error: 'Timed out waiting for the agent worker.' });
      }, this.options.timeoutMs);
      this.waiters.set(requestId, { resolve, timer });
    });
  }

  /** 返回是否消费了该事件（仅匹配在途 requestId 的 session-reloaded 才算） */
  settle(event: AgentWorkerEvent): boolean {
    if (event.type !== 'session-reloaded') return false;
    return this.finish(event.requestId, event.result);
  }

  failAll(error: string): void {
    for (const requestId of [...this.waiters.keys()]) this.finish(requestId, { ok: false, error });
  }

  private finish(requestId: string, result: SessionReloadResult): boolean {
    const waiter = this.waiters.get(requestId);
    if (!waiter) return false;
    this.waiters.delete(requestId);
    clearTimeout(waiter.timer);
    waiter.resolve(result);
    return true;
  }
}
