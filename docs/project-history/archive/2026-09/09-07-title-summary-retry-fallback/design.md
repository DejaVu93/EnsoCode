# 技术设计：标题总结回退链多候选 + 递增超时 + 失败可见 + 手动重试

## 0. 现状链路与改动点

```
renderer trySummarizeTitle / tryRollingSummarizeTitle
  └─ preload agent.summarizeTitle(id, input, sessionModel)
       └─ main AGENT_SUMMARIZE_TITLE: titleModelCandidates → resolveModelSelection → 【取第一个】       ← 改：取全部
            └─ agentHost.summarizeConversationTitle(id, input, model)                               ← 改：candidates[]
                 └─ worker summarize-title{model}: completeSimple(15s) → extractTitle → title-generated | 静默  ← 改：依次尝试 + title-failed
                      └─ renderer title-generated → baseline 比对写回                                ← 增：title-failed → titleSummaryError
                                                                                                      ← 增：侧栏红叹号 + tooltip + 点击重试
```

## 1. 边界决策

**Q1 "依次尝试"放哪一层？** → **worker**。
Main 是无状态 IPC handler，做不了跨候选的等待与超时编排；renderer 更不该知道模型凭证。worker 已有 runtime，
在 `summarizeTitle` 内 for 循环即可。Main 只负责"把能解析的候选全部下发"。

**Q2 超时档位由谁决定？** → **worker 常量**。`TITLE_SUMMARY_TIMEOUTS_MS = [60_000, 120_000, 180_000]`，
按候选下标取；不进协议（renderer/main 不关心）。

**Q3 失败事件需要 identity/seq 吗？** → **不需要**，与 `title-generated` 同形：`{ type, conversationId, error }`，
在 `agentSessionIndex` / `reducer` 走与 `title-generated` 完全相同的旁路。

**Q4 手动重试的输入从哪来？** → renderer 保留**最近一次成功回合的 digest**（`lastTurnDigest?: TurnDigest`，
不持久化）。有 → rolling；无 → initial（`firstUserRawText(conversation)`）；正文被冷驱逐且无 digest → 用当前 `title` 作 initial 文本（最差兜底，至少能再总结一次）。

**Q5 renderer 侧失败与 Main 同步失败统一吗？** → 统一。`summarizeTitle` IPC 返回 `{ok:false,error}` 时，
renderer 当场按 `title-failed` 语义处理（写 `titleSummaryError`、清在飞基准）。此前这个返回值被 `void` 丢弃。

## 2. 契约变更（`src/shared/types/agent.ts`）

```ts
// AgentCommand
| {
    type: 'summarize-title';
    conversationId: string;
    input: TitleSummaryInput;
    /** 回退链上全部可解析候选，按优先级排序；worker 依次尝试。1–3 项 */
    candidates: SpawnModelConfig[];
  }

// AgentWorkerEvent（与 title-generated 同为旁路事件，无 identity/seq）
| { type: 'title-failed'; conversationId: string; error: string }
```

- `parseAgentCommand('summarize-title')`：`hasExactKeys(['type','conversationId','input','candidates'])`；
  `candidates` 为非空数组、长度 ≤ 3、每项 `parseSpawnModelConfig` 通过。**旧形状（`model` 单字段）拒绝**。
- `parseAgentWorkerEvent('title-failed')`：`hasExactKeys(['type','conversationId','error'])` + 两字段非空字串。
- `RendererAgentEvent` 自动包含（它是 `AgentWorkerEvent` 的投影）；`agentSessionIndex.identityOf` 的 `Exclude` 加上 `{ type: 'title-failed' }`，`shouldIndex` 与 `reducer.eventIdentity` 各加一行旁路。

## 3. worker（`src/agent`）

### 3.1 `titleSummary.ts` 新增纯函数

