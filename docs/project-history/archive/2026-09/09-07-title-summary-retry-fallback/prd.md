# PRD：标题总结——回退链多候选、递增超时、失败可见与手动重试

## Background

会话标题 AI 总结（首条即时 + 每轮滚动）现状：Main 按回退链（标题模型 → 全局默认 → 会话模型）
只挑**第一个能解析**的模型下发 worker；worker 用固定 15s 超时做一次 `completeSimple`，超时 /
出错 / 提取不到标题一律**静默丢弃**，用户完全感知不到"总结过但失败了"。

真机复现（2026-09-07）：用户标题模型选 `Cursor / composer-2.5-fast`，实测：
- 该模型不听 system prompt，把"输出标题"当成编码任务去执行，60s 都不返回标题；
- Cursor 订阅走 pi-cursor h2 bridge，首包慢——连全局默认 `grok-4.6` 也要 ~25s 才回正确标题「修复节点状态转圈」，超过 15s 被丢弃。

因此**同一模型硬重试无意义，换模型有意义**；固定 15s 对订阅类 provider 过紧；静默失败让用户误以为功能坏了。

## Goal

让标题总结在"模型慢 / 模型不听话 / 网络抖"三类失败下仍尽力拿到标题；确实拿不到时**在侧栏可见可解释**，并允许用户一键手动重试。

## Requirements

### R1 回退链多候选，依次尝试
- Main 解析回退链时不再只取第一个可用候选，而是把**全部可解析**的候选（去重，最多 3 个）一次性下发 worker。
- worker 按序尝试，前一个失败（超时 / 抛错 / 结果不像标题）才试下一个；任一成功即回 `title-generated` 并停止。
- 顺序不变：独立标题模型 → 全局默认 → 当前会话模型。

### R2 递增超时
- 第 1 / 2 / 3 个候选分别用 **60s / 120s / 180s** 超时。候选数不足 3 时按实际个数取前几档。
- 单次总结的最坏总时长 = 6 分钟；期间该会话的新一轮滚动总结照旧被在飞守卫跳过（回流后下一轮再触发），可接受。

### R3 "结果像不像标题"守卫
- worker 提取标题后增加合法性判断：首行去引号后为空、或长度超过 `MAX_TITLE_CHARS`（80）、或首行含明显多句叙述（含 2 个及以上中文/英文句终标点后仍有内容）→ 视为 `model did not return a title`，走下一候选。
- 目的：避免 composer 类模型返回的一段叙述被截成烂标题当成功写回。

### R4 全部失败 → 失败事件
- 所有候选都失败后 worker 回新事件 `title-failed { conversationId, error }`。
- `error` 为人可读的**最后一次失败原因**，须包含用了哪个模型：例如
  `cursor/composer-2.5-fast: timed out after 60s`、`openai/gpt-x: model did not return a title`、`…: <网络错误 message>`。
- Main 侧在解析阶段就失败（开关关 / 无凭证 / 无可用候选）时，IPC 已同步返回 `{ok:false,error}`；renderer 把它同样记为失败原因（不必经 worker 事件）。

### R5 侧栏失败指示 + tooltip
- `Conversation` 新增**不持久化**字段 `titleSummaryError?: string`。
- 侧栏会话行：有 `titleSummaryError` 时在**标题文字紧后**（状态槽，见 R9）显示一个小的红色感叹号图标；时间戳与 hover 操作按钮不受影响。
- hover 感叹号显示 tooltip：第一行「标题总结失败」（i18n），第二行为 `error` 原文，第三行「点击重试」。
- 以下情形清空 `titleSummaryError`：收到该会话 `title-generated`；用户手动改名（`renameConversation`）；用户点击重试并成功发起。

### R9 侧栏总结中指示（转圈）
- `Conversation` 新增**不持久化**字段 `titleSummaryPending?: boolean`，与 store 内部在飞守卫 `pendingTitleBaselines` 同步：发起总结时置 true，收到 `title-generated` / `title-failed` / 手动改名 / 开关关闭 / IPC 同步拒绝 时置 false。
- 侧栏会话行：`titleSummaryPending` 为 true 时在**标题文字紧后**显示一个小的旋转加载图标（`Loader2` + `animate-spin`，弱色），hover tooltip「标题总结中」（i18n）。
- 转圈与红叹号共用同一个状态槽：pending 优先显示转圈（点击重试后立刻从叹号切到转圈）；两者皆无则不渲染任何内容，标题行布局与现状一致。
- 现行机制下每个成功回合都会触发滚动总结，转圈会频繁出现且最长可持续 6 分钟（R2），属预期行为。
- 手机端（pair / phone）不展示。

