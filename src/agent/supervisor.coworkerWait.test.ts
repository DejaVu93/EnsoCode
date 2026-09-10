import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AgentWorkerEvent,
  type SessionIdentity,
  workspaceBranchChangedNote,
} from '@shared/types/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  managers: [] as Array<Record<string, unknown>>,
  mcpToolsFor: vi.fn(),
  createAgentSession: vi.fn(),
  loaderOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock('./cursor/loadProvider', () => ({
  CURSOR_PROVIDER_ID: 'cursor',
  loadCursorProvider: vi.fn(async () => undefined),
}));

vi.mock('./mcp', () => ({
  McpManager: class {
    toolsFor = mocks.mcpToolsFor;
    closeAll = vi.fn(async () => undefined);
  },
}));

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  class Loader {
    beforeAgentStart = (systemPrompt: string, _prompt: string) => systemPrompt;
    constructor(options: Record<string, unknown>) {
      mocks.loaderOptions.push(options);
      const extension = (
        options.extensionFactories as
          | Array<{ name: string; factory(pi: unknown): void }>
          | undefined
      )?.find((e) => e.name === 'workspace-branch-context');
      extension?.factory({
        on: (
          _event: string,
          handler: (event: {
            systemPrompt: string;
            prompt: string;
          }) => { systemPrompt: string } | undefined
        ) => {
          this.beforeAgentStart = (systemPrompt, prompt) =>
            handler({ systemPrompt, prompt })?.systemPrompt ?? systemPrompt;
        },
      });
    }
    async reload() {}
    getSkills() {
      return { skills: [] };
    }
    getPrompts() {
      return { prompts: [] };
    }
  }
  const manager = () => {
    const branch: unknown[] = [];
    const value = {
      getBranch: vi.fn(() => branch),
      appendCustomEntry: vi.fn((customType: string, data: unknown) => {
        branch.push({ type: 'custom', customType, data });
        return `entry-${branch.length}`;
      }),
      buildSessionContext: vi.fn(() => ({ messages: [] })),
    };
    mocks.managers.push(value);
    return value;
  };
  const runtime = {
    models: new Map<string, Record<string, unknown>>(),
    registerProvider(providerId: string, config: { models?: Record<string, unknown>[] }) {
      for (const model of config.models ?? []) {
        this.models.set(`${providerId}/${model.id}`, { ...model, provider: providerId });
      }
    },
    getModel(providerId: string, modelId: string) {
      return this.models.get(`${providerId}/${modelId}`);
    },
    getModels() {
      return [...this.models.values()];
    },
    refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
    completeSimple: vi.fn(async () => ({ content: [] })),
  };
  return {
    ...original,
    DefaultResourceLoader: Loader,
    ModelRuntime: { create: vi.fn(async () => runtime) },
    SessionManager: { create: vi.fn(manager), open: vi.fn(manager), inMemory: vi.fn(manager) },
    createAgentSession: mocks.createAgentSession,
  };
});

import { SessionSupervisor } from './supervisor';

const parent = {
  sessionId: 'parent',
  generation: '11111111-1111-4111-8111-111111111111',
};
const model = {
  api: 'openai-completions' as const,
  baseUrl: 'https://example.test/v1',
  apiKey: 'secret',
  modelId: 'model',
  settingsProviderId: 'settings-provider',
};

function session(options: Record<string, unknown>) {
  const listeners = new Set<(event: { type: string; [key: string]: unknown }) => void>();
  const value = {
    model: options.model,
    resourceLoader: options.resourceLoader,
    sessionManager: options.sessionManager,
    messages: [] as Record<string, unknown>[],
    sessionFile: `/tmp/session-${mocks.sessions.length}.jsonl`,
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(event: { type: string; [key: string]: unknown }) {
      for (const listener of listeners) listener(event);
    },
    systemPrompts: [] as string[],
    prompt: vi.fn(async (text: string) => {
      if (!text.startsWith('/no-turn'))
        value.systemPrompts.push(
          (
            options.resourceLoader as {
              beforeAgentStart(systemPrompt: string, prompt: string): string;
            }
          ).beforeAgentStart('base system', text)
        );
    }),
    steer: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
    setThinkingLevel: vi.fn(),
    navigateTree: vi.fn(async () => ({ cancelled: false })),
    isStreaming: false,
    isRetrying: false,
  };
  mocks.sessions.push(value);
  return value;
}

async function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

/** spawn 链路里的 mock 异步跳数会变（provider 刷新等），settle() 一次不一定够，轮询等它落地。 */
async function settleUntil(check: () => boolean, tries = 20): Promise<void> {
  for (let i = 0; i < tries && !check(); i++) {
    await settle();
  }
}

