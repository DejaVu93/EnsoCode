# enso-compact: 全量修剪序列化 / 上次摘要续写 / 分层摘要 / 抽取增强

## Goal

修复 `src/agent/ensoCompact` 压缩摘要丢失全部进度的问题，并移植 pi-smart-compact 的四个核心机制。

## 背景（根因）

会话 `2026-09-07T17-54-53` 在 46 分钟内 compaction 14 次，每次摘要 `Progress: 无记录`，模型每次从零重读同一批文件，形成循环。两处直接原因：

1. `extension.ts` 把 `event.preparation.messagesToSummarize`（`AgentMessage[]`，`role` 在顶层）当作 `CompactBranchEntry[]`（`role` 在 `.message` 下）传入 `prefixText`，每条都变成空 `":"` 行，摘要模型实际上**一个字都没看到**。
2. 即便走 `branch` 兜底，`prefixText` 不截断 toolResult 且整体 `slice(0, 24_000)` 只取头部，一条 47k 字符的工具结果就吃掉全部预算。

另有：`extractCompactFacts` 只有 goal/constraints/errors/files/openLoops，无进度/决策；上一次 compaction 的 summary 未带入；单趟摘要无分层。

## Requirements

### R1 全量修剪 + 序列化（替换 head-24k 切片）

- 新增 `normalizeMessages(input: unknown[]): AgentMessage[]`：同时接受 `CompactBranchEntry[]`（`.message`）与 `AgentMessage[]`（顶层 `role`），输出统一消息数组。
- 新增 `pruneMessages(messages, opts)`：
  - **重复读去重**：同一「写操作纪元」内，`read/grep/find/ls` 等只读工具、同名且参数稳定序列化相同的调用只保留最后一次；`edit/write/bash` 等写/执行操作让纪元 +1，跨纪元的相同读不去重。被去重的 toolResult 删除，对应 assistant 消息中的 toolCall 块一并删除（assistant 消息其余块保留）。
  - **工具结果截断**：每条 toolResult 文本超过 `maxToolResultChars`（默认 800）时保留头尾各一半，中间插入 `[... N chars truncated]`；`isError` 的结果尾部占比更大（头 1/4、尾 3/4）。
- 新增 `serializeMessages(messages): string`：覆盖**整段**被压缩区域，assistant 文本、toolCall（`name(k=v, ...)`）、截断后的 toolResult、user 文本全部进入；可复用 pi 的 `convertToLlm` + `serializeConversation`。
- `extension.ts` 优先使用 `event.preparation.messagesToSummarize`，兜底 `branch - keepRecentTail`；两者都先经 `normalizeMessages`。删除 `prefixText` 与 `slice(0, 24_000)`。

### R2 上次摘要续写 + 结构化 Progress

- 从 `event.preparation.previousSummary` 取上次摘要（最多保留 12k 字符，超出截尾），作为 prompt 的 `PREVIOUS SUMMARY` 段；prompt 要求「在其基础上合并更新：已完成项保留，不得丢弃；被新证据推翻的改为更新」。
- 摘要固定输出段：`## Goal` / `## Constraints & Preferences` / `## Progress`（`### Done` `### In Progress` `### Blocked`）/ `## Key Decisions` / `## Files Modified` / `## Files Read` / `## Next Steps` / `## Critical Context`。
- 准确性规则写进 prompt：只读工具调用 = 调研，不算实现；无测试通过/用户确认证据不得标 Done；文件路径只用抽取给出的 verified 列表。
- `patchCompactSummary` 扩展：缺 `Files Modified` 段时用 facts.modifiedFiles 补；缺 `Progress` 段且 facts.completedTodos 非空时补 `## Progress\n### Done` 列表。

### R3 分层摘要（超预算时）

