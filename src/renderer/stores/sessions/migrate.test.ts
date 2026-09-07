import { describe, expect, it } from 'vitest';
import { migrateSessions, SESSIONS_VERSION } from './migrate';

describe('migrateSessions', () => {
  it('v0 → v1: clears stale persisted started and lands terminal state for no-sessionFile sessions', () => {
    // 旧版本把 started:true 落进了 settings.json（运行态误持久化）。
    // migrate 只跑一次且回写磁盘，旧值就此消失——不靠 onRehydrateStorage 读侧补丁。
    const persisted = {
      conversations: {
        replayable: {
          id: 'replayable',
          started: true,
          status: 'running',
          sessionFile: '/tmp/replayable.jsonl',
        },
        orphan: { id: 'orphan', started: true, status: 'running' },
        clean: { id: 'clean', started: false, status: 'idle', sessionFile: '/tmp/clean.jsonl' },
      },
      order: ['replayable', 'orphan', 'clean'],
      activeId: 'clean',
    };
    const migrated = migrateSessions(persisted, 0) as typeof persisted & {
      conversations: Record<
        string,
        { started: boolean; status: string; error?: string; sessionFile?: string }
      >;
    };
    expect(migrated.conversations.replayable).toMatchObject({ started: false, status: 'idle' });
    expect(migrated.conversations.orphan).toMatchObject({
      started: false,
      status: 'failed',
      error: 'Session ended — history not restored',
    });
    expect(migrated.conversations.clean).toMatchObject({ started: false, status: 'idle' });
    expect(migrated.order).toEqual(persisted.order);
    expect(migrated.activeId).toBe('clean');
  });

  it('returns persisted data untouched when already at the current version', () => {
    const persisted = { conversations: {}, order: [], activeId: null };
    expect(migrateSessions(persisted, SESSIONS_VERSION)).toBe(persisted);
  });

  it('tolerates malformed persisted data without throwing', () => {
    expect(migrateSessions(null, 0)).toBe(null);
    expect(migrateSessions('junk', 0)).toBe('junk');
    expect(migrateSessions({ conversations: 'junk' }, 0)).toEqual({ conversations: 'junk' });
  });

  it('v1 → v2: fills missing runtime collections without wiping existing values', () => {
    const persisted = {
      conversations: {
        missing: { id: 'missing', started: false, status: 'idle' },
        nullish: {
          id: 'nullish',
          started: false,
          status: 'idle',
          toolOutputs: null,
          pendingApprovals: null,
        },
        kept: {
          id: 'kept',
          started: false,
          status: 'idle',
          toolOutputs: { t1: 'out' },
          toolStartedAt: { t1: 9 },
          pendingApprovals: [{ id: 'a1' }],
          pendingAsks: [{ id: 'q1' }],
          backgroundTasks: [{ id: 'b1' }],
          subagents: [{ id: 's1' }],
          customEntries: [1],
          dispatchMainEvents: { e1: { type: 'x' } },
        },
      },
      order: ['missing', 'nullish', 'kept'],
      activeId: 'missing',
    };
    const migrated = migrateSessions(persisted, 1) as typeof persisted & {
      conversations: Record<string, Record<string, unknown>>;
    };
    expect(migrated.conversations.missing).toMatchObject({
      status: 'idle',
      toolOutputs: {},
      toolStartedAt: {},
      pendingApprovals: [],
      pendingAsks: [],
      backgroundTasks: [],
      subagents: [],
      customEntries: [],
      dispatchMainEvents: {},
    });
    expect(migrated.conversations.nullish).toMatchObject({
      status: 'idle',
      toolOutputs: {},
      pendingApprovals: [],
    });
    expect(migrated.conversations.kept).toMatchObject({
      status: 'idle',
      toolOutputs: { t1: 'out' },
      toolStartedAt: { t1: 9 },
      pendingApprovals: [{ id: 'a1' }],
      pendingAsks: [{ id: 'q1' }],
      backgroundTasks: [{ id: 'b1' }],
      subagents: [{ id: 's1' }],
      customEntries: [1],
      dispatchMainEvents: { e1: { type: 'x' } },
    });
  });
});