interface CoworkerToolLike {
  execute(
    id: string,
    params: Record<string, unknown>,
    a?: unknown,
    b?: unknown,
    c?: unknown
  ): Promise<{ content: Array<{ type: string; text: string }> }>;
}

async function textOf(
  result: Promise<{ content: Array<{ type: string; text: string }> }>
): Promise<string> {
  const r = await result;
  return (r.content[0] as { text: string }).text;
}

/** 常规起手式：spawn 一个父会话 + 一个名为 bob 的 coworker（首轮任务不驱动完成态）。 */
async function spawnParentAndCoworker(events: AgentWorkerEvent[]) {
  const supervisor = new SessionSupervisor({
    emit: (event) => events.push(event),
    agentDir: '/tmp/agent',
    sessionDir: mkdtempSync(path.join(tmpdir(), 'enso-cw-')),
  });
  supervisor.handleCommand({ type: 'spawn-parent', identity: parent, cwd: '/workspace', model });
  await settleUntil(() => mocks.createAgentSession.mock.calls.length > 0);
  const parentSession = mocks.sessions[0] as ReturnType<typeof session>;
  const parentOptions = mocks.createAgentSession.mock.calls[0][0] as {
    customTools: CoworkerToolLike[];
  };
  const coworkerTool = parentOptions.customTools.find(
    (tool) => (tool as unknown as { name: string }).name === 'coworker'
  ) as unknown as CoworkerToolLike;

  await coworkerTool.execute(
    't1',
    { operation: 'spawn', name: 'bob', task: 'first task' },
    undefined,
    undefined,
    {} as never
  );
  await settle();
  const coworkerSession = mocks.sessions[1] as ReturnType<typeof session>;
  const coworkerId = 'parent::cw-bob';
  const statusEvent = events.find(
    (event) =>
      event.type === 'status' &&
      (event as { identity: SessionIdentity }).identity.sessionId === coworkerId
  ) as { identity: SessionIdentity } | undefined;
  const coworkerIdentity = statusEvent?.identity as SessionIdentity;
  const childOptions = mocks.createAgentSession.mock.calls[1][0] as {
    customTools: Array<{
      name: string;
      execute(
        id: string,
        params: { message: string; urgent?: boolean },
        signal?: AbortSignal
      ): Promise<unknown>;
    }>;
  };
  return {
    supervisor,
    parentSession,
    coworkerTool,
    coworkerSession,
    coworkerId,
    coworkerIdentity,
    childOptions,
  };
}

