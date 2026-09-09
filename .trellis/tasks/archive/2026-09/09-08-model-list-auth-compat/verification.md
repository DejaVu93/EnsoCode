# 模型目录获取验收

## Scope
独立修复模型列表获取。产品代码仅 providerApi.ts/providerApi.test.ts；services spec 补充有限鉴权回退契约。未修改聊天鉴权、renderer、IPC、模型持久化结构。

## Base
已 fetch origin/dev 与 upstream/dev，并将当前分支 fast-forward 到 upstream/dev `d3ecc796`。保留上游 Chromium net.fetch 与代理初始化等待逻辑，解决测试文件合并冲突，保留上游测试。依赖以 frozen lockfile 安装到本 worktree，未修改主目录依赖。

## TDD
Gemini 按小切片先红后绿：官方 host 判定导出、模型响应结构校验、第三方401回退、目录重定向限制。实质行为红灯包括：401只有一次请求、错误结构被误报成功、目录请求缺少redirect限制；随后实现转绿。Grok复核后补充相似域名、官方/v1、429/500/AbortError、回退坏响应和Google/Ollama兼容测试。

## Automated
- providerApi.test.ts：46 tests passed。
- providerApi + modelEntry.merge focused gate passed。
- pnpm typecheck passed。
- pnpm test：301 files / 2955 tests passed；1 file / 4 tests skipped。
- pnpm lint passed。
- pnpm build passed。
- 旧base上的6个agent测试失败及3处格式问题在更新dev后不再出现，最终验收使用最新dev结果。

## Real Electron integration
使用新build启动Electron 43，隔离userData与独立CDP端口；通过renderer的electronAPI.providers.listModels触发真实preload→IPC→Chromium net.fetch→本地模拟HTTP网关，不使用真实凭证、不请求付费推理。

| 场景 | 可观测结果 |
|---|---|
| 第三方401→Bearer200 | 两次同URL请求；第一请求只有x-api-key，第二只有Bearer；成功返回qa-model/contextWindow200000 |
| 回退200错误结构 | 返回ok:false和Invalid model list response format |
| 403 | 一次请求，返回失败，无Bearer重试 |
| 302重定向 | Electron返回Redirect was cancelled；网关日志无Location目标请求，不泄露凭证到第二跳 |

renderer失败不合并/空目录不删除旧模型复用既有代码与modelEntry.merge测试。没有把目录成功宣称为模型推理成功。

## Review
Grok完成旧base初审、新base复审；实现边界和补全回归均符合PRD。真实Chromium重定向验证补足mock无法证明的安全属性。
