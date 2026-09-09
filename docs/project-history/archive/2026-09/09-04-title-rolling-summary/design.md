# 技术设计：会话标题滚动总结

## 0. 现状链路（一次性）

```
renderer sendMessage / 首条 message-upsert
  └─ trySummarizeTitle(id, rawText, baseline)  (门禁: enabled && !sessionFile && 无在飞)
       └─ preload agent.summarizeTitle(id, text, sessionModel)
            └─ main ipc AGENT_SUMMARIZE_TITLE: 读设置 → titleModelCandidates 回退链 → resolveModelSelection
                 └─ agentHost.summarizeConversationTitle → worker cmd {type:'summarize-title', conversationId, text, model}
                      └─ supervisor.summarizeTitle: completeSimple(TITLE_SYSTEM_PROMPT, buildTitleUserText(text)) → extractTitle
                           └─ emit {type:'title-generated', conversationId, title}  → main 广播 → renderer 按 baseline 写回
```

## 1. 边界决策

**Q1 本轮摘要（请求 + 结论）在哪一层产出？** → **worker**。
renderer 的 `conversation.messages` 在冷会话会被 `evictColdMessages` 清空，手机端会话也可能没有正文，
无法保证取到本轮文本（PRD R1 要求后台/冷会话同样触发）。worker 的 `managed.messages` 是权威全量投影，
在 `agent_end` 成功分支处切出本轮消息最可靠。

**Q2 谁决定"要不要总结"？** → **renderer store**。
只有 renderer 知道 `titleSummaryEnabled`（Main 也能读，但）、当前 `title`、`titleLocked`、在飞状态、
是否 child/coworker 会话。所以 worker 只负责把**摘要附在 `turn-completed` 事件上**，决策与发起仍在 renderer，
和现有链路对齐（renderer → main → worker `summarize-title`）。

**Q3 一次性与滚动两种模式如何共存？** → 命令输入改为**判别联合** `TitleSummaryInput`，
`summarize-title` 命令、IPC payload、agentHost 签名统一用它；worker 按 `kind` 选 prompt。

## 2. 契约变更（`src/shared/types/agent.ts`）

```ts
/** 一轮结束时 worker 切出的压缩摘要；两段都已按上限截断 */
export interface TurnDigest {
  /** 本轮全部 user 文本（逐条 buildTitleUserText 清洗后 '\n' 拼接，截头 TURN_DIGEST_USER_MAX=2000） */
  userText: string;
  /** 本轮最后一条含 text 的 assistant 消息的 text 拼接，截尾 TURN_DIGEST_ASSISTANT_MAX=1500 */
  assistantText: string;
}

export type TitleSummaryInput =
  | { kind: 'initial'; text: string }
  | { kind: 'rolling'; currentTitle: string; userText: string; assistantText: string };

// AgentCommand
| { type: 'summarize-title'; conversationId: string; input: TitleSummaryInput; model: SpawnModelConfig }

// AgentWorkerEvent
| { type: 'turn-completed'; identity; seq; turnId: string; digest?: TurnDigest }
```

- `parseAgentCommand`：`hasExactKeys(['type','conversationId','input','model'])` + `parseTitleSummaryInput(input)`
  （`initial` 要求 text 非空；`rolling` 要求 currentTitle 非空且 userText/assistantText 为 string、二者至少一个非空）。
- `parseAgentWorkerEvent` `turn-completed`：`digest` 可选；存在则必须是 `{userText: string, assistantText: string}`，否则整条事件判非法（返回 null）。
- `digest` 只在 renderer 层消费；`agentSessionIndex` / `agentDispatchService` / `reducer` 对 `turn-completed` 的既有处理不读该字段，无需改动。

导出新常量 `TURN_DIGEST_USER_MAX = 2000`、`TURN_DIGEST_ASSISTANT_MAX = 1500`（放 `src/agent/titleSummary.ts`，shared 类型只放形状）。

## 3. worker（`src/agent`）

### 3.1 `titleSummary.ts` 新增纯函数

```ts
export function buildTurnDigest(messages: ProjectedMessage[], fromIndex: number): TurnDigest | null
```
- `slice(fromIndex)`；user：`role==='user'` 的 text 片段拼接 → `buildTitleUserText` 清洗 → 非空者以 `\n` 拼接 → `slice(0, 2000)`；
- assistant：从尾部找第一条 `role==='assistant'` 且 text 拼接非空的消息 → `slice(-1500)`；`stopReason==='error'/'aborted'` 的跳过；
- 两段皆空 → `null`。

```ts
export const ROLLING_TITLE_SYSTEM_PROMPT: string
export function buildRollingTitleUserText(input: Extract<TitleSummaryInput,{kind:'rolling'}>): string
```
- system prompt 要点：标题概括**整个对话主题**而非最后一轮；若当前标题仍准确则**逐字输出当前标题**；只输出标题；CJK ≤20 字 / 英文 ≈6 词；语言跟随用户消息。
- user text 结构：
  ```
  Current title: <currentTitle>

  Latest user request:
  <userText 或 "(none)">

  Latest assistant conclusion:
  <assistantText 或 "(none)">
  ```

