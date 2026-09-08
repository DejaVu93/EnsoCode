# Implement: 侧栏增量展开与自动归档

## Checklist

1. **展开步长（TDD）** — `sessionSwitchSlots.ts`：`SESSION_EXPAND_STEP`、`shownConversationCount`、`nextRevealedExtra`；`expandedProjects` → `revealedExtras`。

2. **闲置 / 已合并 / 删除候选（TDD）** — `pinned.ts`：`staleUnarchivedConversationIds`、`worktreeReadyToAutoCleanup`；删除复用 `staleArchivedConversationIds` 并排除 `activeId`。

3. **设置**
   - `autoArchiveIdleDays` 默认 30；非法 → 30。
   - `autoArchiveMergedWorktrees` 默认 false。
   - `autoDeleteArchivedDays` 默认 0；非法 → 0。
   - `GeneralSettings` 三行；删除项必须有不可恢复警告 + 「改成正数将立即删除已超期归档」。
   - `i18n.ts` 补中英。不必升 `SETTINGS_VERSION`。

4. **会话扫描**
   - `autoArchiveStaleConversations`：批量 patch。
   - `autoCleanupMergedWorktrees`：开关关 no-op；否则逐条 cleanup + 归档。
   - `autoDeleteStaleArchived`：天数为 0 no-op；否则对候选 `removeConversation`。
   - 水合后跑 R2+R4；设置变化跑对应项；status 刷新后跑 R3。

5. **桌面侧栏** — `revealedExtras`；按钮与右键归档切未露出尾。

6. **手机** — 只同步增量展开。

7. **验证** — 相关 vitest + typecheck + biome。

## Validation

```bash
pnpm exec vitest run \
  src/renderer/stores/sessions/sessionSwitchSlots.test.ts \
  src/renderer/stores/sessions/pinned.test.ts \
  src/renderer/stores/settings/autoArchiveIdleDays.test.ts
pnpm typecheck
```

## Risks

- 自动删除不可恢复：默认 0、脏值回落 0、跳过 activeId。
- `removeConversation` 会顺带删残余 worktree；仅已归档会话进入此路径。
- 闲置扫描不得 cleanup；R3 必须有最新 status。