```ts
export const TITLE_SUMMARY_TIMEOUTS_MS = [60_000, 120_000, 180_000] as const;
/** 第 index 个候选的超时；越界取最后一档 */
export function titleSummaryTimeoutMs(index: number): number

/** 结果合法性守卫：extractTitle 之上再判"像不像标题"。返回 null 表示合法 */
export function titleRejectReason(title: string): string | null
//  '' → 'model returned empty title'
//  首行去引号后含 ≥2 个句终标点（。．.！!？?）且末尾标点后仍有字符 → 'model did not return a title'
//  （长度已由 extractTitle 截到 80，不再重复判）

/** 人可读模型标识：oauth → `${oauthAccountKey}/${modelId}`，apiKey → `${settingsProviderId}/${modelId}` */
export function describeTitleModel(model: SpawnModelConfig): string
```

### 3.2 `supervisor.summarizeTitle(command)` 重写

```ts
let lastError = 'no candidates';
for (const [index, candidate] of command.candidates.entries()) {
  const label = describeTitleModel(candidate);
  const timeoutMs = titleSummaryTimeoutMs(index);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const model = await resolveBaseModelOrRefresh(runtime, candidate);
    const message = await runtime.completeSimple(model, {...}, { signal: controller.signal });
    if (message.stopReason === 'aborted') { lastError = `${label}: timed out after ${timeoutMs/1000}s`; continue; }
    if (message.stopReason === 'error')   { lastError = `${label}: ${message.errorMessage ?? 'model error'}`; continue; }
    const title = extractTitle(message);
    const reject = titleRejectReason(title);
    if (reject) { lastError = `${label}: ${reject}`; continue; }
    this.options.emit({ type: 'title-generated', conversationId, title });
    return;
  } catch (error) {
    lastError = `${label}: ${toErrorMessage(error)}`;
  } finally {
    clearTimeout(timer);
  }
}
this.options.emit({ type: 'title-failed', conversationId: command.conversationId, error: lastError });
```

- `handleCommand` 里的 `.catch(() => {})` 保留作最后一道防线（理论上不会再抛）。
- `resolveBaseModelOrRefresh` 抛错（模型在 worker catalog 里找不到）也算该候选失败，进下一个，不整体放弃。
- 删除旧常量 `TITLE_SUMMARY_TIMEOUT_MS`。

## 4. main

### 4.1 `src/main/ipc/agent.ts` `AGENT_SUMMARIZE_TITLE`

```ts
const resolvedCandidates: SpawnModelConfig[] = [];
for (const candidate of titleModelCandidates(state, sessionModel)) {
  const resolved = resolveModelSelection(candidate.providerId, candidate.modelId, credentialKeys);
  if (resolved.ok && resolved.selection) resolvedCandidates.push(resolved.selection.config);
}
if (resolvedCandidates.length === 0) return { ok: false, error: 'no usable title model' };
return summarizeConversationTitle(conversationId, input, resolvedCandidates);
```

`titleModelCandidates` 已去重，无需再去重。

### 4.2 `agentHost.summarizeConversationTitle(conversationId, input, candidates: SpawnModelConfig[])`

直接 `sendAgentCommand({ type:'summarize-title', conversationId, input, candidates })`。

### 4.3 preload / IPC 频道

不新增频道；`summarizeTitle` 签名不变（renderer 只传 id + input + sessionModel）。返回值 `AgentActionResult` 开始被 renderer 消费。

## 5. renderer store（`src/renderer/stores/sessions/index.ts`）

### 5.1 `Conversation` 新字段（均不持久化——列入 `partialize` 剥离集）

```ts
/** 最近一次标题总结失败原因（含模型标识）；侧栏红叹号 + tooltip。成功/改名/重试时清 */
titleSummaryError?: string;
/** 标题总结在飞：pendingTitleBaselines 的 UI 镜像（Map 在闭包里，组件读不到）；侧栏转圈 */
titleSummaryPending?: boolean;
/** 最近一次成功回合的 digest，供手动重试走 rolling；无则退 initial */
lastTurnDigest?: TurnDigest;
```