### R6 点击感叹号 = 手动重试
- 点击感叹号触发一次滚动模式总结（用当前标题 + 最近一轮 digest）。renderer 需保留**最近一次成功回合的 digest**（不持久化）以支持重试；没有 digest（如首条总结失败后还没跑完一轮）时退回 initial 模式，用会话首条用户消息文本。
- 点击后立即清掉感叹号并进入在飞状态；再次失败会重新出现。
- 点击不冒泡（不切换会话）。

### R7 不改变既有守卫语义
- `titleLocked`（手动改名永久锁定）、`pendingTitleBaselines`（在飞去重 + 基准比对）、`title-generated` 基准比对写回 全部保持。
- `title-failed` 回流时同样只对**仍在飞**的会话生效（防止迟到事件把已成功的状态覆盖成失败）。

### R8 关闭开关时的行为
- 开关关闭 → 不发起、不显示感叹号；已存在的 `titleSummaryError` 在下一次开关关闭时清空（避免残留）。

## Non-Goals
- 不做同一模型多次硬重试。
- 不把失败写入持久化存储或日志文件；重启即清。
- 不改 prompt 措辞、不改 `TitleSummaryInput` 判别形状。
- 不在手机端（pair / phone）展示失败状态。

## Acceptance Criteria

- [ ] Main `AGENT_SUMMARIZE_TITLE`：三个候选都可解析时下发 3 个 `SpawnModelConfig`；重复的（如标题模型 == 全局默认）去重；无可解析候选时返回 `{ok:false,error:'no usable title model'}`。
- [ ] worker：第 1 个候选 60s 内无结果 → 自动尝试第 2 个（120s）→ 第 3 个（180s）；任一成功即发 `title-generated` 且不再尝试后续。
- [ ] worker：候选返回一段多句叙述（模拟 composer 行为）时判失败并走下一候选。
- [ ] worker：全部失败 → 发 `title-failed`，`error` 含最后一个模型标识与失败原因。
- [ ] renderer：`title-failed` 到达且会话仍在飞 → `titleSummaryError` 写入、在飞基准清除；不在飞 → 忽略。
- [ ] renderer：`title-generated` / `renameConversation` / 手动重试发起 → `titleSummaryError` 清空。
- [ ] renderer：手动重试有 digest 走 rolling，无 digest 走 initial；`titleLocked` 会话不触发。
- [ ] 侧栏：有错误时标题后渲染红色感叹号，tooltip 展示「标题总结失败」+ 原文 + 「点击重试」；点击触发重试且不切换会话。
- [ ] 侧栏：总结在飞时标题后渲染旋转加载图标，tooltip「标题总结中」；`title-generated` / `title-failed` 到达后消失；点击叹号重试后立刻切换为转圈。
- [ ] renderer：`titleSummaryPending` 在发起时为 true，在 generated / failed / rename / 开关关 / IPC 拒绝 后为 false；不进 partialize。
- [ ] 协议：`parseAgentCommand('summarize-title')` 接受 `candidates: SpawnModelConfig[]`（1–3 项，每项过 `parseSpawnModelConfig`），拒绝空数组 / 旧 `model` 单字段形状；`parseAgentWorkerEvent('title-failed')` 完整往返、脏输入返 null。
- [ ] 逻辑单测（TDD）覆盖：候选收集、超时档位映射、标题合法性守卫、worker 依次尝试与失败事件、renderer 失败写入/清除/重试分流。
- [ ] `pnpm typecheck && pnpm test` 全绿，`biome check` 干净。
- [ ] 真机（CDP）：标题模型故意选 composer-2.5-fast、全局默认 grok-4.6，新会话首条消息后 ≤ 2 分钟标题被正确总结（走到第 2 候选）。
