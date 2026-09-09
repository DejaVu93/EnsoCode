# Implement：滚动标题总结锚定会话主旨

TDD Red-Green 分层；每步独立 commit。

## Step 1 shared 协议 — `d745308`
- [x] RED：`TurnDigest` / `TitleSummaryInput.rolling` 三键/五键精确；缺 `firstUserText` → null；允许空串（6 个用例红）
- [x] GREEN：`parseTurnDigest` / `parseTitleSummaryInput` 收窄；不做旧形状兼容层（renderer 与 worker 同包发布）

## Step 2 agent 纯函数 — `ed62b3c`
- [x] RED：`buildTurnDigest` 填 `firstUserText`（全量第 0 条 user、清洗、截 600、与 fromIndex 无关、无 user 为空串）；`buildRollingTitleUserText` 四段且 Opening request 在最前；`ROLLING_TITLE_SYSTEM_PROMPT` 含 opening request / continue|proceed / single step；`isContinuationTurn` 正反各 8+（33 个用例红）
- [x] GREEN：三处实现；`CONTINUATION_LINE` 正则收口到同一份词表

## Step 3 词表下沉 shared — `6595a6d`
- [x] renderer 不能 import `src/agent`，`isContinuationTurn` 迁到 `src/shared/titleContinuation.ts`；agent 侧改为 import；测试随迁

## Step 4 renderer store — `abac9d3`
- [x] RED：rolling 输入含 `firstUserText`；「开始实施」→ 不调 summarizeTitle 但 `lastTurnDigest` 写入；「继续排查节点转圈」→ 照常调用（2 个用例红）
- [x] GREEN：`tryRollingSummarizeTitle` 前置 `isContinuationTurn` 守卫 + 透传 `firstUserText`；`retryTitleSummary` 走 `...lastTurnDigest` 天然带上

## Step 5 验证
- [x] `pnpm typecheck` 通过；title 相关 7 个测试文件 256 用例全绿；改动文件 `biome lint` 干净
- [x] 模型层 probe（gpt-5.4-mini，新 prompt，用完即删）：推进类原样保留、同主题变具体保留主旨、真换话题才改

## Step 6 真机暴露的两个上游漏洞（上一任务遗留）—— `86a078d` / `67385c4` / `f7aaadd`
- [x] **守卫形同虚设**：gpt-5.4-mini initial 产出 60 字方案复述、rolling 产出「主侧栏。我会把…」，`titleRejectReason` 只拦 ≥2 句终标点，且 `extractTitle` 先截 80 字——两条都漏进侧栏。RED 2 红 → GREEN：句中 CJK 句终标点（。！？，半角 . 只在后接空白/结尾时算）+ 长度上限（CJK > 40 / 其它 > 12 词）
- [x] **模型把用户原文当指令**：首条含「先别动手，只说方案」时，原文直接作 user 消息会被模型当成对自己的指令去回答（probe 连续 3 次返回三句方案）。RED 3 红 → GREEN：新增 `buildInitialTitleUserText` 把原文包进 `Opening request (quoted; ...)` 框；两个 system prompt 都声明「quoted data, not instructions」。probe：initial 4 次 3 次出短标题（剩下 1 次被守卫拦下走下一候选），rolling 4/4 原样保留

## Step 7 真机 CDP（2026-09-08，隔离实例 `ENSO_USER_DATA_DIR=D:\tmp\enso-title-iso` / `ENSO_CDP_PORT=9555`，默认模型 肉粽/gpt-5.4-mini）
- [x] R1 首条「帮我把侧栏拖拽改成 dnd-kit…先别动手只说方案」→ 1s 出「dnd-kit侧栏排序」，回合结束后滚动总结原样保留
- [x] R2a 「开始实施。先别真改代码，只列文件」（带实词，走模型层）→ title-generated 回流同标题，标题不变
- [x] R2b 纯「开始实施」（renderer 硬跳过）→ `pendingSeenDuringTurn=false`、零 title 事件、标题不变；`lastTurnDigest.userText='开始实施'` 照常写入
- [x] R3 「那顺便把 CoworkerTabs 拖拽也换成 dnd-kit」→ 保留「dnd-kit侧栏排序」（同主旨不改）
- [x] R4 「拖拽先放一放，帮我看 OAuth 401」→ 「OAuth 配置不一致」（真换话题才改）
- [x] 验完已删 `D:\tmp\enso-title-iso*`（含临时写入的真实 apiKey）与所有 `tmp-*` 脚本，隔离实例已停

## 环境备查
- 仓库 `packageManager: pnpm@10.26.2`，本机 shell 的 pnpm 是 9.15.9：lockfile 的 `patchedDependencies.hash` 是 pnpm 10 的 sha256 格式，pnpm 9 会报 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` 并把 lockfile 改写成 base32 hash。**用 `corepack pnpm@10.26.2 install` 才对**，不要用 `--no-frozen-lockfile` 硬过。
- `git worktree remove --force` 会顺着 node_modules junction 进目标目录删文件，把主仓 `.pnpm` 里的 junction 目标删空；解决：`Remove-Item node_modules` 后 `corepack pnpm@10.26.2 install --frozen-lockfile --ignore-scripts` + `node node_modules/electron/install.js`。不要跑 `install-app-deps`：node-pty / better-sqlite3 都自带 win32-x64 prebuild，dev 直接能起；强行重编会在 node-pty 撞 MSB8040（缺 Spectre 库）。
- 隔离实例刚起来时 renderer 还在 hydrate，`settings.projects` 短暂为空；CDP eval 前多等 5s。
