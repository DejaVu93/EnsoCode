import type { AgentCommand } from '@shared/types/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLockRequests } from './workspaceLockRequests';

afterEach(() => vi.useRealTimers());
describe('workspace lock acknowledgements', () => {
  it('registers the exact waiter before posting and separates lock from unlock acknowledgements', async () => {
    const sent: AgentCommand[] = [];
    const requests = new WorkspaceLockRequests((command) => {
      sent.push(command);
      requests.settle({
        type:
          command.type === 'lock-workspace' ? 'workspace-lock-result' : 'workspace-unlock-result',
        requestId: command.requestId,
        ok: true,
      });
      return { ok: true };
    });
    expect(
      await requests.request({
        type: 'lock-workspace',
        requestId: 'one',
        conversationIds: ['root'],
      })
    ).toEqual({ ok: true });
    expect(
      await requests.request({
        type: 'unlock-workspace',
        requestId: 'one',
        conversationIds: ['root'],
        branch: 'feature',
      })
    ).toEqual({ ok: true });
    expect(sent).toHaveLength(2);
  });
  it('does not allow a stale or mismatched ACK to unlock the caller', async () => {
    const requests = new WorkspaceLockRequests(() => ({ ok: true }));
    const pending = requests.request({
      type: 'lock-workspace',
      requestId: 'new',
      conversationIds: ['root'],
    });
    requests.settle({ type: 'workspace-lock-result', requestId: 'old', ok: true });
    requests.settle({ type: 'workspace-unlock-result', requestId: 'new', ok: true });
    requests.settle({
      type: 'workspace-lock-result',
      requestId: 'new',
      ok: false,
      error: 'running',
    });
    expect(await pending).toEqual({ ok: false, error: 'running' });
  });
  it('fails safely on timeout and worker exit', async () => {
    vi.useFakeTimers();
    const requests = new WorkspaceLockRequests(() => ({ ok: true }), 20);
    const timeout = requests.request({
      type: 'lock-workspace',
      requestId: 'timeout',
      conversationIds: ['root'],
    });
    await vi.advanceTimersByTimeAsync(21);
    expect((await timeout).ok).toBe(false);
    const exited = requests.request({
      type: 'unlock-workspace',
      requestId: 'exit',
      conversationIds: ['root'],
    });
    requests.failAll('worker exited');
    expect(await exited).toEqual({ ok: false, error: 'worker exited' });
    expect(
      requests.settle({
        type: 'status',
        identity: { sessionId: 'r', generation: 'g' },
        seq: 1,
        status: 'idle',
      })
    ).toBe(false);
  });
});
