# 设计：接口契约

所有代码位于 `src/agent/ensoCompact/`。消息类型统一用 pi 的 `AgentMessage`（`@earendil-works/pi-agent-core`）；
测试可用最小字面量：`{ role: 'user', content: 'hi' }`、
`{ role: 'assistant', content: [{ type: 'text', text }, { type: 'toolCall', id, name, arguments }] }`、
`{ role: 'toolResult', toolCallId, toolName, content: [{ type: 'text', text }], isError? }`。

## serialize.ts（R1）

```ts
export function normalizeMessages(input: unknown[]): AgentMessage[];
// 接受 CompactBranchEntry[]（{ type:'message', message:{...} }）或 AgentMessage[]（顶层 role）。
// 非 message 条目（无 role）丢弃。

export interface PruneOptions { maxToolResultChars?: number } // 默认 800
export const READ_ONLY_TOOLS: ReadonlySet<string>; // read grep find ls glob + mcp__* 搜索类可不含
export function pruneMessages(messages: AgentMessage[], opts?: PruneOptions): AgentMessage[];
// 1) 同纪元重复只读调用（name + stableJSON(arguments) 相同）只留最后一次；
//    纪元由 role==='assistant' 中 name ∈ {edit, write, bash} 的 toolCall 推进（在该 toolCall 之后 +1）。
//    被删的 toolResult 移除；对应 assistant 消息中的 toolCall 块移除；若 assistant 内容因此为空则整条移除。
// 2) toolResult 文本 > maxToolResultChars：非 error 头尾各 half；isError 头 1/4 尾 3/4；
//    中间插 `\n[... N chars truncated]\n`。

export function serializeMessages(messages: AgentMessage[]): string;
// 复用 pi：serializeConversation(convertToLlm(messages))。
// 输出行前缀：[User]: / [Assistant]: / [Assistant tool calls]: name(k=v) / [Tool result]:
```

## extract.ts（R4）

```ts
export interface CompactFacts {
  goal: string;
  constraints: string[];
  errors: string[];
  files: string[];          // 原语义：所有提及路径
  readFiles: string[];      // read 的 path
  modifiedFiles: string[];  // edit/write 的 path；Hashline edit 解析 input 首行 [path#TAG]
  completedTodos: string[]; // 最后一次 todo 调用中 status==='completed' 的 content
  activeTodos: string[];    // 最后一次 todo 调用中 in_progress + pending 的 content
  openLoops: string[];
}
export interface FileOpsLike { read: Iterable<string>; written: Iterable<string>; edited: Iterable<string> }
export function extractCompactFacts(messages: AgentMessage[], fileOps?: FileOpsLike): CompactFacts;
// 注意：入参改为 AgentMessage[]（调用方先 normalizeMessages）。
// errors 额外来源：toolResult.isError===true 的文本前 200 字符。
```

## chunk.ts（R3）

```ts
export type CompactMode = 'auto' | 'fast' | 'balanced' | 'thorough';
export const BUDGETS: Record<CompactMode, { singlePassMaxTokens: number; maxChunkTokens: number }>;
// fast 20k/6k, auto 30k/8k, balanced 30k/8k, thorough 40k/12k

export interface MessageChunk { index: number; messages: AgentMessage[]; tokens: number }
export function chunkMessages(messages: AgentMessage[], maxChunkTokens: number): MessageChunk[];
// tokens = estimateTokens(serializeMessages(chunk.messages))（pi 的 estimateTokens，chars/4 近似即可）。
// 切点只落在「assistant(toolCall) … 全部对应 toolResult」这一组之后；
// 尾块 tokens < maxChunkTokens/10 时并入前块；整体 ≤ 单趟上限时由调用方决定不切（chunkMessages 本身仍可返回 1 块）。
```

## summarize.ts（R2/R3 prompt）

```ts
export const SUMMARY_SECTIONS: readonly string[];
// ['## Goal','## Constraints & Preferences','## Progress','## Key Decisions','## Files Modified','## Files Read','## Next Steps','## Critical Context']

export function compactSummaryPrompt(facts: CompactFacts, transcript: string, previousSummary?: string): string;
// 含：格式模板（Progress 下 ### Done / ### In Progress / ### Blocked）、准确性规则、
// Facts JSON、previousSummary（若有，截到 12_000 字符，段名 "PREVIOUS SUMMARY"，并要求合并更新不丢 Done）、
// <conversation>transcript</conversation>

export function chunkSummaryPrompt(facts: CompactFacts, chunkText: string, index: number, total: number): string;
// 要求输出 `### CHUNK ${index+1}/${total}: <topic>` + **Summary** / **Decisions** / **Modified** / **Read**

export function assemblePrompt(facts: CompactFacts, chunkSummaries: string[], previousSummary?: string): string;
// IMMUTABLE CONTEXT = facts.modifiedFiles/readFiles/errors/completedTodos；输出 SUMMARY_SECTIONS 格式

export function assembleFallback(facts: CompactFacts, chunkSummaries: string[], previousSummary?: string): string;
// 纯拼装，不调模型；必含 '## Goal' 与 '## Progress'

export function patchCompactSummary(summary: string, facts: CompactFacts): string;
// 现有行为保留；新增：缺 'Files Modified' 段且 facts.modifiedFiles 非空 → 追加；
// 缺 'Progress' 段且 facts.completedTodos 非空 → 追加 '## Progress\n### Done\n- [x] ...'

export function textFromComplete(response: { content?: unknown }): string; // 不变
```

## extension.ts（编排）

```
messages = normalizeMessages(preparation.messagesToSummarize ?? branch − keepRecentTail)
pruned   = pruneMessages(messages)
facts    = extractCompactFacts(pruned, preparation.fileOps)
prev     = preparation.previousSummary
text     = serializeMessages(pruned)
if estimateTokens(text) < BUDGETS[mode].singlePassMaxTokens:
    summary = complete(compactSummaryPrompt(facts, text, prev))
else:
    chunks  = chunkMessages(pruned, BUDGETS[mode].maxChunkTokens)
    parts   = mapConcurrent(chunks, 3, c => complete(chunkSummaryPrompt(...)).catch(() => deterministicChunkNote(c)))
    summary = complete(assemblePrompt(facts, parts, prev)).catch(() => assembleFallback(facts, parts, prev))
return { compaction: { summary: patchCompactSummary(summary, facts), firstKeptEntryId, tokensBefore } }
```

超时：auto 触发时 `min(180_000, 60_000 + 30_000 × (calls − 1))`。

## 测试文件

`serialize.test.ts`、`chunk.test.ts`、`extract.test.ts`（扩展）、`summarize.test.ts`（新）、`hook.test.ts`（扩展）。