### 3.2 `supervisor.ts`

- `ManagedSession` 新增 `turnStartIndex: number`（spawn/resume 建好投影后初始化为 `messages.length`；
  `agent_end` 成功分支、`failTurn`、abort 收口后重置为当前 `messages.length`）。
  单一"上一轮终点"记法，不依赖各 prompt 入口。
- `turnStartIndex` 可能因 compaction/reconcile 截断而大于 `messages.length`：`buildTurnDigest` 内部 `Math.min` 夹紧；
  若切片内无 user 消息则回退为"从尾部最近一条 user 消息起"。
- `agent_end` 成功分支：`const digest = buildTurnDigest(managed.messages, managed.turnStartIndex)`，
  emit `turn-completed` 时 `...(digest ? { digest } : {})`，随后 `managed.turnStartIndex = managed.messages.length`。
- `summarizeTitle(command)`：按 `command.input.kind` 选 `TITLE_SYSTEM_PROMPT + buildTitleUserText(text)` 或
  `ROLLING_TITLE_SYSTEM_PROMPT + buildRollingTitleUserText(input)`；其余（超时 15s、`extractTitle`、静默失败）不变。

## 4. main

- `src/main/services/agentHost.ts` `summarizeConversationTitle(conversationId, input: TitleSummaryInput, model)`。
- `src/main/ipc/agent.ts` `AGENT_SUMMARIZE_TITLE` handler：payload 改为 `{ conversationId, input, sessionModel? }`，
  用 shared 的 `parseTitleSummaryInput` 收窄；模型回退链不变。
- `src/preload/index.ts`：`summarizeTitle(conversationId, input: TitleSummaryInput, sessionModel?)`。
- `productCapabilityCoverage.fixture.ts`：IPC 频道未新增，不改。

## 5. renderer store（`src/renderer/stores/sessions/index.ts`）

- `Conversation` 新增 `titleLocked?: boolean`（随 `...conversation` 自然进入 partialize；可选字段无需 migrate）。
- `renameConversation`：写 `title` 同时 `titleLocked: true`，并 `pendingTitleBaselines.delete(id)`。
- `trySummarizeTitle` 改名保留，内部改为调用 `summarizeTitle(id, {kind:'initial', text}, ...)`；门禁新增 `!conversation.titleLocked`。
  **不得**读 live `sessionFile` 判 resume（已修 bug `b829adc`：parent-ready 抢在 spawn 返回前落地，会误杀）；
  resume 判断只由调用点用触发时刻快照决定。滚动路径本就要在有 sessionFile 的会话上触发，天然不看它。
- 新增 `tryRollingSummarizeTitle(id, digest)`：
  - 门禁：`titleSummaryEnabled` && conversation 存在 && `!parentId && !coworkerName` && `title.trim()` 非空 &&
    `!titleLocked` && `!pendingTitleBaselines.has(id)` && digest 非空；
  - `pendingTitleBaselines.set(id, title)`；`summarizeTitle(id, {kind:'rolling', currentTitle: title, ...digest}, {providerId: lastProviderId, modelId: lastModelId})`。
  - 挂点：现有 `turn-completed / turn-failed` 分支（~L961）：abortRequested 分支 return 前**不**触发；
    `turn-completed` 且非中断 → `tryRollingSummarizeTitle(id, event.digest)`，再 `flushQueue/continueGoal`。
- `title-generated` 处理：保持 baseline 比对；`title === conversation.title` 已 return state（模型选择不改 → 无更新）。

## 6. 数据流（滚动一轮）

```
worker agent_end(成功) → buildTurnDigest → turn-completed{digest}
  → main 广播（index/dispatch 忽略 digest）
  → renderer store: applyAgentEvent（不读 digest）→ tryRollingSummarizeTitle 门禁 → baseline 记录
  → preload summarizeTitle(id, {kind:'rolling',...}) → main 解析模型 → worker summarize-title
  → completeSimple(ROLLING prompt) → extractTitle → title-generated → renderer baseline 比对 → 写回/忽略
```

## 7. 兼容 / 回滚

- 命令与 IPC payload 形状变更是 renderer/main/worker 同版本内的内部契约，无跨版本兼容需求（三方随 app 一起发布）。
- `titleLocked` 新可选字段：旧持久化数据缺失即 `undefined` = 未锁；不需要 SESSIONS_VERSION 升版。
- 回滚：整体 revert 即可；持久化里多出的 `titleLocked` 字段被旧代码忽略。

## 8. 权衡

- 摘要随 `turn-completed` 一起走而不是单独事件：少一个事件类型、天然同 seq 有序；代价是 turn-completed 事件变胖（≤3.5KB）。
- 不在 worker 直接做总结：worker 缺 title/settings/lock 上下文，若下沉需把这些状态同步到 worker，改动面更大且与现有"renderer 决策"一致性差。
