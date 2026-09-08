# persist 回灌后 Object.keys 空对象崩溃

## Goal

开启「生成卡住超时」后，从磁盘回灌的旧会话不再因缺 `toolOutputs` 等运行态集合而抛 `TypeError: Cannot convert undefined or null to object`。主窗口保持可用，卡住检测按「无进行中工作」继续计时。

## Background

打包资源 `index-J9vkxhZo.js:124265` 对应 `src/renderer/hooks/useGenerationStallTimeout.ts:48`：`Object.keys(conversation.toolOutputs)`。同函数还直接读 `pendingApprovals.length` / `pendingAsks.length` / `backgroundTasks.some` / `subagents.some`。

`generationStallTimeoutMin > 0` 时每秒扫全部会话。这些集合是运行态：`cachedPartializeSessions` 现在会写成空对象/空数组，但磁盘上仍有 v1、`partialize` 补字段之前写入的会话。Zustand persist 无自定义 `merge`，回灌对象整段覆盖内存，缺字段不会被 `emptyProjection` 补上。

`applyAgentEvent` 入口已归一缺字段（`reducer.ts:155-176`），但只在事件到达时跑。卡死巡检不经过 reducer。ChatView / store 其它读点已对数组用 `?? []`，卡死 hook 没有。`migrateSessions` 现为 v1，只清 `started`/`status`；已是 v1 的磁盘不会再跑 migrate。

## Requirements

- R1. 卡死巡检对缺省或 `null` 的 `toolOutputs` / `pendingApprovals` / `pendingAsks` / `backgroundTasks` / `subagents` 不得抛错；一律视为空（无 live work）。
- R2. persist 回灌后的会话投影补齐与 `emptyProjection` 同形的运行态集合，并回写磁盘，避免只靠读侧 `??`。做法：`SESSIONS_VERSION` 升到 2，在 `migrateSessions` 里补字段。对齐 `.trellis/spec/main/settings-persistence.md`：形状变更走 migrate，不放 `onRehydrateStorage`。
- R3. 归一不得把已有非空集合清空，也不得把 `status` 改回 running 或把 `toolOutputs` 当权威正文持久化。
- R4. 卡住超时的产品语义不变：超时阈值、重试次数、toast、abort/retry 条件都不改。只修「读到缺字段就炸」。

## Acceptance Criteria

- [x] AC1. `useGenerationStallTimeout` 在 `generationStallTimeoutMin > 0` 时扫描缺 `toolOutputs`（以及 R1 所列其它集合）的会话，不抛 `Object.keys` / `.length` / `.some` TypeError。对应 R1。
- [x] AC2. `migrateSessions(..., 1)` 给缺字段或 `null` 的会话补上 `toolOutputs: {}`、`toolStartedAt: {}`、`pendingApprovals: []`、`pendingAsks: []`、`backgroundTasks: []`、`subagents: []`、`customEntries: []`、`dispatchMainEvents: {}`；已有非空值保持原样。对应 R2、R3。
- [x] AC3. 已是 v2 的 persist 数据原样返回，不重写。畸形 persist（`null` / 非对象 / `conversations` 非对象）仍不抛，与现有 `migrate.test.ts` 一致。对应 R2。
- [x] AC4. 卡死判定单测覆盖「集合缺省 = 无 live work」；现有 abort/retry/give-up 用例仍过。对应 R4。

## Out of Scope

- 不改卡住超时的分钟档、重试上限、文案。
- 不把 `toolOutputs` / 审批 / 后台任务持久化为权威运行态。
- 不重写全部 UI 读点；ChatView 等已有 `?? []` 的保持不动。
- 不改 `applyAgentEvent` 的事件归并语义；它已有入口归一。
- 不做 zustand persist 自定义 `merge`（多窗口整段替换仍走现有 rehydrate）。

## Technical Notes

- 崩溃栈：`Object.keys` ← `useGenerationStallTimeout.ts:48` ← `App.tsx:54`。默认 `generationStallTimeoutMin: 0` 时 hook 直接 return，故只在用户打开超时后出现。
- 测试落点：`migrate.ts` / `stallTimeout.ts` 已是同目录 vitest；hook 属暂未覆盖的 React 层。把「缺字段视为空」抽到可测纯函数（扩展现有 `hasLiveGenerationWork` 输入，或加 `liveWorkFromConversation`），不要为这一处上 jsdom。
- TDD：migrate 补 2～3 例、stall 补 1～2 例，合计远小于 10 例，inline Red-Green，不拉 tester coworker。
- 回归命令：`pnpm exec vitest run src/renderer/stores/sessions/migrate.test.ts src/renderer/stores/sessions/stallTimeout.test.ts`，再 `pnpm typecheck && pnpm test`。