describe('SessionSupervisor coworker wait/report', () => {
  beforeEach(() => {
    mocks.sessions.length = 0;
    mocks.managers.length = 0;
    mocks.loaderOptions.length = 0;
    mocks.createAgentSession.mockReset();
    rmSync(path.join(tmpdir(), 'enso-cw-sessions'), { recursive: true, force: true });
    mocks.mcpToolsFor.mockReset().mockResolvedValue([]);
    mocks.createAgentSession.mockImplementation(async (options: Record<string, unknown>) => ({
      session: session(options),
    }));
    // 本文件多个用例会触发 ParentNotifier 的非紧急通知(真实 setTimeout 去抖),
    // 且每个 supervisor 都会起自己的 evictionTimer(真实 setInterval,测试从不 shutdown);
    // 全部假掉并在 afterEach 清空,避免残留定时器泄漏到后续测试文件的事件循环里。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('workspace lock defers internal wakeups and installs branch context once per live session', async () => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, parentSession, coworkerSession, childOptions } =
      await spawnParentAndCoworker(events);
    const command = { requestId: 'switch-1', conversationIds: [parent.sessionId] };
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    parentSession.prompt.mockClear();
    parentSession.systemPrompts.length = 0;
    coworkerSession.prompt.mockClear();
    supervisor.handleCommand({ type: 'lock-workspace', ...command });
    expect(events.at(-1)).toEqual({
      type: 'workspace-lock-result',
      requestId: 'switch-1',
      ok: true,
    });
    const send = childOptions.customTools.find((tool) => tool.name === 'message_main_agent')!;
    await send.execute('notify', { message: 'delayed result', urgent: true });
    expect(parentSession.prompt).not.toHaveBeenCalled();
    supervisor.handleCommand({ type: 'unlock-workspace', ...command, branch: 'feature/new' });
    await settle();
    expect(parentSession.prompt).toHaveBeenCalledTimes(1);
    expect(parentSession.prompt.mock.calls[0][0]).not.toContain('feature/new');
    expect(parentSession.systemPrompts[0]).toContain('feature/new');
    expect(parentSession.prompt.mock.calls[0][0]).toContain('delayed result');
    expect(coworkerSession.prompt).not.toHaveBeenCalled();
    await send.execute('notify-again', { message: 'next result', urgent: true });
    expect(parentSession.systemPrompts[1]).not.toContain('feature/new');
    expect(events.filter((event) => event.type === 'workspace-branch-context-consumed')).toEqual([
      expect.objectContaining({
        type: 'workspace-branch-context-consumed',
        identity: parent,
        requestId: 'switch-1',
        seq: expect.any(Number),
      }),
    ]);
  });

  it('workspace unlock does not create a message and the next coworker send consumes its note', async () => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, parentSession, coworkerSession, coworkerTool, coworkerIdentity } =
      await spawnParentAndCoworker(events);
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    parentSession.prompt.mockClear();
    coworkerSession.prompt.mockClear();
    coworkerSession.systemPrompts.length = 0;
    parentSession.systemPrompts.length = 0;
    const command = { requestId: 'switch', conversationIds: [parent.sessionId] };
    supervisor.handleCommand({ type: 'lock-workspace', ...command });
    expect(events.at(-1)).toMatchObject({ type: 'workspace-lock-result', ok: true });
    const sending = coworkerTool.execute(
      'send',
      { operation: 'send', name: 'bob', message: 'next task' },
      undefined,
      undefined,
      {}
    );
    await settle();
    expect(coworkerSession.prompt).not.toHaveBeenCalled();
    supervisor.handleCommand({ type: 'unlock-workspace', ...command, branch: 'feature/child' });
    await sending;
    expect(coworkerSession.prompt).toHaveBeenCalledTimes(1);
    expect(coworkerSession.prompt.mock.calls[0][0]).not.toContain('feature/child');
    expect(coworkerSession.systemPrompts[0]).toContain('feature/child');
    expect(coworkerSession.prompt.mock.calls[0][0]).toContain('next task');
    expect(events.filter((event) => event.type === 'workspace-branch-context-consumed')).toEqual([
      expect.objectContaining({ identity: coworkerIdentity, requestId: 'switch' }),
    ]);
    expect(parentSession.prompt).not.toHaveBeenCalled();
  });

  it('reports consumption when renderer already attached the branch note without duplicating system context', async () => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, parentSession, coworkerSession } = await spawnParentAndCoworker(events);
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    parentSession.systemPrompts.length = 0;
    supervisor.handleCommand({
      type: 'lock-workspace',
      requestId: 'store-note',
      conversationIds: [parent.sessionId],
    });
    supervisor.handleCommand({
      type: 'unlock-workspace',
      requestId: 'store-note',
      conversationIds: [parent.sessionId],
      branch: 'branch-A',
    });
    supervisor.handleCommand({
      type: 'prompt',
      identity: parent,
      text: `${workspaceBranchChangedNote('branch-A')}\n\nreal input`,
    });
    await settle();
    expect(parentSession.systemPrompts).toEqual(['base system']);
    expect(events.filter((event) => event.type === 'workspace-branch-context-consumed')).toEqual([
      expect.objectContaining({ identity: parent, requestId: 'store-note' }),
    ]);
  });

  it('consecutive switches consume only the latest nonce, even when returning to the same branch', async () => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, parentSession, coworkerSession } = await spawnParentAndCoworker(events);
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    parentSession.systemPrompts.length = 0;
    for (const [requestId, branch] of [
      ['first', 'branch-A'],
      ['second', 'branch-B'],
      ['latest', 'branch-A'],
    ]) {
      supervisor.handleCommand({
        type: 'lock-workspace',
        requestId,
        conversationIds: [parent.sessionId],
      });
      supervisor.handleCommand({
        type: 'unlock-workspace',
        requestId,
        conversationIds: [parent.sessionId],
        branch,
      });
    }
    expect(events.filter((event) => event.type === 'workspace-branch-context-consumed')).toEqual(
      []
    );
    supervisor.handleCommand({ type: 'prompt', identity: parent, text: 'real input' });
    await settle();
    expect(parentSession.systemPrompts).toEqual([expect.stringContaining('branch-A')]);
    expect(events.filter((event) => event.type === 'workspace-branch-context-consumed')).toEqual([
      expect.objectContaining({ identity: parent, requestId: 'latest' }),
    ]);
  });

  it('workspace note survives non-turn commands and rejected prompts without modifying input history', async () => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, parentSession, coworkerSession } = await spawnParentAndCoworker(events);
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    parentSession.prompt.mockClear();
    parentSession.systemPrompts.length = 0;
    const command = { requestId: 'switch', conversationIds: [parent.sessionId] };
    supervisor.handleCommand({ type: 'lock-workspace', ...command });
    supervisor.handleCommand({ type: 'unlock-workspace', ...command, branch: 'feature/pending' });
    await settle();
    expect(parentSession.prompt).not.toHaveBeenCalled();
    supervisor.handleCommand({ type: 'prompt', identity: parent, text: '/no-turn' });
    await settle();
    expect(parentSession.prompt).toHaveBeenCalledWith('/no-turn', undefined);
    expect(parentSession.systemPrompts).toEqual([]);
    parentSession.prompt.mockRejectedValueOnce(new Error('not accepted'));
    supervisor.handleCommand({ type: 'prompt', identity: parent, text: 'rejected' });
    await settle();
    expect(parentSession.systemPrompts).toEqual([]);
    supervisor.handleCommand({ type: 'prompt', identity: parent, text: 'real input' });
    await settle();
    expect(parentSession.prompt).toHaveBeenLastCalledWith('real input', undefined);
    expect(parentSession.systemPrompts).toEqual([expect.stringContaining('feature/pending')]);
  });

  it.each([
    'background',
    'subagent',
    'roundPending',
    'retry',
    'compaction',
    'capability',
    'browser',
  ])('workspace lock rejects %s work without interrupting it', async (kind) => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, coworkerSession, coworkerId } = await spawnParentAndCoworker(events);
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    const internal = supervisor as unknown as {
      bgTasks: { snapshot(id: string): Array<{ status: string }> };
      sessions: Map<
        string,
        {
          roundPending?: boolean;
          compaction?: string;
          ensoApp?: { pendingCount: number };
          browser?: { pendingCount: number };
          subagents: Map<string, { status: string }>;
        }
      >;
    };
    const child = internal.sessions.get(coworkerId)!;
    if (kind === 'background')
      vi.spyOn(internal.bgTasks, 'snapshot').mockReturnValue([{ status: 'running' }]);
    if (kind === 'subagent') child.subagents.set('sub', { status: 'running' });
    if (kind === 'roundPending') child.roundPending = true;
    if (kind === 'retry') coworkerSession.isRetrying = true;
    if (kind === 'compaction') child.compaction = 'running';
    if (kind === 'capability') child.ensoApp = { pendingCount: 1 };
    if (kind === 'browser') child.browser = { pendingCount: 1 };
    supervisor.handleCommand({
      type: 'lock-workspace',
      requestId: kind,
      conversationIds: [parent.sessionId],
    });
    expect(events.at(-1)).toMatchObject({ type: 'workspace-lock-result', ok: false });
    expect(coworkerSession.abort).not.toHaveBeenCalled();
    expect(coworkerSession.dispose).not.toHaveBeenCalled();
  });

  it('workspace lock rejects in-flight post-round verification commands', async () => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, coworkerSession, coworkerId } = await spawnParentAndCoworker(events);
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    const internal = supervisor as unknown as {
      sessions: Map<string, { factory?: { runGate(command: string): Promise<string> } }>;
      runParentGate(managed: unknown, command: string): Promise<string>;
    };
    const completion = Promise.withResolvers<string>();
    internal.sessions.get(parent.sessionId)!.factory!.runGate = () => completion.promise;
    const verifying = internal.runParentGate(internal.sessions.get(coworkerId), 'verify');
    supervisor.handleCommand({
      type: 'lock-workspace',
      requestId: 'verify',
      conversationIds: [parent.sessionId],
    });
    expect(events.at(-1)).toMatchObject({ type: 'workspace-lock-result', ok: false });
    completion.resolve('passed');
    await verifying;
    supervisor.handleCommand({
      type: 'lock-workspace',
      requestId: 'after-verify',
      conversationIds: [parent.sessionId],
    });
    expect(events.at(-1)).toMatchObject({ type: 'workspace-lock-result', ok: true });
  });

  it('workspace lock rejects a command queued before running is projected', async () => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, coworkerSession, coworkerIdentity } = await spawnParentAndCoworker(events);
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    supervisor.handleCommand({ type: 'prompt', identity: coworkerIdentity, text: 'real input' });
    supervisor.handleCommand({
      type: 'lock-workspace',
      requestId: 'queued',
      conversationIds: [parent.sessionId],
    });
    expect(events.at(-1)).toMatchObject({ type: 'workspace-lock-result', ok: false });
    await settle();
    expect(coworkerSession.prompt).toHaveBeenCalledWith('real input', undefined);
  });

  it('workspace busy rejection is atomic and a failed switch resumes notifications without branch context', async () => {
    const events: AgentWorkerEvent[] = [];
    const { supervisor, coworkerSession, parentSession, childOptions } =
      await spawnParentAndCoworker(events);
    const command = { requestId: 'switch-1', conversationIds: [parent.sessionId] };
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await vi.advanceTimersByTimeAsync(200);
    parentSession.prompt.mockClear();
    coworkerSession.isStreaming = true;
    supervisor.handleCommand({ type: 'lock-workspace', ...command });
    expect(events.at(-1)).toMatchObject({ type: 'workspace-lock-result', ok: false });
    coworkerSession.isStreaming = false;
    supervisor.handleCommand({ type: 'lock-workspace', ...command, requestId: 'switch-2' });
    expect(events.at(-1)).toMatchObject({ type: 'workspace-lock-result', ok: true });
    const send = childOptions.customTools.find((tool) => tool.name === 'message_main_agent')!;
    await send.execute('notify', { message: 'delayed', urgent: true });
    supervisor.handleCommand({ type: 'unlock-workspace', ...command });
    expect(parentSession.prompt).not.toHaveBeenCalled();
    supervisor.handleCommand({ type: 'unlock-workspace', ...command, requestId: 'switch-2' });
    await settle();
    expect(parentSession.prompt).toHaveBeenCalledTimes(1);
    expect(parentSession.prompt.mock.calls[0][0]).not.toContain('workspace-branch-change');
  });

  it('对没有跑过一轮的空闲 coworker 调用 wait,返回文案含 no round completed yet', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool } = await spawnParentAndCoworker(events);

    const text = await textOf(
      coworkerTool.execute(
        't1',
        { operation: 'wait', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    );
    expect(text).toMatch(/no round completed yet/);
  });

  it('对没有跑过一轮的空闲 coworker 调用 report,返回文案含 no round completed yet', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool } = await spawnParentAndCoworker(events);

    const text = await textOf(
      coworkerTool.execute(
        't1',
        { operation: 'report', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    );
    expect(text).toMatch(/no round completed yet/);
  });

  it('operation=message 经 notifier 投递：idle 唤醒，不走 send/steer', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool, coworkerSession } = await spawnParentAndCoworker(events);
    await coworkerTool.execute(
      't-alice',
      { operation: 'spawn', name: 'alice', task: 'second hire' },
      undefined,
      undefined,
      {} as never
    );
    await settle();
    coworkerSession.prompt.mockClear();
    coworkerSession.steer.mockClear();

    const text = await textOf(
      coworkerTool.execute(
        't-msg',
        { operation: 'message', name: 'alice', to: 'bob', text: 'ping from alice' },
        undefined,
        undefined,
        {} as never
      )
    );
    expect(text).toMatch(/delivered to coworker "bob"/);
    await vi.advanceTimersByTimeAsync(200);
    expect(coworkerSession.steer).not.toHaveBeenCalled();
    expect(coworkerSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Message from coworker "alice":\nping from alice')
    );
  });

  it('message_coworker 直投对方会话，不 prompt 父会话', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerSession, coworkerTool } = await spawnParentAndCoworker(events);
    const parentSession = mocks.sessions[0] as ReturnType<typeof session>;
    await coworkerTool.execute(
      't-alice',
      { operation: 'spawn', name: 'alice', task: 'second hire' },
      undefined,
      undefined,
      {} as never
    );
    await settle();
    const aliceOptions = mocks.createAgentSession.mock.calls[2][0] as {
      customTools: Array<{
        name: string;
        execute(
          id: string,
          params: Record<string, unknown>,
          signal?: AbortSignal
        ): Promise<{ content: Array<{ type: string; text: string }> }>;
      }>;
    };
    const peerTool = aliceOptions.customTools.find((tool) => tool.name === 'message_coworker');
    expect(peerTool).toBeDefined();
    await vi.advanceTimersByTimeAsync(200);
    coworkerSession.prompt.mockClear();
    parentSession.prompt.mockClear();
    const text = await textOf(peerTool!.execute('t-peer', { to: 'bob', text: 'lock is yours' }));
    expect(text).toMatch(/delivered to coworker "bob"/);
    await vi.advanceTimersByTimeAsync(200);
    expect(coworkerSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Message from coworker "alice":\nlock is yours')
    );
    expect(parentSession.prompt).not.toHaveBeenCalled();
  });

  it('running 期间 wait 阻塞,agent_end(willRetry=false) 后以最后一条 assistant 文本resolve', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool, coworkerSession } = await spawnParentAndCoworker(events);

    coworkerSession.emit({ type: 'agent_start' });
    const waitPromise = textOf(
      coworkerTool.execute(
        't1',
        { operation: 'wait', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    );

    coworkerSession.messages.push({ role: 'assistant', content: 'round result text' });
    coworkerSession.emit({ type: 'agent_end', willRetry: false });

    const text = await waitPromise;
    expect(text).toMatch(/round result text/);
  });

  it('agent_end(willRetry=true) 不 resolve wait,随后终态 agent_end 才 resolve', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool, coworkerSession } = await spawnParentAndCoworker(events);

    coworkerSession.emit({ type: 'agent_start' });
    let resolved = false;
    const waitPromise = textOf(
      coworkerTool.execute(
        't1',
        { operation: 'wait', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    ).then((text) => {
      resolved = true;
      return text;
    });

    coworkerSession.emit({ type: 'agent_end', willRetry: true });
    await settle();
    expect(resolved).toBe(false);

    coworkerSession.messages.push({ role: 'assistant', content: 'final text' });
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    const text = await waitPromise;
    expect(resolved).toBe(true);
    expect(text).toMatch(/final text/);
  });

  it('wait 阻塞期间 dismiss-coworker 会 resolve wait,不会挂起', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool, coworkerSession, supervisor } = await spawnParentAndCoworker(events);

    coworkerSession.emit({ type: 'agent_start' });
    const waitPromise = textOf(
      coworkerTool.execute(
        't1',
        { operation: 'wait', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    );

    supervisor.handleCommand({
      type: 'dismiss-coworker',
      parent,
      coworkerId: 'parent::cw-bob',
    });

    await expect(waitPromise).resolves.toEqual(expect.any(String));
  });

  it('用户在 coworker 自己的 tab 里直接 prompt 完成一轮后,report 也能取到该轮文本', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool, coworkerSession, coworkerIdentity, supervisor } =
      await spawnParentAndCoworker(events);
    expect(coworkerIdentity).toBeDefined();

    supervisor.handleCommand({
      type: 'prompt',
      identity: coworkerIdentity,
      text: 'user typed directly in the coworker tab',
    });
    await settle();

    coworkerSession.emit({ type: 'agent_start' });
    coworkerSession.messages.push({ role: 'assistant', content: 'answer from user-driven round' });
    coworkerSession.emit({ type: 'agent_end', willRetry: false });

    const text = await textOf(
      coworkerTool.execute(
        't1',
        { operation: 'report', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    );
    expect(text).toMatch(/answer from user-driven round/);
  });

  it('父在 wait 阻塞期间,coworker 的 message_main_agent 返回含 waiting 的文案且不触发 notify', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool, coworkerSession, parentSession, childOptions } =
      await spawnParentAndCoworker(events);
    const messageMain = childOptions.customTools.find((tool) => tool.name === 'message_main_agent');
    expect(messageMain).toBeDefined();

    coworkerSession.emit({ type: 'agent_start' });
    // 不 await：只需要 wait 内部同步部分把 parentWaiting 置 true
    const waitPromise = textOf(
      coworkerTool.execute(
        't1',
        { operation: 'wait', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    );

    const result = (await messageMain!.execute(
      'call',
      { message: 'progress note', urgent: true },
      undefined
    )) as { content: Array<{ text: string }> };
    const text = result.content[0].text;
    expect(parentSession.prompt).not.toHaveBeenCalled();
    expect(text).toMatch(/waiting/);

    coworkerSession.messages.push({ role: 'assistant', content: 'done' });
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    await waitPromise;

    // wait 已结束,parentWaiting 复位;此时同样的 urgent 消息应正常触达父
    const result2 = (await messageMain!.execute(
      'call2',
      { message: 'after wait', urgent: true },
      undefined
    )) as { content: Array<{ text: string }> };
    expect(parentSession.prompt).toHaveBeenCalled();
    expect((result2.content[0] as { text: string }).text).not.toMatch(/waiting/);
  });

  it('spawn 与 wait 同批并行下发时,wait 等 spawn 落地并等首轮结束,而不是报 unknown coworker', async () => {
    const events: AgentWorkerEvent[] = [];
    // 第二个会话(coworker)的 prompt 挂起不归,模拟真实 pi:prompt 在 agent_end 之后才 resolve
    let releasePrompt: () => void = () => {};
    mocks.createAgentSession.mockImplementation(async (options: Record<string, unknown>) => {
      const value = session(options);
      if (mocks.sessions.length === 2) {
        value.prompt = vi.fn(
          () =>
            new Promise<undefined>((resolve) => {
              releasePrompt = () => resolve(undefined);
            })
        );
      }
      return { session: value };
    });
    const supervisor = new SessionSupervisor({
      emit: (event) => events.push(event),
      agentDir: '/tmp/agent',
      sessionDir: mkdtempSync(path.join(tmpdir(), 'enso-cw-')),
    });
    supervisor.handleCommand({ type: 'spawn-parent', identity: parent, cwd: '/workspace', model });
    await settleUntil(() => mocks.createAgentSession.mock.calls.length > 0);
    const parentOptions = mocks.createAgentSession.mock.calls[0][0] as {
      customTools: CoworkerToolLike[];
    };
    const coworkerTool = parentOptions.customTools.find(
      (tool) => (tool as unknown as { name: string }).name === 'coworker'
    ) as unknown as CoworkerToolLike;

    const spawnPromise = coworkerTool.execute(
      't1',
      { operation: 'spawn', name: 'bob', task: 'first task' },
      undefined,
      undefined,
      {} as never
    );
    let waited: string | undefined;
    const waitPromise = textOf(
      coworkerTool.execute(
        't2',
        { operation: 'wait', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    ).then((text) => {
      waited = text;
      return text;
    });
    await spawnPromise;
    await settle();
    expect(waited).toBeUndefined();
    const coworkerSession = mocks.sessions[1] as ReturnType<typeof session>;
    coworkerSession.emit({ type: 'agent_start' });
    coworkerSession.messages.push({ role: 'assistant', content: 'first round done' });
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    releasePrompt();

    expect(await waitPromise).toMatch(/first round done/);
  });

  it('wait 内联拿到本轮结果后,不再向父重复投递 finished a round 通知', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool, coworkerSession, parentSession } = await spawnParentAndCoworker(events);
    vi.advanceTimersByTime(2000);
    await settle();
    (parentSession.prompt as ReturnType<typeof vi.fn>).mockClear();
    // 真实 pi 的 prompt 到 agent_end 之后才归;这里挂起,由测试手动驱动事件
    coworkerSession.prompt = vi.fn(() => new Promise<undefined>(() => {}));

    await coworkerTool.execute(
      't1',
      { operation: 'send', name: 'bob', message: 'second task' },
      undefined,
      undefined,
      {} as never
    );
    await settle();
    coworkerSession.emit({ type: 'agent_start' });
    const waitPromise = textOf(
      coworkerTool.execute(
        't2',
        { operation: 'wait', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    );
    coworkerSession.messages.push({ role: 'assistant', content: 'inline result' });
    coworkerSession.emit({ type: 'agent_end', willRetry: false });
    expect(await waitPromise).toMatch(/inline result/);

    vi.advanceTimersByTime(2000);
    await settle();
    const notified = (parentSession.prompt as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
      String(call[0]).includes('finished a round')
    );
    expect(notified).toBe(false);
  });

  it('report 在一轮进行中时附注 in progress,提示改用 wait', async () => {
    const events: AgentWorkerEvent[] = [];
    const { coworkerTool, coworkerSession } = await spawnParentAndCoworker(events);
    coworkerSession.emit({ type: 'agent_start' });
    const text = await textOf(
      coworkerTool.execute(
        't1',
        { operation: 'report', name: 'bob' },
        undefined,
        undefined,
        {} as never
      )
    );
    expect(text).toMatch(/in progress/);
  });

  it('类型化 coworker 的资源加载器不装项目扩展(noExtensions),主会话与 general 子代理照常装', async () => {
    const events: AgentWorkerEvent[] = [];
    const supervisor = new SessionSupervisor({
      emit: (event) => events.push(event),
      agentDir: '/tmp/agent',
      sessionDir: mkdtempSync(path.join(tmpdir(), 'enso-cw-')),
    });
    supervisor.handleCommand({
      type: 'spawn-parent',
      identity: parent,
      cwd: '/workspace',
      model,
      agentTypes: [
        { name: 'scout', description: 'recon', systemPrompt: 'look', tools: 'readonly' },
      ],
    });
    await settleUntil(() => mocks.createAgentSession.mock.calls.length > 0);
    expect(mocks.loaderOptions[0]?.noExtensions).not.toBe(true);
    const parentOptions = mocks.createAgentSession.mock.calls[0][0] as {
      customTools: CoworkerToolLike[];
    };
    const coworkerTool = parentOptions.customTools.find(
      (tool) => (tool as unknown as { name: string }).name === 'coworker'
    ) as unknown as CoworkerToolLike;
    await coworkerTool.execute(
      't1',
      { operation: 'spawn', name: 'eyes', agent_type: 'scout', task: 'look around' },
      undefined,
      undefined,
      {} as never
    );
    await settle();
    expect(mocks.loaderOptions[1]?.noExtensions).toBe(true);
    await coworkerTool.execute(
      't2',
      { operation: 'spawn', name: 'plain', task: 'general helper' },
      undefined,
      undefined,
      {} as never
    );
    await settle();
    expect(mocks.loaderOptions[2]?.noExtensions).not.toBe(true);
  });

  it('子会话跟父开关下发 exec + explore-fold，不含嵌套 hire', async () => {
    const events: AgentWorkerEvent[] = [];
    const supervisor = new SessionSupervisor({
      emit: (event) => events.push(event),
      agentDir: '/tmp/agent',
      sessionDir: mkdtempSync(path.join(tmpdir(), 'enso-cw-')),
    });
    supervisor.handleCommand({
      type: 'spawn-parent',
      identity: parent,
      cwd: '/workspace',
      model,
      exploreFoldEnabled: true,
    });
    await settleUntil(() => mocks.createAgentSession.mock.calls.length > 0);
    const parentTools = (
      mocks.createAgentSession.mock.calls[0][0] as { customTools: Array<{ name: string }> }
    ).customTools.map((tool) => tool.name);
    expect(parentTools).toEqual(expect.arrayContaining(['exec', 'explore_mark', 'explore_fold']));
    const coworkerTool = (
      mocks.createAgentSession.mock.calls[0][0] as { customTools: CoworkerToolLike[] }
    ).customTools.find(
      (tool) => (tool as unknown as { name: string }).name === 'coworker'
    ) as unknown as CoworkerToolLike;
    await coworkerTool.execute(
      't1',
      { operation: 'spawn', name: 'bob', task: 'first task' },
      undefined,
      undefined,
      {} as never
    );
    await settle();
    const childTools = (
      mocks.createAgentSession.mock.calls[1][0] as { customTools: Array<{ name: string }> }
    ).customTools.map((tool) => tool.name);
    expect(childTools).toEqual(expect.arrayContaining(['exec', 'explore_mark', 'explore_fold']));
    expect(childTools).not.toContain('coworker');
    expect(childTools).not.toContain('subagent');
    const childFactories = mocks.loaderOptions[1]?.extensionFactories as
      | Array<{ name?: string }>
      | undefined;
    expect(childFactories?.some((factory) => factory.name === 'explore-fold')).toBe(true);
  });

  it('父关掉 isolated_sandbox / explore-fold 时子也不下发', async () => {
    const events: AgentWorkerEvent[] = [];
    const supervisor = new SessionSupervisor({
      emit: (event) => events.push(event),
      agentDir: '/tmp/agent',
      sessionDir: mkdtempSync(path.join(tmpdir(), 'enso-cw-')),
    });
    supervisor.handleCommand({
      type: 'spawn-parent',
      identity: parent,
      cwd: '/workspace',
      model,
      disabledTools: ['isolated_sandbox'],
    });
    await settleUntil(() => mocks.createAgentSession.mock.calls.length > 0);
    const parentTools = (
      mocks.createAgentSession.mock.calls[0][0] as { customTools: Array<{ name: string }> }
    ).customTools.map((tool) => tool.name);
    expect(parentTools).not.toContain('exec');
    expect(parentTools).not.toContain('explore_mark');
    const coworkerTool = (
      mocks.createAgentSession.mock.calls[0][0] as { customTools: CoworkerToolLike[] }
    ).customTools.find(
      (tool) => (tool as unknown as { name: string }).name === 'coworker'
    ) as unknown as CoworkerToolLike;
    await coworkerTool.execute(
      't1',
      { operation: 'spawn', name: 'bob', task: 'first task' },
      undefined,
      undefined,
      {} as never
    );
    await settle();
    const childTools = (
      mocks.createAgentSession.mock.calls[1][0] as { customTools: Array<{ name: string }> }
    ).customTools.map((tool) => tool.name);
    expect(childTools).not.toContain('exec');
    expect(childTools).not.toContain('explore_mark');
    const childFactories = mocks.loaderOptions[1]?.extensionFactories as
      | Array<{ name?: string }>
      | undefined;
    expect(childFactories?.some((factory) => factory.name === 'explore-fold')).toBeFalsy();
  });
});