- token 估算用 pi 的 `estimateTokens`。按 mode 的单趟上限：fast 20k / auto·balanced 30k / thorough 40k；chunk 上限：fast 6k / auto·balanced 8k / thorough 12k。
- `serializeMessages` 后 tokens < 单趟上限 → 单次调用（现有路径）。
- 否则 `chunkMessages(messages, maxChunkTokens)`：按消息边界切块，**toolCall 与其 toolResult 永不分离**；不足 `minChunkTokens`（chunk 上限的 1/10）的尾块并入前块。
- 每块一次 LLM 调用产出 `### CHUNK i/n: <topic>` + Summary / Decisions / Modified / Read；块调用并发上限 3；最后一次 assemble 调用把所有块摘要 + facts（作为 IMMUTABLE CONTEXT）+ previousSummary 合成 R2 格式。
- 任一块调用失败 → 该块用确定性兜底（facts 中该块范围的文件与错误列表）；assemble 失败 → `assembleFallback`：直接把 previousSummary + facts + 成功的块摘要按 R2 段落拼装，仍返回有效 compaction，不 return undefined。
- auto 模式超时按调用次数放宽：`60s + 30s × 额外调用数`，上限 180s。

### R4 抽取增强

- `extractCompactFacts` 接受 `AgentMessage[]`（经 normalize），新增字段：
  - `modifiedFiles`：`edit`/`write` 的 `path` 参数；Hashline `edit` 无 `path` 时解析 `input` 首行 `[path#TAG]`。
  - `readFiles`：`read` 的 `path`；与 `files` 分离，`files` 保留原语义（全部提及路径）。
  - `completedTodos` / `activeTodos`：取**最后一次** `todo` 调用的 `todos[]`，按 `status` 分为 completed 与 in_progress+pending。
  - `errors` 额外从 `isError: true` 的 toolResult 文本首 200 字符抽取。
- 也吃 `event.preparation.fileOps`（`read/written/edited` Set）合并进 readFiles/modifiedFiles。

### 约束

- 仅改 `src/agent/ensoCompact/**` 与 `src/agent/smartCompact.ts`（如需透传选项）；不改 pi 原生压缩、不改设置 UI。
- `keepRecentTail` 的 tail 保护语义不变。
- TDD：逻辑均为纯函数，测试先行；建议 tester coworker 角色分离。
- `pnpm typecheck && pnpm lint && pnpm test` 干净。

## Acceptance Criteria

- [x] `hook.test.ts`：传入 `AgentMessage[]` 形态的 `messagesToSummarize`，摘要模型收到的 prompt 含最后一条消息的文本（回归：`:` 空行 bug）。
- [x] `hook.test.ts`：`previousSummary` 出现在 prompt；返回的 summary 含 `## Progress`。
- [x] `serialize.test.ts`：同纪元重复 `read` 去重只留最后一次且 assistant 中对应 toolCall 块被移除；跨纪元（中间有 `edit`）不去重；toolResult 截断保留头尾并含 truncated 标记；isError 结果保留尾部错误行。
- [x] `chunk.test.ts`：超预算切块，任一块内不存在没有对应 toolResult 的 toolCall；小尾块并入前块；低于单趟上限返回单块。
- [x] `hook.test.ts`：构造 >30k tokens 的消息集，`complete` 被调用 N(块)+1 次；某块 `complete` 抛错时仍返回含 `## Goal` 的 summary。
- [x] `extract.test.ts`：`modifiedFiles` 含 edit/write 路径与 Hashline `[path#TAG]` 路径；`completedTodos` 只取最后一次 todo 的 completed 项；isError toolResult 进 errors。
- [x] `summarize.test.ts`：`patchCompactSummary` 补 `Files Modified` 与 `Progress/Done`；prompt 含 previousSummary 与 Done/In Progress/Blocked 模板。
- [x] 全量 `pnpm test` 通过（2592）；`typecheck`/`lint` 在 `ensoCompact/**` 干净，剩余 6 个 TS 错误与 2 个 format 错误为 HEAD 上既有、未触及的 renderer 文件。
