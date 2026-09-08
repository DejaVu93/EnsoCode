# 侧栏旧会话增量展开与自动归档

## Goal

侧栏项目树不再一次摊开全部旧会话。冷会话按设定天数进 Archived；已合并的隔离 worktree 可另开开关清理并归档；归档超过设定天数可自动删除（不可恢复）。闲置归档默认 30 天且只改归属；后两项默认关。

## Background

当前每个项目默认露出 5 条，其余进「展开其余 N 条」；一点就整表摊开。Archived 栏目、手动归档、按 7/15/30 天**手动**清理已归档已经存在。对照 Cursor / DeepChat / Orca：主导航只放工作集。

已拍板：增量展开 + 闲置自动归档（默认 30 天）+ 已合并 worktree 清理并归档（默认关）+ 归档超期自动删除（默认关，文案警告不可恢复）。不做项目内多级时间桶。

## Confirmed facts

- 项目默认露出 `COLLAPSED_SESSION_LIMIT = 5`（`sessionSwitchSlots.ts`）；桌面与手机都是一次展开剩余全部。
- 归档标记：`archived` + `archivedAt`；`toggleArchiveConversation` 会清 `pinned`。
- 手动归档隔离会话会先 `cleanupWorktree`（release + `worktree.remove` + 回退主树）；取消归档不重建 worktree。
- `WorktreeStatus`：`exists` / `dirty` / `ahead`。`worktreeHasPendingWork` = dirty 或 ahead>0。
- 「已合并且可安全清理」= `exists && !dirty && ahead === 0`。状态未知不得自动清理。
- Active 判定复用 `conversationDotTone`：running / waiting / failed / unread。
- 最后活跃时间：`messages.at(-1).timestamp ?? lastActiveAt ?? createdAt`（`pinned.ts`）。
- 仅打开会话不会刷新 `lastActiveAt`。
- 已归档超期判定已有 `staleArchivedConversationIds`：`archivedAt ?? lastActiveAt`，底栏手动清理用 7/15/30 天。
- `removeConversation` 会删列表项、release worker、`purgeConversationAuthority`，有 worktree 则 `worktree.remove`。不可恢复。
- 设置项走 `stores/settings/`；新标量用 `initialState` 缺省即可，不必升 `SETTINGS_VERSION`。
- 设置 UI 已有「从不 / N」下拉先例：`generationStallTimeoutMin`。

## Requirements

### R1 增量展开

- 项目未搜索时，默认仍只露最近 5 条。
- 「展开其余 N」每次再露出 15 条，而不是一次摊开剩余全部。
- 已全部露出时按钮改为「收起」，回到默认 5 条。
- 按钮文案是剩余未露出条数。
- 右键「归档这 N 条」针对当前未露出的尾部。
- 搜索时展示全部命中。
- 展开量是会话内 UI 状态，重启回到 5 条。
- Cmd/Ctrl+1–9 只计入当前已露出的行。
- 手机 `SessionDrawer` 同步同一套增量展开。

### R2 闲置自动归档

- 设置：「超过 N 天未活跃的会话自动归档」；`从不` / `7` / `14` / `30` / `90` 天；缺省 `30`。
- `0` = 从不。非法值回落 `30`。
- 只改归属：`archived: true`、`archivedAt: now`、清 `pinned`。不删会话或 jsonl。
- 不归档：已归档、置顶、当前 `activeId`、running / waiting / failed / unread、仍挂隔离 worktree 的会话。
- 活跃时刻沿用 `pinned.ts`；只点开不算活跃。
- 取消归档后若仍超阈值，下次扫描会再归档。不引入「不再自动归档」锁。
- 文案写明：这不是删除。

### R3 已合并 worktree：清理并归档

- 设置开关「清理并归档已合并的隔离 worktree」；**缺省关**。
- 打开后：`exists && !dirty && ahead === 0` 的隔离会话走 `cleanupWorktree` 再标 Archived。
- 不要求满闲置天数。
- 仍跳过：置顶、当前打开、running / waiting / failed / unread、dirty、ahead>0、status 未知。
- `exists === false`：只标归档，不再 `remove`。
- 清理失败该条不归档。
- 文案写明：会删除隔离目录，会话回退主工作树。

### R4 归档超期自动删除

- 设置：「自动删除归档超过 N 天的会话」；`从不` / `7` / `15` / `30` / `90` 天；**缺省从不（0）**。
- 非法值回落 `0`（关），避免脏盘误删。
- 候选复用 `staleArchivedConversationIds`（`archivedAt ?? lastActiveAt`）。
- 跳过当前 `activeId`（正在看的归档会话不删）。
- 打开后按现有 `removeConversation` 删除：列表、worker、会话权威；仍挂 worktree 的一并 remove。
- **不可恢复**：设置项标题下必须有警告（中英），写明会话与记录无法还原。
- 与底栏手动清理并存；自动删除不弹确认（警告在设置里一次说清）。
- 水合后、该天数变化后各扫一次。天数从「从不」改到正数会立刻按新阈值删，设置文案须点明。

### 扫描时机（R2–R4 共用）

- 会话水合完成后跑适用的扫描。
- 对应设置变化后跑对应扫描。
- R3 另挂在现有 `refreshWorktreeStatuses` 成功之后。
- 不另开分钟 timer。

### 同步

- 归档/删除结果随现有 `pairCatalog` 到手机。手机不跑扫描。

## Out of scope

- 项目内多级时间桶、独立历史面板、目录分页。
- 打开会话刷新 `lastActiveAt`。
- 未合并或 dirty 的隔离 worktree 自动清理。
- 删除前再弹一次确认（警告只在设置）。
- 回收站 / 撤销删除。
- 新设置分类页。

## Acceptance Criteria

- [ ] AC1 20 条未归档、未搜索：初始 5 条；点一次后 20 条；收起回到 5 条。
- [ ] AC2 91 条时第一次展开后 20 条，按钮「展开其余 71 条」，不会一次露出 91 条。
- [ ] AC3 搜索命中折叠尾时直接出现。
- [ ] AC4 闲置 30 天：超期非豁免普通会话进 Archived。
- [ ] AC5 置顶、当前打开、Active 态、以及仍挂不安全隔离 worktree 的会话不被闲置归档。
- [ ] AC6 闲置设「从不」后不再自动归档；已归档的可手动恢复。
- [ ] AC7 闲置归档不删除；取消归档后若仍超阈值，下次会再归档。
- [ ] AC8 改闲置天数后立即按新阈值扫描。
- [ ] AC9 手机同样按 15 条增量展开。
- [ ] AC10 worktree 开开关：已合并且干净的隔离会话 cleanup + 归档；dirty / 未合并 / 未知不动。默认关。
- [ ] AC11 worktree 开关不要求满闲置天数；置顶或当前打开仍跳过。
- [ ] AC12 自动删除默认「从不」；设为 30 天后，归档超过 30 天的会话从列表消失且不可恢复。
- [ ] AC13 正在打开的归档会话即使超期也不自动删除。
- [ ] AC14 设置页自动删除项旁有不可恢复警告；从「从不」改到正数的说明包含「将立即删除已超期的归档」。

## Notes

复杂任务。展开上限、闲置候选、已合并判定、超期删除候选均可单测。
