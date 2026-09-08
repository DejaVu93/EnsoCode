# Compact core vs full EESV

来源：`pi-smart-compact` 9.6.2（`run-smart-compact.ts`、`ARCHITECTURE.md`）、Enso 实测会话 `01a07531` / `01a0751e`、Pi `session_before_compact`。

## 包的流水线（不要整段搬）

prepare → window → recover → tier → extract → synthesize → verify → state → damage → persist/index graph

其中 **window / tier** 用 host billed tokens、固定开销、mode 目标%、`MIN_COMPACTION_SAVING_RATIO`（10%）决定让不让出。这是 Enso 手动 compact 经常 4–9ms 原生的原因。

## 包的宿主外壳（明确不抄）

- `registerContextTools`：永远 register，再 `setActiveTools` 摘掉。加载期 stub 抛错 → 工具留在 active。`01a07531` 调了 `smart_recall`，得到 disabled 文案。
- `agentToolAccess` 只藏 `smart_compact`。
- `persistEnsoSmartCompactSettings` 写 `$HOME/.pi/agent/settings.json`，与 Enso `userData/agent` 不一致。
- `/smart-compact` TUI、loops、metrics、SQLite FTS5。

## 值得复用的核

- 确定性抽取字段：goal、constraint、error、open loop、files
- 工具 call/result 成对留尾巴
- 单通道合成 + 确定性补丁（`01a07531`：78→100，无第二轮 LLM）
- 失败让出原生；apply 交给 Pi

## Hook 返回

成功时向 `session_before_compact` 交 `compaction.summary`（及 `tokensBefore`）。Pi `appendCompaction(..., fromExtension)` → 会话 `fromHook: true` → Enso 时间线 `verified`。

空返回 = 原生 summarizer。不要自己改 jsonl。