**不变量**：`titleSummaryPending === pendingTitleBaselines.has(id)`。为保证这一点，对 `pendingTitleBaselines` 的
所有 set/delete 收口到两个内部 helper：

```ts
function markTitlePending(id: string, baseline: string): void   // Map.set + patch({titleSummaryPending: true, titleSummaryError: undefined})
function clearTitlePending(id: string): boolean                  // Map.delete + patch({titleSummaryPending: undefined})；返回是否原本在飞
```
现有直接操作 Map 的 5 处（trySummarizeTitle / tryRollingSummarizeTitle / title-generated / renameConversation / removeConversation 清理）全部改走 helper。

### 5.2 发起路径统一收口

抽出内部函数 `requestTitleSummary(id, input, sessionModel)`：
- `markTitlePending(id, baseline)`（内含清 error）；
- `window.electronAPI.agent.summarizeTitle(...)` 的返回值 **await**（不阻塞调用方，内部 `void (async () => …)()`）：
  `!result.ok` → 按 §5.3 的 `title-failed` 语义处理（`error = result.error ?? 'title summary request rejected'`）。
- `trySummarizeTitle` / `tryRollingSummarizeTitle` 的门禁保持不变，只是最后一步改调它。

### 5.3 `title-failed` 事件处理（与 `title-generated` 并列）

```ts
if (event.type === 'title-failed') {
  if (!clearTitlePending(event.conversationId)) return;   // 不在飞 → 迟到/串会话，忽略
  set((state) => {
    const conversation = state.conversations[event.conversationId];
    if (!conversation || conversation.titleLocked) return state;
    return patch(state, event.conversationId, { titleSummaryError: event.error.slice(0, 500) });
  });
  return;
}
```

### 5.4 `title-generated` 处理增补

开头 `pendingTitleBaselines.get/delete` 改为先 `get` 再 `clearTitlePending`；写回成功分支同时 `titleSummaryError: undefined`（即使 `title === conversation.title` 也要清错误——模型认为标题已准确同样算成功）。

### 5.5 `turn-completed` 增补

有 `event.digest` 时 `patch(state, id, { lastTurnDigest: event.digest })`（在 `tryRollingSummarizeTitle` 之前写入，保证重试能拿到最新一轮）。

### 5.6 `renameConversation` 增补

`pendingTitleBaselines.delete(id)` 改 `clearTitlePending(id)`；`titleLocked: true` 同时 `titleSummaryError: undefined`。

### 5.7 新 action `retryTitleSummary(id)`

```ts
retryTitleSummary(id) {
  const conversation = get().conversations[id];
  if (!conversation || conversation.titleLocked || !useSettingsStore.getState().titleSummaryEnabled) return;
  if (pendingTitleBaselines.has(id)) return;
  const model = conversation.lastProviderId && conversation.lastModelId ? {...} : undefined;
  if (conversation.lastTurnDigest && conversation.title.trim()) {
    requestTitleSummary(id, { kind:'rolling', currentTitle: conversation.title, ...conversation.lastTurnDigest }, model);
    return;
  }
  const text = cleanTitleSummarySource(firstUserRawText(conversation)) || conversation.title;
  if (!text.trim()) return;
  requestTitleSummary(id, { kind:'initial', text }, model);
}
```

### 5.8 开关关闭清残留

`useSettingsStore.subscribe` 已有的订阅点（若无则新增）：`titleSummaryEnabled` 变为 false 时对全部在飞会话 `clearTitlePending`，并对全部会话 `titleSummaryError: undefined`。

## 6. renderer UI（`src/renderer/components/chat/Sidebar.tsx` `ConversationRow`）

