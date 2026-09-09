# compact overflow 后仍超限循环

## Goal

长会话 compact 成功之后，下一次发给模型的上下文必须低于输入上限；做不到就一次失败并说明原因。禁止 compact → 重试 → 再超限 → 再 compact。

用户价值：读训练图、长会话改设置这类任务，压完还能继续，而不是卡在「正在压缩…」和 `Input token limit exceeded`。

## Background

两份会话同一症状，机制不同：

1. **读训练图**：`read` jpg 后立刻超限；UI「上下文已压缩 (压缩前 731K tokens)」后同一错误循环。点「继续」再转一圈。
2. **侧栏会话** `01a07fe2`：15 次 compact 都写出了 `CompactionEntry`，`tokensBefore` 停在 **242837–256271**，摘要从 4858 涨到 31371 字符。每次切点有前移，尾巴约 14k–20k 正文 token。按 256k 窗 + 16k reserve，阈值约 240k。

## Confirmed facts

- pi 默认 `keepRecentTokens = 20000`、`reserveTokens = 16384`；阈值 `contextTokens > contextWindow - reserveTokens`。`pi-coding-agent/dist/core/compaction/compaction.js` `DEFAULT_COMPACTION_SETTINGS` / `shouldCompact`。
- `findCutPoint` 只保证尾巴约 20k，**不保证压完低于窗口**。
- 图按 `ESTIMATED_IMAGE_CHARS = 4800`（约 1200 token）估价，不用体积/视觉计价。训练 jpg 实际可远大于此，整段落在尾巴。
- `estimateContextTokens` 优先用**最后一条有效 assistant 的 usage**（`totalTokens` 或 input+output+cache）。压完若尾巴仍含这条 usage≈25 万的 assistant，下一次 `tokensBefore` 几乎不变。这是侧栏会话空转的直接原因。
- overflow 同一 run 只 compact+retry 一次；新 prompt /「继续」清标志再来。`agent-session.js` `_checkCompaction`。
- Enso 钩子原样交还 `preparation.firstKeptEntryId`。`src/agent/ensoCompact/extension.ts`。钩子可改切点；不能改已留下的 toolResult 内容。踢出大图 = 把切点推过该条。
- 踢出的消息必须并入 `messagesToSummarize`，否则摘要看不到它们。
- `09-08-enso-compact-eesv` 只修摘要质量，不覆盖本循环。
- Enso 注册模型缺省 `contextWindow = 128_000`。`src/agent/supervisor.ts`。

## Requirements

### R1 压完必须低于可发送预算

overflow / threshold / manual compact 都要重选 `firstKeptEntryId`，使保守估价下「摘要 + 尾巴」低于 `contextWindow - reserveTokens`（窗未知则用 128k）。

保守估价：

- 文本：chars/4。
- 图：按 payload（base64 长度或字节）估，**禁止** 4800 字封顶；另加视觉下限（例如 ≥ 1600 token/图），取更大者。
- **忽略** 切点之前产生的 assistant `usage`（那是压前整窗账单）。压后占用只按摘要长度 + 尾巴消息体。

切点只落在合法边界（user / assistant，不拆开 toolCall 与 toolResult）。一次不够就继续前移。

### R2 踢出并续跑

刚读的图、大工具结果、带过期 usage 的 assistant 都可以进摘要区，好让会话继续。时间线用已有 compact 行提示：摘要增加 `## Evicted from context`（路径 + 约计 token + 「需要时再 read」）；展开 compact 分隔即可看到，不新开 IPC / toast。

### R3 无法压下时一次失败

系统提示 + 工具定义已经超预算，或切到只剩最新一条用户消息仍超：钩子 `{ cancel: true }`（或不交假成功），文案说明原因。同轮不得再自动 compact。不在本轮改「继续」按钮产品文案。

### R4 无效压缩自限

相对上一次 compact，按 R1 估价压后占用下降不足 10%：视为无效，按 R3 收口。禁止靠摘要膨胀空转。

### R5 范围

只改 `src/agent/ensoCompact/**` 与时间线 compact 行对 `## Evicted from context` 的展示（若一句话能标在分隔上）。不改 pi 源码、不改设置、不新增档位。不重做 eesv 摘要模板。

## Acceptance Criteria

- [ ] AC1 尾巴含一张按 R1 估价超过剩余预算的图：返回的 `firstKeptEntryId` 在该 toolResult **之后**；`messagesToSummarize` 含该图对应消息。
- [ ] AC2 尾巴含一条 `usage.totalTokens`（或 input 合计）高于压后预算的 assistant：切点在该条之后。
- [ ] AC3 摘要含 `## Evicted from context`，列出被踢出的图/大结果路径或 tool 名。
- [ ] AC4 摘要 + 最小合法尾巴仍超预算：不返回成功 compaction（`cancel` 或 `undefined`），同轮不再 compact。
- [ ] AC5 连续两次压后占用下降 &lt; 10%：第三次不得当成功压缩返回。
- [ ] AC6 现有 `ensoCompact` 摘要质量用例保持绿色。
- [ ] AC7 `pnpm exec vitest run src/agent/ensoCompact` 与 `pnpm typecheck` 通过。

## Out of scope

- eesv 的分层 / 抽取 / Progress 模板（已有任务）。
- 读工具默认不回传图、训练图降采样设置。
- 改 pi 或再打 pi patch。
- 侧栏归档产品。
- 改 overflow 重试次数或禁用「继续」。

## Key decisions

- 压不下时**踢出并续跑**，不是停住逼用户新开会话（2026-09-08）。
- 踢出提示走 compact 摘要段 + 现有时间线分隔，不新协议。
- 侧栏空转按「过期 assistant usage 留在尾巴」修，不只按「图太大」修。
