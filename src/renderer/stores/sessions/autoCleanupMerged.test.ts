/**
 * R3 已合并 worktree 自动清理 + 归档的 store 动作测试。契约见
 * .trellis/tasks/09-08-sidebar-auto-archive/design.md：开关开时对
 * exists && !dirty && ahead===0 的隔离会话走 cleanupWorktree 后归档；
 * exists===false 只归档不动磁盘；其余一律跳过。不调 removeConversation。
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from '../settings';
import type * as SessionsModule from './index';

const agentRelease = vi.fn(async () => ({ ok: true }));
const wtRemove = vi.fn(async () => ({ ok: true as const, value: null }));
const removeConversation = vi.fn(async () => ({ accepted: false as const, error: 'test' }));

vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', {
  documentElement: {
    lang: 'en',
    classList: { toggle: vi.fn() },
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
  },
});
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
  electronAPI: {
    settings: {
      read: vi.fn(async () => null),
      writeKey: vi.fn(async () => true),
      onChanged: vi.fn(),
    },
    capabilities: { onAsk: vi.fn(() => vi.fn()), respond: vi.fn(async () => ({ ok: true })) },
    agent: {
      onFocusSession: vi.fn(),
      onEvent: vi.fn(() => vi.fn()),
      requestSnapshot: vi.fn(async () => ({ ok: true })),
      spawn: vi.fn(async () => ({ ok: true })),
      prompt: vi.fn(async () => ({ ok: true })),
      release: agentRelease,
      abort: vi.fn(async () => ({ ok: true })),
      dismissCoworker: vi.fn(async () => ({ ok: true })),
    },
    agentDispatch: {
      bindSource: vi.fn(),
      registerModelSelection: vi.fn(),
      dispatch: vi.fn(),
      onEvent: vi.fn(() => vi.fn()),
    },
    sourceAuthority: {
      read: vi.fn(async () => ({ projects: [], conversations: [] })),
      onChanged: vi.fn(() => vi.fn()),
      createProject: vi.fn(),
      selectProject: vi.fn(),
      removeProject: vi.fn(),
      createConversation: vi.fn(),
      selectConversation: vi.fn(),
      endConversation: vi.fn(async () => ({ accepted: false as const, error: 'test' })),
      removeConversation,
      updateConversationSelection: vi.fn(),
    },
    worktree: {
      create: vi.fn(),
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      status: vi.fn(async () => ({ ok: true, value: { exists: true, dirty: false, ahead: 0 } })),
      remove: wtRemove,
      rebuild: vi.fn(),
      repoClean: vi.fn(async () => ({ ok: true as const, value: true })),
    },
  },
});

let sessions: typeof SessionsModule;
let settings: typeof SettingsModule;

beforeAll(async () => {
  settings = await import('../settings');
  sessions = await import('./index');
});

const NOW = 1_800_000_000_000;
const CLEAN = { exists: true, dirty: false, ahead: 0 };

/** 待实现的动作：用可选签名取，避免 typecheck 卡在实现之前 */
type AutoCleanupAction = { autoCleanupMergedWorktrees?: (now?: number) => void | Promise<void> };
const action = () => sessions.useSessionsStore.getState() as unknown as AutoCleanupAction;

function conv(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'project',
    title: id,
    started: false,
    spawning: false,
    status: 'idle',
    messages: [],
    createdAt: NOW,
    lastActiveAt: NOW,
    worktree: { conversationId: id, path: `/managed/${id}`, branch: `enso/${id}` },
    ...extra,
  };
}

