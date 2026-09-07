import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentWorkerEvent } from '@shared/types/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  managers: [] as Array<Record<string, unknown>>,
  mcpToolsFor: vi.fn(),
  createAgentSession: vi.fn(),
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
    messages: [] as unknown[],
    sessionFile: `/tmp/session-${mocks.sessions.length}.jsonl`,
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(event: { type: string; [key: string]: unknown }) {
      for (const listener of listeners) listener(event);
    },
    prompt: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    compact: vi.fn(async () => undefined),
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

async function waitFor(events: AgentWorkerEvent[], type: AgentWorkerEvent['type']): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (events.some((event) => event.type === type)) return;
    await settle();
  }
  throw new Error(`timed out waiting for ${type}`);
}

describe('SessionSupervisor compact failure', () => {
  beforeEach(() => {
    mocks.sessions.length = 0;
    mocks.managers.length = 0;
    mocks.createAgentSession.mockReset();
    rmSync(path.join(tmpdir(), 'enso-compact-sessions'), { recursive: true, force: true });
    mocks.mcpToolsFor.mockReset().mockResolvedValue([]);
    mocks.createAgentSession.mockImplementation(async (options: Record<string, unknown>) => ({
      session: session(options),
    }));
  });

  it('compaction_end 已带错误时不再因 compact() 抛错重复上报', async () => {
    const events: AgentWorkerEvent[] = [];
    const supervisor = new SessionSupervisor({
      emit: (event) => events.push(event),
      agentDir: '/tmp/agent',
      sessionDir: mkdtempSync(path.join(tmpdir(), 'enso-compact-')),
    });
    supervisor.handleCommand({
      type: 'spawn-parent',
      identity: parent,
      cwd: '/workspace',
      model,
    });
    await waitFor(events, 'parent-ready');
    const parentSession = mocks.sessions[0] as ReturnType<typeof session>;
    parentSession.compact.mockImplementation(async () => {
      parentSession.emit({ type: 'compaction_start' });
      parentSession.emit({
        type: 'compaction_end',
        errorMessage: 'Nothing to compact (session too small)',
      });
      throw new Error('Compaction failed: Nothing to compact (session too small)');
    });

    supervisor.handleCommand({ type: 'compact', identity: parent });
    await settle();
    await settle();

    const ends = events.filter((event) => event.type === 'compaction' && event.state === 'end');
    expect(ends).toEqual([
      expect.objectContaining({
        type: 'compaction',
        state: 'end',
        error: 'Nothing to compact (session too small)',
      }),
    ]);
    await supervisor.shutdown();
  });

  it('compact() 直接抛错且未发 compaction_end 时仍上报一次', async () => {
    const events: AgentWorkerEvent[] = [];
    const supervisor = new SessionSupervisor({
      emit: (event) => events.push(event),
      agentDir: '/tmp/agent',
      sessionDir: mkdtempSync(path.join(tmpdir(), 'enso-compact-')),
    });
    supervisor.handleCommand({
      type: 'spawn-parent',
      identity: parent,
      cwd: '/workspace',
      model,
    });
    await waitFor(events, 'parent-ready');
    const parentSession = mocks.sessions[0] as ReturnType<typeof session>;
    parentSession.compact.mockRejectedValue(new Error('compact unavailable'));

    supervisor.handleCommand({ type: 'compact', identity: parent });
    await settle();
    await settle();

    const ends = events.filter((event) => event.type === 'compaction' && event.state === 'end');
    expect(ends).toEqual([
      expect.objectContaining({
        type: 'compaction',
        state: 'end',
        error: 'compact unavailable',
      }),
    ]);
    await supervisor.shutdown();
  });
});
