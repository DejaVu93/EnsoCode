# 执行计划：会话标题滚动总结

TDD 角色分离：逻辑面跨 shared/agent/main/renderer，用 coworker `tester` 先产红灯，主会话/worker 再实现。
每步完成后独立 commit。

## Step 1 shared 契约（红→绿）
- [x] 测试 `src/shared/types/agent.test.ts`：
  - `summarize-title` 命令 `input.kind='initial'` / `'rolling'` 往返；缺 `input`、旧 `text` 字段、rolling 缺 currentTitle、两段皆空 → 拒绝
  - `turn-completed` 带合法 `digest` 往返；`digest` 形状非法 → 整条 null；无 digest 仍合法
  - `parseTitleSummaryInput` 单测
- [x] 实现：`TurnDigest`、`TitleSummaryInput`、`parseTitleSummaryInput`、命令/事件变体与 parser
- [x] `pnpm typecheck`（预期 main/preload/renderer/agent 报错 → 由后续步骤修）；commit `feat(shared): 标题总结命令改判别输入并在 turn-completed 附带 digest`

## Step 2 worker 纯函数（红→绿）
- [x] 测试 `src/agent/titleSummary.test.ts`：
  - `buildTurnDigest`：单 user+assistant；steer 多 user 拼接；assistant 含 thinking/toolCall 只取 text；取**最后一条含 text** 的 assistant；error/aborted assistant 跳过；user 截头 2000、assistant 截尾 1500；两段皆空 → null；fromIndex 越界夹紧；切片无 user 回退最近 user
  - `buildRollingTitleUserText` 三段结构、空段 `(none)`
  - `ROLLING_TITLE_SYSTEM_PROMPT` 含"保持当前标题"指令（字符串断言）
- [x] 实现 `src/agent/titleSummary.ts`
- [x] commit `feat(agent): 本轮摘要提取与滚动标题 prompt`

## Step 3 supervisor 接线
- [x] `ManagedSession.turnStartIndex`：spawn/resume 初始化；`agent_end` 成功分支算 digest → `turn-completed{digest}` → 重置；`failTurn` / abort 收口重置
- [x] `summarizeTitle` 按 `input.kind` 选 prompt
- [x] 若 supervisor 有可行的既有测试夹具（`src/agent/supervisor.*.test.ts`）则补一条"agent_end 后 turn-completed 携带 digest"用例；否则在 Step 7 真机验证覆盖
- [x] commit `feat(agent): turn-completed 携带本轮摘要；summarize-title 支持 rolling`

## Step 4 main + preload
- [x] `agentHost.summarizeConversationTitle(id, input, model)`；IPC handler payload `{conversationId, input, sessionModel?}` 用 `parseTitleSummaryInput` 收窄
- [x] `preload summarizeTitle(id, input, sessionModel?)` + `electronAPI` 类型声明
- [x] 既有 `src/main/ipc` 相关测试若断言旧 payload 则同步更新
- [x] commit `feat(main): 标题总结 IPC 接受判别输入`

## Step 5 renderer store（红→绿）
- [x] 测试 `src/renderer/stores/sessions/index.test.ts`（mock `summarizeTitle`）：
  - `turn-completed{digest}` 触发 `summarizeTitle(id, {kind:'rolling', currentTitle, userText, assistantText}, model)`
  - 在飞未回流时第二次 `turn-completed` 不触发；回流后再触发
  - `turn-failed` 不触发；`abortRequested` 的 `turn-completed` 不触发
  - `titleSummaryEnabled=false` 不触发；`digest` 缺失不触发；child（parentId）会话不触发
  - 冷会话（activeId 是别的会话且正文已驱逐）也触发
  - `renameConversation` 置 `titleLocked=true` 且清 baseline；锁定后 `turn-completed` 与首条即时总结都不触发；`title-generated` 迟到也不覆盖
  - `title-generated` 与当前标题相同 → state 引用不变
  - partialize 保留 `titleLocked`
- [x] 实现：`titleLocked`、`renameConversation`、`trySummarizeTitle` 门禁 + initial 输入、`tryRollingSummarizeTitle`、`turn-completed` 挂点
- [x] 更新既有 4 条首条总结用例的 `summarizeTitle` 断言为 `{kind:'initial', text}`
- [x] commit `feat(renderer): 每轮结束滚动刷新会话标题；手动改名永久锁定`

## Step 6 质量门
- [x] `pnpm typecheck && pnpm test`、`biome check` 全绿（注意本机既有 ~55 个环境性失败先于本任务，需对比基线）
- [x] 派 `trellis-check` 子代理做 spec 合规与跨层一致性检查

## Step 7 真机验证（enso-cdp skill）
- [x] 开启标题总结，新会话发两轮不同主题消息；观察第二轮结束后 `title-generated` 到达且侧边栏标题更新
- [x] 手动改名后再发一轮，标题不变
- [x] 切到其它会话让目标会话变冷，再由目标会话跑一轮（可用 queued message），标题仍刷新

## Step 8 收尾
- [x] `trellis-update-spec`：`.trellis/spec/renderer/state.md` 记 `titleLocked` 与 baseline 双守卫；`.trellis/spec/shared/types.md` 记 `turn-completed.digest` 可选字段与 `TitleSummaryInput`
- [x] 按 Phase 3.4 分批 commit → `/trellis:finish-work`

## 执行记录

- 提交：b829adc（bug 修复）、72bff65、71ebc56、fee4dca、432a6c6、8942bbe、0f51813、2d3b056（spec）
- Step 3 supervisor 级 digest 测试：无现成可用夹具，由 Step 7 真机覆盖
- Step 7 真机（隔离 userData + fake anthropic 端点，CDP 9333）：首轮 initial → 「初始AI标题」；
  第二轮 rolling 请求 payload 三段齐全（Current title / Latest user request / Latest assistant conclusion）→ 「滚动标题-1」；
  手动改名后第三轮无 rolling 请求，标题保持「我自己起的名」，titleLocked=true
- 全量测试：仅 backgroundTasks / checkpoint 等 8 个文件失败，均先于本任务存在（在 1114334 上复现）

## 回滚点
每步独立 commit，可按步 revert；Step 1 单独 revert 会让下游 typecheck 失败，需连同 Step 2–5 一起回退。
