# PRD：滚动标题总结锚定会话主旨

## Background

滚动标题总结（每个成功回合后刷新）现在只给模型三样东西：**当前标题**、**本轮 user 文本**、**本轮 assistant 结论**。
真机截图：用户说「开始实施」，模型产出「开始实施：先读 PRD 并定位相关代码」——标题被本轮动作覆盖，
再也看不出这个会话是在干什么。

根因有两层：

1. **输入缺主旨锚点**。第一轮之后模型永远看不到「这个会话最初是为了什么」；当前标题本应承担锚点作用，
   但如果首条总结失败/超时（Cursor 模型不听 prompt 是常态），当前标题就是**首条消息的截断**——
   而用户首条消息往往是「继续」「按 PRD 做」这类短句，锚点本身就是空的。
2. **prompt 没有「推进类回合不算话题转移」的规则**。「继续 / 开始实施 / 好的 / 修一下」这类回合
   只是同一话题往前走，模型却把它当成「话题变得更具体」而重写。

## Goal

滚动总结产出的标题必须始终能回答「这个会话在聊什么」，不被单轮动作劫持。

## Requirements

### R1 TurnDigest 带首条请求作为主旨锚点
- `TurnDigest` 新增 `firstUserText: string`：会话**第一条** user 消息的清洗文本（`buildTitleUserText` 清洗，截头 `TURN_DIGEST_FIRST_USER_MAX = 600`）。
- worker `buildTurnDigest(messages, fromIndex)` 从全量 `messages` 里取第一条 user 填充；无 user 时为空串。
- `parseTurnDigest` 三键精确校验；`TitleSummaryInput.rolling` 同步新增 `firstUserText`，`parseTitleSummaryInput` 允许其为空串（旧会话冷启动时可能拿不到）。
- **不做兼容层**：`hasExactKeys` 仍严格，缺键即 null——renderer 与 worker 同包发布，不存在版本错配。

### R2 rolling prompt 显式锚定
`ROLLING_TITLE_SYSTEM_PROMPT` 与 `buildRollingTitleUserText` 改为四段：
```
Opening request (the conversation's main topic):
<firstUserText | (none)>

Current title: ...
Latest user request: ...
Latest assistant conclusion: ...
```
system prompt 新增规则（措辞可调，语义必须有）：
- The title must describe the conversation's main topic, anchored on the opening request.
- If the latest request only continues, confirms, or asks to proceed with the existing topic
  (e.g. "continue", "go ahead", "start implementing", "ok do it"), reply with the current title verbatim.
- Never turn a single step or action of the latest turn into the title.

### R3 renderer 侧对推进类回合直接跳过
纯 prompt 约束对不听话的模型没用（真机已证）。在 `tryRollingSummarizeTitle` 前加纯函数守卫
`isContinuationTurn(userText): boolean`：
- 去空白、去尾部标点后长度 ≤ 12 字符（CJK）/ ≤ 4 词（英文）**且**命中推进词表
  （继续、开始、开始实施、实施、执行、去做、做吧、好的、可以、行、OK、ok、go、go ahead、continue、proceed、do it、yes、next、下一步、然后呢、接着）→ true。
- 命中 → 不发滚动总结（标题维持现状），`lastTurnDigest` 仍照常写入（手动重试仍可用）。
- 只在 `rolling` 路径生效；`initial` 路径本来就有 `CONTINUATION_LINE` 处理，保持不动。

### R4 现有 `CONTINUATION_LINE` 与新词表收口
`buildTitleUserText` 里的 `CONTINUATION_LINE`（从这里继续 / 继续 / continue）与 R3 词表来源同一个常量表，避免两处各自漂移。

## Non-Goals
- 不改 initial 模式的 prompt。
- 不持久化 `firstUserText`（随 digest 走，重启即清）。
- 不做「标题历史/回滚」。

## Acceptance Criteria
- [ ] `buildTurnDigest`：`firstUserText` 取全量第一条 user 清洗后截 600；切片 fromIndex>0 时依然取全量第 0 条 user；无 user 为空串。
- [ ] `parseTurnDigest` / `parseTitleSummaryInput('rolling')`：三键/五键精确；`firstUserText` 允许空串；缺键 → null。
- [ ] `buildRollingTitleUserText` 输出含 `Opening request` 段，空时 `(none)`。
- [ ] `isContinuationTurn`：「开始实施」「继续」「好的，做吧」「go ahead」「ok」→ true；「开始实施 dnd-kit 迁移」「继续排查节点转圈问题」「帮我修一下登录」→ false。
- [ ] renderer：`turn-completed` 的 digest.userText 是推进类 → 不调 `summarizeTitle`，但 `lastTurnDigest` 已写；非推进类 → 照常调用且 input 含 `firstUserText`。
- [ ] `retryTitleSummary` rolling 路径带上 `firstUserText`。
- [ ] 全部逻辑 TDD Red-Green；`pnpm typecheck` 通过；title 相关测试文件全绿。
- [ ] 真机 CDP（隔离实例、apiKey 小模型作候选）：新会话「帮我把侧栏拖拽改成 dnd-kit」→ 标题总结出 → 第二轮发「开始实施」→ 标题**不变**、无 summarizeTitle 调用；第三轮发「顺便把 CoworkerTabs 的拖拽也换掉」→ 标题更新但仍含 dnd-kit 主旨。
