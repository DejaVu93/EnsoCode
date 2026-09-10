/**
 * per-key 的操作串行化门：同一 key 的任务按提交顺序执行，不同 key 并行。
 * 任务抛错不断链——下一个任务照常执行，错误由调用方通过返回的 promise 处理。
 */
export class OperationGate {
  private chains = new Map<string, Promise<unknown>>();
  private readonly pending = new Map<string, number>();

  hasPending(key: string): boolean {
    return this.pending.has(key);
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    const next = prev.then(task, task).finally(() => {
      const count = (this.pending.get(key) ?? 1) - 1;
      if (count) this.pending.set(key, count);
      else this.pending.delete(key);
    });
    // 链上只挂「已吞错」的尾巴，避免 unhandled rejection；错误仍从 next 抛给调用方
    this.chains.set(
      key,
      next.catch(() => {})
    );
    return next;
  }
}
