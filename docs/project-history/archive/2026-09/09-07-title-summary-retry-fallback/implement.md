# Implement：标题总结回退链多候选 + 递增超时 + 失败可见 + 手动重试

TDD 纪律：纯逻辑面（shared parser、titleSummary 纯函数、supervisor 依次尝试、store reducer/action）
全部 Red-Green；UI（Sidebar）不强制单测，真机 CDP 验证。每步 < 50 行测试 / < 10 用例即 inline，
否则拆刀。每完成一个可独立描述的改动就 commit。

## Step 1 shared 协议（`src/shared/types/agent.ts` + `.test.ts`）
- [ ] RED：`summarize-title` 接受 `candidates`（1–3 项）往返；空数组拒绝；4 项拒绝；旧 `model` 单字段拒绝；某项缺 `settingsProviderId` 拒绝
- [ ] RED：`title-failed` 事件完整往返；缺 `error` / 空串 / 多余键 → null
- [ ] GREEN：类型 + `parseAgentCommand` + `parseAgentWorkerEvent`
- [ ] 同步 `agentSessionIndex.identityOf` 的 `Exclude` 与 `shouldIndex`、`reducer.eventIdentity` / 早返回 各加 `title-failed` 旁路（现有 `title-generated` 处并列即可）
- [ ] `pnpm exec vitest run src/shared/types/agent.test.ts src/main/services/agentSessionIndex.test.ts src/renderer/stores/sessions/reducer.test.ts`
- [ ] commit `feat(shared): summarize-title 改为候选数组；新增 title-failed 旁路事件`

## Step 2 worker 纯函数（`src/agent/titleSummary.ts` + `.test.ts`）
- [ ] RED：`titleSummaryTimeoutMs(0/1/2/5)` → 60000/120000/180000/180000
- [ ] RED：`titleRejectReason`：合法短标题 → null；`''` → empty；「继续排查节点一直转圈的问题。我先查看当前代码。然后…」 → did not return a title；单句尾带一个句号（已被 extractTitle 剥）→ null
- [ ] RED：`describeTitleModel`：oauth 配置 → `cursor/composer-2.5-fast`；apiKey 配置 → `<settingsProviderId>/<modelId>`
- [ ] GREEN：实现三函数，导出 `TITLE_SUMMARY_TIMEOUTS_MS`
- [ ] commit `feat(agent): 标题总结超时档位、结果合法性守卫与模型标识`

## Step 3 worker 依次尝试（`src/agent/supervisor.ts` + 新 `supervisor.titleSummary.test.ts`）
- [ ] RED（mock runtime.completeSimple / resolveBaseModelOrRefresh）：
  - 候选 #0 返回 aborted → #1 返回合法标题 → 只 emit 一次 `title-generated`，不再调 #2
  - #0 返回多句叙述 → 走 #1
  - #0 `resolveBaseModelOrRefresh` 抛错 → 走 #1
  - 全部失败 → emit `title-failed`，`error` 以最后候选标识开头且含 `timed out after 180s`
  - 每个候选传入的 AbortSignal 对应的 setTimeout 档位正确（用 `vi.useFakeTimers` 推进 60s 触发 #0 abort）
- [ ] GREEN：按 design §3.2 重写 `summarizeTitle`；删 `TITLE_SUMMARY_TIMEOUT_MS`
- [ ] `pnpm exec vitest run src/agent/supervisor.titleSummary.test.ts src/agent/supervisor.resolve.test.ts`
- [ ] commit `feat(agent): 标题总结按候选依次尝试、递增超时，全失败回 title-failed`

## Step 4 main（`src/main/ipc/agent.ts`、`src/main/services/agentHost.ts` + 既有测试）
- [ ] RED：IPC handler 三候选全可解析 → `summarizeConversationTitle` 收到 3 个 config；其一不可解析 → 收到 2 个；全不可解析 → `{ok:false,error:'no usable title model'}`（找 `src/main/ipc/agent*.test.ts` 里既有 summarize 用例改写）
- [ ] GREEN：handler 收集全部；`summarizeConversationTitle(id, input, candidates)`
- [ ] commit `feat(main): 标题总结下发全部可解析候选`

