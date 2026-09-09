# Worktree 根目录支持自定义

## 背景

会话隔离 worktree 目前固定托管在 `userData/worktrees/<projectId>/<shortId>`（`src/main/ipc/worktree.ts` 的 `worktreesRoot()`）。用户希望能把 worktree 放到自选目录（例如项目旁的固定目录，便于 IDE 打开或磁盘管理）。

## 需求

1. 新增**全局**设置项「Worktree 根目录」：所有项目的 worktree 都建在其下，目录结构保持 `root/<projectId>/<shortId>` 不变。
2. 为空时沿用默认 `userData/worktrees`。
3. 设置项在 Settings → General 中可编辑：文本输入（blur/Enter 提交）+「浏览」按钮选目录，与现有路径类输入一致。
4. 仅接受绝对路径；非绝对路径 UI 提示错误且不提交。main 侧对非法值（非字符串 / 空 / 非绝对）一律回落默认，不抛错。
5. 该设置是设备本地配置，**不参与 config-sync**。
6. 创建（`WORKTREE_CREATE`）与重建（`WORKTREE_REBUILD`）都使用解析后的 root；已存在的 worktree 记录持有绝对 `path`，不受设置变更影响（不做迁移）。

## 非目标

- 按项目单独设置、路径模板（`{repo}` 等占位符）。
- 已有 worktree 的迁移。

## 验收标准

- [ ] `resolveWorktreeRoot(value, fallback)` 纯函数有单测：空/非字符串/相对路径 → fallback；绝对路径（trim 后）→ 原值。
- [ ] 设置为 `/tmp/x` 后新建隔离会话，worktree 落在 `/tmp/x/<projectId>/<shortId>`；清空后回到 `userData/worktrees`。
- [ ] 设置项出现在 General 页，输入非绝对路径显示错误。
- [ ] `worktreeRoot` 已登记到 `SETTINGS_STATE_FIELDS`、config-sync 排除表、capability coverage fixture；`pnpm typecheck && pnpm test` 通过、`biome check` 干净。
