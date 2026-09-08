# Design: Enso compact hook

## 行为差距

现在：开关开则加载 `pi-smart-compact`。包会注册 recall/save 工具、写 `~/.pi`、用窗口目标 + 10% 收益 fail-closed，手动 `/compact` 常毫秒级让出原生。

应该：Enso 自己的 hidden inline extension 只处理 `session_before_compact`，交出摘要；Pi 原生 apply。关或失败与现在原生一致。

## 层

行为住在 **agent worker**（`src/agent/`）。设置 / spawn 协议已有，不新增 IPC。Renderer 只改文案。

## 集成面

```
/compact 或阈值 compact
  → Pi session.compact()
  → session_before_compact（Enso hook）
      抽取 →（可选）单轮 LLM → 校验缺口（确定性补丁，必要时第二轮）
      成功：return { compaction: { summary, tokensBefore } }  → fromHook
      失败 / 放弃：return void → 原生 summarizer
  → session_compact apply（Pi 改消息树）
```

不挂 `session_compact` 自己写盘。时间线 `stampCompactionFromHook` / `verified` 沿用。

## Hook 模块

替换 `smartCompactInlineExtension.factory`：不再 `import` 第三方默认导出。

建议拆文件（名字可调，职责不要糊）：

| 模块 | 职责 |
|------|------|
| `src/agent/ensoCompact/extract.ts` | 从 branch / context entries 抽 goal、constraints、errors、open loops、files（纯函数） |
| `src/agent/ensoCompact/window.ts` | 留尾巴：成对工具、按档位 keepRecent；**不**用 10% 收益拒绝手动 compact |
| `src/agent/ensoCompact/summarize.ts` | 调 registry 里的摘要模型，拼固定章节模板 |
| `src/agent/ensoCompact/extension.ts` | `pi.on('session_before_compact')`；超时；不 `registerTool` |
| 现有 `src/agent/smartCompact.ts` | 只留 spawn 用的 `providerKeyFor` / `formatSmartCompactSummaryModel` / 设置类型；删 merge 写 HOME、usage 包装、包 factory |

`usageForSmartCompactPlanning` 与 `wrapSmartCompactFactory` 属于给第三方包打补丁，**删除**。

## 摘要契约（稳定章节）

Markdown，固定标题，便于时间线与回归：

- Goal
- Constraints / 用户硬指令
- Progress
- Open loops
- Errors
- Files
- Topics（可选，短）

缺字段用抽取结果填，不编造。LLM 漏了 goal / constraint / error 时确定性补丁补上（`01a07531` 那次包也是这样做的）。

## 档位

| mode | 含义（Enso） |
|------|----------------|
| `fast` | 短摘要、短尾巴 |
| `balanced` | 默认推荐的预算（产品默认仍可以是设置里的 `auto`） |
| `thorough` | 更长摘要、更长尾巴 |
| `auto` | 按占用在 fast/balanced 间选预算，**不**因此拒绝交出摘要 |

手动 compact：只要前缀足够合成，就交。自动：过短或超时才让出。

## 模型

沿用 `smartCompactSummaryModel`。spawn 前 `resolveBaseModelOrRefresh`。hook 里 `modelRegistry.find(provider, id)`；找不到 → 让出原生（与现在一致）。

不写 `~/.pi` 的 `summaryModel`。路由只在 worker 内存（spawn 命令字段）。

## 卸载第三方包

- `package.json` 去掉 `pi-smart-compact`
- `electron-builder.yml` 去掉对该包的 files 拷贝
- 删除 `src/types/pi-smart-compact.d.ts`
- `createSessionResourceLoader` 不再把包 factory 塞进 `extensionFactories`
- 不再调用 `persistEnsoSmartCompactSettings`

用户磁盘上已有的 `~/.pi/agent/settings.json` `smartCompact` 段：**不主动删**（避免动用户 Pi CLI）；Enso 也不再读它。

## 明确不做

- 不搬 extract 的探索/分段多通道、Kamradt chunking（第一期单通道）
- 不搬 SQLite graph、loops 管理器、damage、metrics、`/smart-compact`
- 不改子代理 compact
- 不热切换已开会话

## 风险

| 风险 | 处理 |
|------|------|
| hook 返回形与 Pi 版本不一致 | 对照当前 `@earendil-works/pi-coding-agent` 的 `session_before_compact` 类型；单测 mock `pi.on` |
| 摘要 LLM 慢 | 手动可等到模型返回；自动设硬超时（量级 60s）后让出 |
| 抽取漏指令 | 用户消息里的 ALL-CAPS / 「不要」「必须」进 Constraints；测 fixture |
| 旧包仍在 node_modules | 卸依赖后 lockfile 更新；CI typecheck 不得再解析该模块 |
