# Design: 侧栏增量展开与自动归档

## Boundaries

- **纯逻辑（可单测）**
  - `shownConversationCount` / `nextRevealedExtra`（步长 15）。
  - `staleUnarchivedConversationIds`（闲置归档候选）。
  - `worktreeReadyToAutoCleanup`（`exists && !dirty && ahead === 0`）。
  - `normalizeAutoArchiveIdleDays` → `0 | 7 | 14 | 30 | 90`，非法回落 30。
  - `normalizeAutoDeleteArchivedDays` → `0 | 7 | 15 | 30 | 90`，非法回落 **0**（关，防误删）。
  - 超期删除候选：已有 `staleArchivedConversationIds`，再滤掉 `activeId`。
- **设置**：`autoArchiveIdleDays`（默认 30）、`autoArchiveMergedWorktrees`（默认 false）、`autoDeleteArchivedDays`（默认 0）。无主题类副作用，不写 `applySettings()`。
- **会话写入**
  - 闲置：批量 patch 归档字段，不 cleanup。
  - 已合并：逐条 `cleanupWorktree` + 归档。
  - 超期删除：对候选逐条现有 `removeConversation`（含 worktree / worker / authority）。
- **UI**：通用设置三行（天数 Select、worktree Switch、删除天数 Select + 警告）。侧栏展开状态改为 `revealedExtras`。

## Contracts

```ts
export const COLLAPSED_SESSION_LIMIT = 5;
export const SESSION_EXPAND_STEP = 15;
export const AUTO_ARCHIVE_IDLE_DAYS = [0, 7, 14, 30, 90] as const;
export const DEFAULT_AUTO_ARCHIVE_IDLE_DAYS = 30;
export const AUTO_DELETE_ARCHIVED_DAYS = [0, 7, 15, 30, 90] as const;
export const DEFAULT_AUTO_DELETE_ARCHIVED_DAYS = 0;

shownConversationCount(total, revealedExtra): number
nextRevealedExtra(total, revealedExtra): number  // 已满 → 0（收起）
worktreeReadyToAutoCleanup(status): boolean      // 未知 → false
staleUnarchivedConversationIds({ order, conversations, now, idleDays, activeId })
```

闲置候选：`idleDays>0`、未归档、未置顶、非 activeId、无 worktree、非 Active tone、活跃时间超阈值。

删除候选：`staleArchivedConversationIds(..., days, now)` 且 id ≠ activeId；`days===0` → 空。

## Data flow

```
hydrate / 设置变化
  ├─ autoArchiveIdleDays>0     → patch archived
  ├─ autoArchiveMergedWorktrees → cleanupWorktree + archived（status 已刷新）
  └─ autoDeleteArchivedDays>0  → removeConversation（不可恢复）
```

R3 额外：`refreshWorktreeStatuses` 成功后跑。不另开 timer。

## Compatibility

- 旧盘无新字段：用 initialState。不升 `SETTINGS_VERSION`。
- 删除天数脏值必须回落 0，不能回落 30。
- 闲置批次不得 cleanup。R3 仅限 `worktreeReadyToAutoCleanup`。
- 自动删除不二次确认；警告只在设置。

## Tradeoffs

| 选择 | 原因 |
|---|---|
| 闲置默认 30 | 已拍板。 |
| worktree / 自动删除默认关 | 动磁盘或不可恢复，须显式打开。 |
| 删除天数非法回落 0 | 宁可关，不可误删。 |
| 删除选项 7/15/30/90 | 对齐底栏手动清理的 7/15/30。 |
| 跳过 activeId | 正在看的归档不当面消失。 |
| 删除走 `removeConversation` | 与手动删除同一条路径，含权威与 worktree。 |

## Rollback

闲置改「从不」、两个危险项保持关。已删除的无法回滚。
