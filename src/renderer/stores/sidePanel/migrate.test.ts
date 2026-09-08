import { describe, expect, it } from 'vitest';
import { SIDE_PANEL_VERSION, splitLegacySnapshots } from './migrate';

describe('splitLegacySnapshots', () => {
  it('当前持久化版本为 4', () => {
    expect(SIDE_PANEL_VERSION).toBe(4);
  });

  it('版本低于 2 时重置旧状态且不迁移快照', () => {
    expect(splitLegacySnapshots({ snapshotsByConversation: { c1: { a: 'old' } } }, 1)).toEqual({
      state: { uiByConversation: {}, layouts: {} },
      snapshots: {},
    });
  });

  it('版本 2 迁移布局和变更模式并重置会话界面', () => {
    const persisted = {
      uiByConversation: { c1: { tab: 'changes' } },
      layouts: { c1: 'wide' },
      changesModeByConversation: { c1: 'all' },
    };
    expect(splitLegacySnapshots(persisted, 2).state).toEqual({
      uiByConversation: {},
      layouts: { c1: 'wide' },
      changesModeByConversation: { c1: 'all' },
    });
  });

  it('版本 3 保留会话界面并为缺失字段补空对象', () => {
    expect(splitLegacySnapshots({ uiByConversation: { c1: { tab: 'files' } } }, 3).state).toEqual({
      uiByConversation: { c1: { tab: 'files' } },
      layouts: {},
      changesModeByConversation: {},
    });
  });

  it('版本 2 或 3 只迁移普通对象中的字符串快照并丢弃空会话', () => {
    class Snapshot {
      file = 'old';
    }
    const snapshotsByConversation = {
      kept: { 'a.ts': 'old', count: 1, empty: '' },
      empty: { count: 1 },
      array: ['old'],
      nil: null,
      text: 'old',
      constructed: new Snapshot(),
    };
    for (const version of [2, 3]) {
      expect(splitLegacySnapshots({ snapshotsByConversation }, version).snapshots).toEqual({
        kept: { 'a.ts': 'old', empty: '' },
      });
    }
  });

  it('版本 4 及以上移除意外残留的快照字段并保留其余状态', () => {
    const persisted = {
      layouts: { c1: 'wide' },
      custom: 1,
      snapshotsByConversation: { c1: { a: 'old' } },
    };
    for (const version of [4, 5]) {
      expect(splitLegacySnapshots(persisted, version)).toEqual({
        state: { layouts: { c1: 'wide' }, custom: 1 },
        snapshots: {},
      });
    }
  });

  it('持久化值不是对象时按各版本安全返回空状态', () => {
    expect(splitLegacySnapshots(null, 3)).toEqual({
      state: { uiByConversation: {}, layouts: {}, changesModeByConversation: {} },
      snapshots: {},
    });
    expect(splitLegacySnapshots('bad', 4)).toEqual({ state: {}, snapshots: {} });
  });
});
