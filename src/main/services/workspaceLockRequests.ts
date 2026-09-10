import type { AgentCommand, AgentWorkerEvent } from '@shared/types/agent';

type WorkspaceCommand = Extract<AgentCommand, { type: 'lock-workspace' | 'unlock-workspace' }>;
type Result = { ok: boolean; error?: string };

export class WorkspaceLockRequests {
  private readonly pending = new Map<string, (result: Result) => void>();

  constructor(
    private readonly post: (command: WorkspaceCommand) => Result,
    private readonly timeoutMs = 8000
  ) {}

  request(command: WorkspaceCommand): Promise<Result> {
    const type =
      command.type === 'lock-workspace' ? 'workspace-lock-result' : 'workspace-unlock-result';
    const key = `${type}:${command.requestId}`;
    if (this.pending.has(key))
      return Promise.resolve({ ok: false, error: 'Workspace request is already pending.' });
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => finish({ ok: false, error: 'Workspace acknowledgement timed out.' }),
        this.timeoutMs
      );
      const finish = (result: Result) => {
        clearTimeout(timer);
        this.pending.delete(key);
        resolve(result);
      };
      this.pending.set(key, finish);
      try {
        const posted = this.post(command);
        if (!posted.ok) finish(posted);
      } catch (error) {
        finish({ ok: false, error: String(error) });
      }
    });
  }

  settle(event: AgentWorkerEvent): boolean {
    if (event.type !== 'workspace-lock-result' && event.type !== 'workspace-unlock-result')
      return false;
    this.pending.get(`${event.type}:${event.requestId}`)?.({
      ok: event.ok,
      ...(event.error ? { error: event.error } : {}),
    });
    return true;
  }

  failAll(error: string): void {
    for (const finish of [...this.pending.values()]) finish({ ok: false, error });
  }
}
