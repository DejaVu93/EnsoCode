/**
 * R2 闲置自动归档的 store 动作测试。契约见
 * docs/project-history/09-08-sidebar-auto-archive/design.md：只批量 patch 归档字段，
 * 不碰磁盘（不 cleanupWorktree / worktree.remove / agent.release / removeConversation）。
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from '../settings';
import type * as SessionsModule from './index';

const agentRelease = vi.fn(async () => ({ ok: true }));
const wtRemove = vi.fn(async () => ({ ok: true as const, value: null }));

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
      removeConversation: vi.fn(async () => ({ accepted: false as const, error: 'test' })),
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

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

/** 待实现的动作：用可选签名取，避免 typecheck 卡在实现之前 */
type AutoArchiveAction = { autoArchiveStaleConversations?: (now?: number) => void };
const action = () => sessions.useSessionsStore.getState() as unknown as AutoArchiveAction;

function conv(id: string, ageDays: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'project',
    title: id,
    started: false,
    spawning: false,
    status: 'idle',
    messages: [],
    createdAt: NOW - ageDays * DAY,
    lastActiveAt: NOW - ageDays * DAY,
    ...extra,
  };
}

function seed(conversations: Record<string, unknown>, idleDays: number) {
  sessions.useSessionsStore.setState({
    conversations,
    order: Object.keys(conversations),
    activeId: null,
  } as never);
  settings.useSettingsStore.setState({ autoArchiveIdleDays: idleDays } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('autoArchiveStaleConversations', () => {
  it('是 store 上的动作', () => {
    expect(typeof action().autoArchiveStaleConversations).toBe('function');
  });

  it('idleDays=30：40 天闲置的归档，10 天的不动', () => {
    seed({ stale: conv('stale', 40), fresh: conv('fresh', 10) }, 30);
    action().autoArchiveStaleConversations?.(NOW);
    const after = sessions.useSessionsStore.getState().conversations;
    expect(after.stale).toMatchObject({ archived: true, archivedAt: NOW });
    expect(after.fresh.archived).toBeUndefined();
  });

  it('置顶的 40 天闲置会话不归档，pinned 保留', () => {
    seed({ kept: conv('kept', 40, { pinned: true }) }, 30);
    action().autoArchiveStaleConversations?.(NOW);
    const kept = sessions.useSessionsStore.getState().conversations.kept;
    expect(kept.archived).toBeUndefined();
    expect(kept.pinned).toBe(true);
  });

  it('省略 now 时用 Date.now() 写 archivedAt', () => {
    vi.setSystemTime(NOW);
    seed({ stale: conv('stale', 40) }, 30);
    action().autoArchiveStaleConversations?.();
    expect(sessions.useSessionsStore.getState().conversations.stale).toMatchObject({
      archived: true,
      archivedAt: NOW,
    });
    vi.useRealTimers();
  });

  it('idleDays=0（从不）：100 天闲置也不归档', () => {
    seed({ ancient: conv('ancient', 100) }, 0);
    action().autoArchiveStaleConversations?.(NOW);
    expect(sessions.useSessionsStore.getState().conversations.ancient.archived).toBeUndefined();
  });

  it('隔离 worktree 会话不归档，也不动磁盘/worker', () => {
    seed(
      {
        iso: conv('iso', 40, {
          worktree: { conversationId: 'iso', path: '/managed/iso', branch: 'enso/iso' },
        }),
        plain: conv('plain', 40),
      },
      30
    );
    action().autoArchiveStaleConversations?.(NOW);
    const after = sessions.useSessionsStore.getState().conversations;
    expect(after.iso.archived).toBeUndefined();
    expect(after.iso.worktree).toBeDefined();
    expect(after.plain.archived).toBe(true);
    expect(wtRemove).not.toHaveBeenCalled();
    expect(agentRelease).not.toHaveBeenCalled();
  });
});