- `ConversationRowProps.conversation` 增 `titleSummaryError?: string`、`titleSummaryPending?: boolean`；新增 prop `onRetryTitleSummary: (id) => void`。
- 抽小组件 `TitleSummaryBadge({ pending, error, onRetry })`，插在标题 `<span className="min-w-0 flex-1 truncate">` **之后**（时间戳/操作按钮之前），不受 `renaming` 影响以外的隐藏逻辑影响（renaming 时不渲染）：

```tsx
function TitleSummaryBadge({ pending, error, onRetry }: { pending?: boolean; error?: string; onRetry: () => void }) {
  const { t } = useI18n();
  if (pending) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0 text-muted-foreground/60" aria-label={t('Summarizing title')} />}>
          <Loader2 className="h-3 w-3 animate-spin" />
        </TooltipTrigger>
        <TooltipPopup side="right">{t('Summarizing title')}</TooltipPopup>
      </Tooltip>
    );
  }
  if (error) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={t('Title summary failed')}
              className="shrink-0 rounded p-0.5 text-destructive hover:text-destructive/80"
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
            />
          }
        >
          <CircleAlert className="h-3 w-3" />
        </TooltipTrigger>
        <TooltipPopup side="right" className="max-w-72">
          <p className="font-medium">{t('Title summary failed')}</p>
          <p className="mt-0.5 break-all text-muted-foreground">{error}</p>
          <p className="mt-1 text-muted-foreground/70">{t('Click to retry')}</p>
        </TooltipPopup>
      </Tooltip>
    );
  }
  return null;
}
```

- pending 优先于 error（点重试后 `markTitlePending` 已清 error，但保险起见组件也按此优先级）。
- 时间戳与 hover 操作按钮保持原样，不再被叹号顶替。
- `CircleAlert` / `Loader2` 来自 `lucide-react`；`Tooltip*` 来自 `@/components/ui/tooltip`。
- 三处 `ConversationRow` 调用点（Pinned / 项目 / Archived）各传 `onRetryTitleSummary={retryTitleSummary}`。
- i18n：新增 key `Summarizing title`、`Title summary failed`、`Click to retry`（zh：标题总结中 / 标题总结失败 / 点击重试）。

## 7. 数据流（首条消息，标题模型不听话）

```
renderer trySummarizeTitle → requestTitleSummary(markTitlePending: baseline 记录 + pending=true + error 清空) → 侧栏出转圈
  → main: candidates=[composer-2.5-fast, grok-4.6, claude-fable-5-1] → worker
  → worker: #0 60s 内返回叙述 → titleRejectReason → 'cursor/composer-2.5-fast: model did not return a title'
            #1 120s 内 grok 返「修复节点状态转圈」 → title-generated → return
  → renderer: clearTitlePending(转圈消失) → baseline 比对 → 写回 title、清 titleSummaryError
```

全失败：`title-failed{error:'enso-…/claude-fable-5-1: timed out after 180s'}` → renderer `clearTitlePending` 返 true → 写 `titleSummaryError` → 侧栏转圈变红叹号；点击 → `retryTitleSummary` → `markTitlePending` → 叹号变转圈 → 有 `lastTurnDigest` 走 rolling。

## 8. 兼容 / 回滚

- 命令形状变更（`model` → `candidates`）为 renderer/main/worker 同版本内部契约，随 app 一起发布，无跨版本兼容需求；旧形状被 parser 拒绝是**刻意的**（防止半升级状态静默走旧逻辑）。
- 新 renderer 字段均不持久化，无 `SESSIONS_VERSION` 升版。
- 回滚：整体 revert；无数据迁移。

## 9. 权衡

- 最坏 6 分钟单次总结：接受。替代方案"并发发所有候选取最快"会同时烧 3 份配额且违背"标题模型优先"的用户意图。
- 失败守卫用"句终标点计数"而不是再问一次模型：零成本、可单测；误杀风险是合法标题里带两个句号（几乎不存在）。
- `title-failed` 只对在飞会话生效：牺牲"重启后仍能看到上次失败"换取零持久化与零迟到事件污染。
