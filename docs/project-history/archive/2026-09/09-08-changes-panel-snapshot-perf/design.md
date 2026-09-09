# Design: 会话快照落盘

## Boundaries

- **Main**：新 service `src/main/services/changesSnapshots.ts`（纯 fs 逻辑）+ ipc `src/main/ipc/changes.ts`。
- **Shared**：`IPC_CHANNELS` 新增三条；无新共享类型（返回 `Record<string,string>` / `boolean`）。
- **Preload**：`electronAPI.changes.{readSnapshots, writeSnapshots}`。
- **Renderer**：`stores/sidePanel` 去 persist 快照 + 迁移；`ChangesView` 挂载时按会话回读。
- 不动 sessions store、不动 CodeView、不动 git 模式。

## 存储

目录 `app.getPath('userData')/changes-snapshots/`，文件 `<conversationId>.json`，内容
`Record<relPath, oldText>`（与现在 `snapshotsByConversation[id]` 形状一致）。

`conversationId` 只接受 uuid（复用 `instructionStore.isValidId` 同款正则），非法直接拒绝。

写入：整文件原子写（`.tmp` + `renameSync`）。单会话快照最多几百 KB，触发频率是「新文件首次
被改」级别，不需要防抖。空对象 → 删除文件。

## Service 接口（可单测，注入 dir）

```ts
export function readSnapshots(dir: string, conversationId: string): Record<string, string>;
export function writeSnapshots(dir: string, conversationId: string, snapshots: Record<string, string>): boolean;
export function pruneSnapshots(dir: string, liveIds: ReadonlySet<string>): void;
```

- `read`：文件不存在 / JSON 坏 / 形状不是 `Record<string,string>` → `{}`（逐键过滤非 string）。
- `prune`：只删 `dir` 下 `<uuid>.json` 且 uuid 不在 `liveIds` 的文件；其它文件不动。

## IPC

| 通道 | 入参 | 出参 |
| --- | --- | --- |
| `CHANGES_SNAPSHOTS_READ: 'changes:snapshots-read'` | `{ conversationId }` | `Record<string,string>` |
| `CHANGES_SNAPSHOTS_WRITE: 'changes:snapshots-write'` | `{ conversationId, snapshots }` | `boolean` |

ipc 层：unknown 收窄，`snapshots` 逐键只保留 string 值。

清理：`registerChangesHandlers()` 里首次收到任一请求时（惰性一次）读 `readSettings()['enso-conversations'].state.conversations`
的 key 集合（含 coworker 子会话），调用 `pruneSnapshots`。读不到会话表或会话表为空（可能是半截写入）时跳过清理（宁可不删）。

`write` 的 `snapshots` 畸形（缺失 / 非对象）返回 false 而非当空对象——空对象在 service 层语义是删文件。

## Renderer

`stores/sidePanel/index.ts`：

- `snapshotsByConversation` 保留为运行态字段，**从 `partialize` 移除**。
- `saveSnapshots(conversationId, snapshots)`：set 内存 + `void window.electronAPI.changes.writeSnapshots(...)`。
- 新增 `loadSnapshots(conversationId)`：若内存已有该会话键则跳过；否则 IPC 读后 set（读回为空也 set `{}`，
  标记已加载，避免重复读）。
- `version: 4`，`migrate`：`version < 4` 时把旧 `snapshotsByConversation` 逐会话 `writeSnapshots` 到磁盘
  （fire-and-forget，`window.electronAPI?.changes` 不存在时跳过），返回的状态不含快照。
  migrate 幂等：v4 状态无快照字段，再跑无副作用。

`ChangesView.tsx`：

- `mode === 'all'` 时 `useEffect` 调 `loadSnapshots(conversationId)`。
- 已加载前 `snapshots` 为 `undefined`：此时**不要**跑 `aggregateSessionChanges` 写快照（否则会用
  reconstruct 结果覆盖磁盘上更早的快照）。`allResult` 在 `snapshots === undefined` 时返回空，
  保存 effect 同样跳过。

phone stub：`changes.readSnapshots → {}`、`writeSnapshots → false`。

## Tradeoffs

- 每次 save 重写整会话文件而非增量：简单、原子；量级几百 KB 可接受。
- 迁移在 renderer `migrate` 里发 IPC：有副作用但一次性且幂等；失败只是丢旧 old，Session 模式退回
  reconstruct，与清站点数据同等级。
- 清理放主进程惰性触发而非 `removeConversation`：避免改 sessions store 及其大量 mock 测试；
  删除会话后到下次启动前文件残留，可接受。

## Rollback

回退代码后 v4 的 localStorage 不含快照，旧代码 `migrate` 直取 `old`，快照为空，Session 模式走
reconstruct；磁盘目录成为孤儿，无害。