## Step 5 renderer store（`src/renderer/stores/sessions/index.ts` + `index.test.ts`）
- [ ] RED：
  - 发起总结（initial / rolling）后 `titleSummaryPending === true`；`title-generated` / `title-failed` 到达后为 undefined
  - `title-failed` 在飞 → `titleSummaryError` 写入、pending 清除；不在飞 → state 引用不变
  - `title-failed` 对 `titleLocked` 会话不写错误
  - `title-generated` 成功清 `titleSummaryError`（含 title 相同的分支）
  - `renameConversation` 清 `titleSummaryError` 与 `titleSummaryPending`
  - `turn-completed` 带 digest → `lastTurnDigest` 写入
  - `summarizeTitle` IPC 返回 `{ok:false,error}` → 与 `title-failed` 同效
  - `retryTitleSummary`：有 digest → rolling；无 digest 有正文 → initial(首条用户文本)；无正文 → initial(title)；`titleLocked` / 开关关 / 在飞 → 不调用；调用后 error 清空且 pending=true
  - 开关切 false → 所有 `titleSummaryError` / `titleSummaryPending` 清空
  - `partialize` 不含 `titleSummaryError` / `titleSummaryPending` / `lastTurnDigest`
- [ ] GREEN：design §5 全部（含 `markTitlePending` / `clearTitlePending` helper 收口）
- [ ] `pnpm exec vitest run src/renderer/stores/sessions/index.test.ts`
- [ ] commit `feat(chat): 标题总结在飞/失败态、最近回合 digest 与手动重试 action`

## Step 6 Sidebar UI（`src/renderer/components/chat/Sidebar.tsx`、i18n）
- [ ] 新建 `TitleSummaryBadge`（转圈 / 红叹号 / null，pending 优先）插在标题 span 之后（design §6）；三处调用点传 `onRetryTitleSummary`
- [ ] i18n 新增 `Summarizing title` / `Title summary failed` / `Click to retry`（zh/en）
- [ ] `pnpm typecheck && pnpm exec biome check src/renderer/components/chat/Sidebar.tsx`
- [ ] commit `feat(sidebar): 标题总结中显示转圈，失败显示红叹号与原因，点击重试`

## Step 7 全量验证
- [x] `pnpm typecheck` 通过；`pnpm test` 中 title 相关 6 个文件 204 用例全绿；其余 17 个失败文件（symlink/SSH/shellPath 等）在任务基线 `06bdeb9` 上同样失败，属 Windows 环境存量，非本任务引入
- [x] biome：任务改动文件 `biome lint` 干净；全仓 `biome check .` 因工作树 CRLF 与仓库 LF 不一致整体报 format，属环境存量；唯一真实格式差异（`supervisor.titleSummary.test.ts` 长签名折行）已单独提交
- [x] 真机 CDP（2026-09-07，`ENSO_USER_DATA_DIR=D:\tmp\enso-title-iso`、`ENSO_CDP_PORT=9555` 隔离实例；标题模型 `Cursor/composer-2.5-fast`，全局默认 `grok-4.6`）：
  1. 首条消息发出后侧栏标题紧后立即出转圈，`aria-label=标题总结中`；**两个 Cursor 候选均超时**（composer 60s 不回、grok-4.6 120s 不回，独立 probe 复现：grok 在标题 prompt 下也把任务当编码去干，输出多句叙述后 120s 仍未 stop），最终 `title-failed` 回流，转圈切为红叹号，`titleSummaryError = "cursor/grok-4.6: timed out after 120s"` 含模型标识 ✓
  2. 点击红叹号：`activeId` 不变（不切会话）、叹号立刻切回转圈、`titleSummaryError` 清空、无 digest 时走 initial ✓
  3. 隔离环境追加 apiKey provider（haiku-4.5）为全局默认后再触发：`title-generated` 回流「侧栏拖拽用 dnd-kit 改造」、转圈消失、标题写回 ✓（说明回退链在有可用候选时能兑底；Cursor 两模型在此 prompt 下均不可用是模型问题，与实现无关）
- [ ] `trellis-check` 全量（未跑，逻辑面由单测覆盖，UI 由真机验证覆盖）

### 真机发现（备查）
- Cursor 订阅下 `grok-4.6` 对 initial/rolling 两种 prompt 都不按「只输出标题」执行，120s 仍在叙述；用户实际可用的标题模型需要走 apiKey provider 的小模型（haiku 类 2–4s 出正确标题）。
- 隔离验证结束后已删除 `D:\tmp\enso-title-iso*`（含临时写入的真实 apiKey）与所有 `tmp-*` 脚本。

## Rollback
每步独立 commit；任一步出问题 `git revert` 该步。协议变更在 Step 1，若整体回滚需从 Step 1 起逆序 revert。无持久化迁移。
