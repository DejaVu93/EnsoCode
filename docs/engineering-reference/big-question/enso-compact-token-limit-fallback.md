# Smart Compact 撞 token limit 后让位原生单次摘要

## 症状

长会话自动压缩常失败，UI 显示：

```text
Auto-compaction failed: Summarization failed: ... Input token limit exceeded
```

Smart Compact 明明开着，jsonl 里却没有 `compaction` 条目；上下文涨到接近窗口后换模型/点继续仍直接超限。

## 根因

错误文案来自 Pi 原生 `getSummarizationFailure()`，不是 Enso 分层摘要路径。

链路：

```text
overflow / auto-compact
  → session_before_compact（Enso）
       单趟 complete 抛 Input token limit exceeded
       → catch { return }  // 让位
  → Pi generateSummaryWithUsage（整段一次摘要）
       → 再撞 Input token limit exceeded
       → Auto-compaction failed: Summarization failed: …
```

Enso 钩子还会在「摘要模型 find 不到 / 准备阶段抛错 / 把内部超时当成取消」时 `return undefined`，同样让位原生。原生单次摘要比 Enso 分层更吃输入，长会话上几乎必挂。

另外：单趟/切块预算只看 mode（如 auto 30k），**不看摘要模型自己的 `contextWindow`**。会话模型很大、摘要模型较小时仍可能走单趟并撞窗。

## 修法（`src/agent/ensoCompact/extension.ts`）

1. 单趟摘要失败：降级 `summarizeHierarchical`；分层也挂 → `assembleFallback`，仍交 `compaction`。
2. 只有 **`event.signal.aborted`（用户取消）** 才 `return undefined`；内部 timer abort 仍交确定性兜底，避免原生再撞窗。
3. `clampToModelWindow`：用摘要模型 `contextWindow - reserve` 收紧 `singlePassMaxTokens` / `maxChunkTokens`。
4. 准备阶段始终 `chunkMessages`，便于单趟失败立刻分层。

相关测试：`hook.test.ts`（单趟 token-limit、全挂 fallback、用户 abort、小 contextWindow 强制切块）。

## 通用教训

1. **钩子「失败让位上游」前先问：上游会不会更差？** 对输入超窗类错误，原生单次摘要不是兜底。
2. **区分用户取消与内部超时。** `AbortSignal.any([user, timer])` 后若用合并 signal 判断「已取消」，会把超时误当成用户取消并丢掉本可写的 fallback。
3. **预算要对齐实际调用的模型窗口**，不能只按会话模型或写死的 mode 常量。