function seed(
  conversations: Record<string, unknown>,
  worktreeStatuses: Record<string, unknown>,
  options: { enabled: boolean; activeId?: string | null } = { enabled: true }
) {
  sessions.useSessionsStore.setState({
    conversations,
    order: Object.keys(conversations),
    activeId: options.activeId ?? null,
    worktreeStatuses,
  } as never);
  settings.useSettingsStore.setState({
    autoArchiveMergedWorktrees: options.enabled,
    projects: [{ id: 'project', name: 'Project', path: '/workspace' }],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('autoCleanupMergedWorktrees', () => {
  it('是 store 上的动作', () => {
    expect(typeof action().autoCleanupMergedWorktrees).toBe('function');
  });

  it('开关关闭：已合并且干净的隔离会话不清理、不归档', async () => {
    seed({ merged: conv('merged') }, { merged: CLEAN }, { enabled: false });
    await action().autoCleanupMergedWorktrees?.(NOW);
    const merged = sessions.useSessionsStore.getState().conversations.merged;
    expect(merged.archived).toBeUndefined();
    expect(merged.worktree).toBeDefined();
    expect(wtRemove).not.toHaveBeenCalled();
    expect(agentRelease).not.toHaveBeenCalled();
  });

  it('开关开启 + exists/干净/ahead=0：清理 worktree 后归档', async () => {
    seed({ merged: conv('merged') }, { merged: CLEAN });
    await action().autoCleanupMergedWorktrees?.(NOW);
    expect(wtRemove).toHaveBeenCalledWith('merged');
    const merged = sessions.useSessionsStore.getState().conversations.merged;
    expect(merged.worktree).toBeUndefined();
    expect(merged).toMatchObject({ archived: true, archivedAt: NOW });
    expect(removeConversation).not.toHaveBeenCalled();
  });

  it('dirty 或 ahead>0：不清理不归档', async () => {
    seed(
      { dirty: conv('dirty'), ahead: conv('ahead') },
      {
        dirty: { exists: true, dirty: true, ahead: 0 },
        ahead: { exists: true, dirty: false, ahead: 2 },
      }
    );
    await action().autoCleanupMergedWorktrees?.(NOW);
    const after = sessions.useSessionsStore.getState().conversations;
    expect(after.dirty.archived).toBeUndefined();
    expect(after.ahead.archived).toBeUndefined();
    expect(after.dirty.worktree).toBeDefined();
    expect(after.ahead.worktree).toBeDefined();
    expect(wtRemove).not.toHaveBeenCalled();
  });

  it('状态未知：不清理不归档', async () => {
    seed({ unknown: conv('unknown') }, {});
    await action().autoCleanupMergedWorktrees?.(NOW);
    const unknown = sessions.useSessionsStore.getState().conversations.unknown;
    expect(unknown.archived).toBeUndefined();
    expect(unknown.worktree).toBeDefined();
    expect(wtRemove).not.toHaveBeenCalled();
  });

  it('worktree 已不存在：直接归档且不调 worktree.remove', async () => {
    seed({ gone: conv('gone') }, { gone: { exists: false, dirty: false, ahead: 0 } });
    await action().autoCleanupMergedWorktrees?.(NOW);
    const gone = sessions.useSessionsStore.getState().conversations.gone;
    expect(gone).toMatchObject({ archived: true, archivedAt: NOW });
    expect(wtRemove).not.toHaveBeenCalled();
  });

  it('置顶、当前打开、Active 态：一律跳过', async () => {
    seed(
      {
        pinned: conv('pinned', { pinned: true }),
        open: conv('open'),
        running: conv('running', { status: 'running', started: true }),
      },
      { pinned: CLEAN, open: CLEAN, running: CLEAN },
      { enabled: true, activeId: 'open' }
    );
    await action().autoCleanupMergedWorktrees?.(NOW);
    const after = sessions.useSessionsStore.getState().conversations;
    expect([after.pinned.archived, after.open.archived, after.running.archived]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(wtRemove).not.toHaveBeenCalled();
    expect(agentRelease).not.toHaveBeenCalled();
  });

  it('清理失败：不归档，worktree 保留', async () => {
    seed({ merged: conv('merged') }, { merged: CLEAN });
    wtRemove.mockResolvedValueOnce({ ok: false, error: 'worktree busy' } as never);
    await action().autoCleanupMergedWorktrees?.(NOW);
    const merged = sessions.useSessionsStore.getState().conversations.merged;
    expect(merged.archived).toBeUndefined();
    expect(merged.worktree).toBeDefined();
  });
});
