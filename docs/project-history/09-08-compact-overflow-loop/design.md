# 设计：overflow compact 切点重选

## 行为差距

现在：pi 按约 20k 尾巴切一刀；图按 1200 token 估价；压后占用仍用尾巴里最后一条 assistant 的压前 `usage`。钩子不改切点。压完仍超限或立刻再压。

应该：钩子在交摘要前重选切点，使**压后真实可发送量**低于 `window - reserve`；做不到就 `cancel`，不交假成功。

## 边界

| 做 | 不做 |
|----|------|
| `ensoCompact` 纯函数切点 + 估价 | 改 pi / patch |
| 钩子改 `firstKeptEntryId`，踢出段并入 summarize | 改读工具、降采样 |
| 摘要补 `## Evicted from context` | 新 IPC / toast / 设置 |
| 工厂闭包记上次压后占用，防空转 | 改「继续」按钮 |

层：只在 agent worker 的 compact 钩子。时间线已能展开摘要，本轮不改 renderer。

## 数据流

```
session_before_compact
  → selectKeptBoundary(branch, preparation, window)
       失败 → { cancel: true }
  → messagesToSummarize = 原段 + 新踢出的条目
  → 现有 prune / serialize / summarize
  → patch Evicted 段
  → { summary, firstKeptEntryId: 新切点, tokensBefore: 原值 }
pi appendCompaction → buildSessionContext = summary + 新尾巴
```

`tokensBefore` 仍用 pi 的压前值（UI「压缩前 N tokens」）。压后占用只用于切点和 R4。

## 合同

新文件 `src/agent/ensoCompact/budget.ts`（名可在实现时微调，逻辑必须可单测）：

```ts
export const RESERVE_TOKENS = 16_384;
export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const MIN_IMAGE_TOKENS = 1_600;
export const MIN_SAVING_RATIO = 0.1;

export function imageTokens(part: { data?: string; bytes?: number }): number;
// max(ceil(payloadChars/4), MIN_IMAGE_TOKENS)；payloadChars = data.length 或 bytes 估出的 base64 长

export function estimateMessageTokens(message: unknown): number;
// 文本 chars/4；图走 imageTokens；不读 usage

export function sendBudget(contextWindow?: number): number;
// max(0, (window || 128k) - 16_384)

export type CutOk = {
  firstKeptEntryId: string;
  evicted: EvictedItem[]; // { label: string; tokens: number }
  estimatedAfter: number;
};
export type CutFail = { fail: 'uncompressible' | 'no_saving' };

export function selectKeptBoundary(input: {
  branch: CompactBranchEntry[]; // 需带 id
  preparation: { firstKeptEntryId: string; previousSummary?: string; tokensBefore: number };
  contextWindow?: number;
  previousEstimatedAfter?: number;
  summaryTokenHint?: number; // 未生成摘要时用 previousSummary/4 + 2048
}): CutOk | CutFail;
```

切点规则：

1. 合法切在带 `id` 的 user / assistant 条目；toolResult 跟它的 toolCall 走。
2. 从 `preparation.firstKeptEntryId` 起，若 `estimatedAfter > sendBudget` 则把切点推到下一条合法边界（更靠近现在）。
3. `estimatedAfter = summaryTokenHint + sum(estimateMessageTokens(tail))`。**压后占用不算 usage**。
4. 另：若拟留尾巴里「最后一条带有效 usage 的 assistant」的 billed tokens（`totalTokens` 或 input+output+cache）`> sendBudget`，必须把切点推过该条。否则 pi 下次 `estimateContextTokens` 仍用压前整窗账单（侧栏会话根因）。
5. 尾巴从新切点到 branch 末（不含本轮尚未写入的 compaction 条目）。
6. 无法再推仍超 → `{ fail: 'uncompressible' }`。
7. `previousEstimatedAfter` 存在且 `(previous - after) / previous < 0.1` → `{ fail: 'no_saving' }`。

`CompactBranchEntry` 补 `id?: string`（jsonl / pi branch 已有）。

## 钩子

`extension.ts` 在现有 summarize 之前调 `selectKeptBoundary`。`ctx.model?.contextWindow` 传入。

- `fail` → `return { cancel: true }`。不 `return` 空（空会走 pi 默认切点，循环复现）。
- 成功：`messagesToSummarize` 拼上踢出段（normalize 后）；`firstKeptEntryId` 用新值。
- `patchCompactSummary` 增加：有 evicted 则保证 `## Evicted from context` 列表（路径或 `read image` / tool 名 + token）。
- 工厂闭包 `lastEstimatedAfter`：成功则更新；`cancel` 不更新。

## 兼容

- 旧会话 jsonl 不用迁。下次 compact 即按新切点。
- 已展开的 compact 摘要多一段 Evicted，旧时间线仍只显示分隔文案。
- 手动 `/compact` 同一套切点，避免手动也留爆窗尾巴。

## 风险

- **踢得太狠**：过估图 token 会把刚读的图打进摘要。产品已接受「续跑优先」。
- **`cancel` 后用户点继续**：新 run 再 overflow 再 cancel。本轮不改该按钮。
- **usage 忽略后低估文本窗**：只影响切点，实际发送仍是正文；过估图是保守方向。

## 回滚

revert `ensoCompact` 切点提交即可；钩子失败本就回落/取消，不会写坏 jsonl 格式。
