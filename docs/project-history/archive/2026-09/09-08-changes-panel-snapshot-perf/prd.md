# PRD: Changes 面板卡顿——会话快照移出 localStorage

## 背景

右侧侧边栏 Changes 面板「Session」模式为了显示编辑前/后 diff，把每个被改文件的**编辑前全文**
存进 `useSidePanelStore.snapshotsByConversation`，并随 `enso-side-panel` 一起 persist 到
localStorage，且永不清理。

实测本机数据：`enso-side-panel` 单 key 值 **5.77 MB**（288 万 UTF-16 字符），其中快照 277 万字符
（192 文件 / 15 会话，最大单会话 92.7 万字符）。Chromium localStorage 配额 10 MiB。

zustand persist 语义是任何一次 `set()` 都 `JSON.stringify(整个 state)` + 同步 `localStorage.setItem`，
主线程阻塞。触发点包括 `saveSnapshots`、`nudgeWidth`（拖宽度每个 mousemove）、`setBrowserHole`
（BrowserView rAF 循环）、`saveLayout` / `toggleOpen` / `setChangesMode`。这就是「打开 / 拖动 / 切换
Changes 都巨卡」的根因；继续增长到配额后 `setItem` 抛异常，整个侧边栏持久化静默失效。

## 目标

1. `enso-side-panel` localStorage 值只含 ui / layout / mode，不再含任何文件文本。
2. 快照改为主进程按会话落盘（`userData/changes-snapshots/<conversationId>.json`），异步读写，
   与 UI 状态的写路径完全解耦。
3. 已删除会话的快照文件会被清理，不再无限增长。
4. 升级后已有用户的旧快照不丢：一次性迁移到磁盘后从 localStorage 移除。

## 非目标（后续任务）

- `buildTimeline` 在 ChatView / FilesView / ChangesView 三处重复计算的去重。
- CodeView `disableWorkerPool` / 主线程 shiki 高亮优化。
- Git 模式 `git show` 串行改并行。

## 约束

- 遵循 IPC 三点式链路；请求只带 `conversationId`（uuid 校验），路径由主进程推导。
- 入参一律 `unknown` 收窄；返回结果对象不抛异常。
- 逻辑放 `src/main/services/`，可用临时目录单测；ipc 层只校验。
- 新 IPC 通道需登记 `src/tooling/productCapabilityCoverage.fixture.ts` 与 phone stub。
- `enso-side-panel` persist version 3 → 4，迁移写在 `migrate`，不放 `onRehydrateStorage`。
- 不改 Changes 面板的展示行为与 Git 模式。

## 验收标准

- AC1 启动后打开 Changes、拖侧栏宽度、切换 Session/Git：`useSidePanelStore` 的 `set()` 不再触发
  含文件文本的 `localStorage.setItem`；`enso-side-panel` 值不含 `snapshotsByConversation`。
- AC2 会话中 agent 编辑文件 → Session 模式显示 diff；重启应用后 diff 的 old 仍为编辑前内容
  （快照从磁盘回读）。
- AC3 旧版本用户（persist v3 带快照）升级后：磁盘出现对应 `<conversationId>.json`，localStorage
  中快照消失，Session 模式 diff 不变。
- AC4 主进程启动（或首次访问快照）时，`enso-conversations` 中不存在的会话对应的快照文件被删除。
- AC5 快照服务单测覆盖：uuid 校验拒绝穿越、读不存在返回空、写后可读、坏 JSON 返回空、清理只删
  陌生 id；`pnpm typecheck && pnpm test` 与 `biome check` 通过。
