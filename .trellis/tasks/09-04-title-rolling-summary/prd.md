# 会话标题滚动总结：每轮结束后按当前标题+本轮请求+本轮结论刷新标题

## 背景

现有「AI 标题总结」（归档任务 `09-02-title-summary`）只在**首条用户消息**发出时触发一次：
renderer 取首条消息文本 → Main 解析标题模型 → worker `completeSimple` 出 ≤20 字短标题 →
`title-generated` 回流写回。之后无论对话走向如何，标题都不再变化。

局限：首条消息往往只是开场（"看下这个报错"/"帮我改一下"），真正的主题要到 agent 给出结论、
用户追问几轮后才清晰。标题应随对话演进而滚动修正。

## Goal

在 `titleSummaryEnabled` 开启时，**每个成功结束的回合**（`turn-completed`）后，用
「当前标题 + 本轮用户请求 + 本轮 agent 结论」的压缩上下文再做一次一次性补全，
让模型判断主题是否变化：变了就给新标题，没变就原样返回当前标题。用户手动改过名的会话永久
不再自动改名。

## Requirements

### R1 触发时机

- 触发点：回合**成功**结束（worker `agent_end` 且非 willRetry、非 error → `turn-completed`）。
  `turn-failed`、用户中断（abortRequested）、自动重试中不触发。
- 每个成功回合都触发，**不做轮次收敛**（用户明确要求）。防抖靠 Prompt：模型可原样返回当前标题。
- 首条消息的即时总结（现有行为）**保留不变**；首轮结束后同样触发滚动总结（此时"当前标题"
  = 即时总结结果或截断标题）。
- 同一会话同时只允许一次总结在飞；回合结束时若上一轮总结尚未回流，本轮跳过（不排队），
  下一回合自然追平。
- 会话在后台/冷缓存（renderer 已驱逐正文，或手机端建的会话）时**同样必须触发**：
  本轮请求/结论文本不能依赖 renderer 的 `conversation.messages`。

### R2 输入内容（压缩上下文）

送给模型的三段：
1. **当前标题**（`conversation.title`）。
2. **本轮用户请求**：本回合内所有 `role: 'user'` 的文本片段（含 steer 中途插入的），
   逐条走现有 `cleanTitleSummarySource` 同款清洗（剥内部引用块 / "从这里继续" 引导行），
   拼接后截头 2000 字符。
3. **本轮结论**：本回合最后一条含 text 的 assistant 消息的文本，**截尾** 1500 字符
   （结论通常在末尾）；不含 thinking / toolCall。

三段中若请求与结论均为空（如纯工具轮），不触发。

### R3 Prompt 要求

- 输出语言跟随用户消息语言；只输出标题本身（无引号/句号/前缀）；CJK ≤20 字、英文 ≈6 词。
- 明确告知："这是当前标题，这是最近一轮的请求与结论；标题应概括**整个对话的主题**而不是只描述
  最后一轮；若当前标题仍准确，**原样输出当前标题**。"
- 与现有首条消息 Prompt 分开维护（两种模式两套 system prompt），共用 `extractTitle` 后处理。

### R4 写回与手动改名守卫

- 沿用 `pendingTitleBaselines` 在飞基准比对：回流时当前标题 ≠ 触发时基准 → 丢弃。
- 新增**持久化**字段 `Conversation.titleLocked?: boolean`：`renameConversation` 手动改名时置
  `true`；`titleLocked` 为 true 的会话跳过一切自动总结（含首条消息即时总结与滚动总结），
  跨重启生效。
- 回流标题与当前标题相同（模型选择"不改"）→ 不写 state（无多余渲染）。
- 失败/超时（15s）静默，不重试、不提示。

### R5 设置

- 复用现有单一开关 `titleSummaryEnabled` 与 `titleSummaryModel`，**不新增设置项**。
- 开关关闭时行为与现状完全一致（首条截断标题，不做任何 AI 总结）。

### R6 模型解析

- 沿用 Main 现有回退链 `titleSummaryModel → defaultModel → sessionModel`，不改。

## Out of Scope

- coworker / child TAB 会话标题（由 coworker 名称决定）。
- 历史旧会话批量补总结。
- 轮次收敛 / 节流策略（用户明确不要）。
- 标题变化的 UI 动效提示。

## Acceptance Criteria

- [x] 开关开启，一个多轮对话在每个成功回合结束后都会发起一次标题总结请求；请求 payload 含
      当前标题、本轮用户请求、本轮结论三段，且各段按 R2 截断。
- [x] 主题未变时回流标题与当前一致，state 不产生多余更新；主题变化时侧边栏标题更新。
- [x] 会话处于后台（非当前查看、正文已驱逐）或为手机端创建时，回合结束同样触发总结且
      payload 三段完整。
- [x] `turn-failed` / 用户中断 / 自动重试 不触发。
- [x] 上一轮总结在飞时本轮不重复发起。
- [x] 用户手动改名后（含重启后），任何自动总结都不再改动标题；`titleLocked` 随 partialize 持久化。
- [x] 首条消息即时总结行为、关闭开关时行为与现状一致（既有测试全绿）。
- [x] 逻辑单测（TDD 先红后绿）：shared 命令/事件 parse 往返、worker 本轮摘要提取与截断、
      滚动 Prompt 组装、renderer 触发门禁（在飞/锁定/失败轮次/冷会话）、`titleLocked` 置位与
      持久化；`pnpm typecheck && pnpm test` 全绿，`biome check` 干净。
- [x] CDP 真机：连续两轮对话，观察第二轮结束后标题被刷新（或合理保持）。
