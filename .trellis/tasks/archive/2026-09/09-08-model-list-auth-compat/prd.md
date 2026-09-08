# 第三方 Anthropic 模型列表获取兼容修复

## Goal
修复第三方服务支持 Anthropic 消息协议、但模型目录要求 Bearer 时，拉取模型返回 401 的问题。仅处理模型获取，不修改聊天请求。

## Evidence
- anyrouter `/v1/models` 此前实测：`x-api-key` 返回 401 未提供令牌；Bearer 返回 200/15 个模型。真实密钥不得写入任务、测试或日志。
- `src/main/services/providerApi.ts`：listModels 当前按消息 API 类型固定鉴权，非 2xx 直接失败；成功 JSON 缺乏目录结构校验。
- `src/renderer/components/settings/ProviderApiForm.tsx`、`LocalImportDialog.tsx` 在 result.ok=false 时不更新模型；`src/shared/modelEntry.ts` 合并保留旧条目。无需修改 UI/IPC。
- Gemini 侦察及 Grok 规划审查确认最小改动为 providerApi.ts + 测试。

## Requirements
R1. 仅第三方 Anthropic 模型列表首次 HTTP 401 时，允许同一完整 URL 再请求一次；使用 Bearer 替换 x-api-key，保留 anthropic-version。不得发第三次。
R2. 用 URL hostname 精确识别 api.anthropic.com；官方包括默认空 baseUrl、带 /v1 路径均不回退。其他协议不新增鉴权回退。
R3. 403/429/5xx/其他非401状态、网络异常和超时不触发鉴权回退。
R4. listModels 请求禁止自动跟随重定向，避免 x-api-key 或 URL 中的 key 泄露；不改共享 request 默认行为以免扩大到消息接口。
R5. 模型列表响应必须是对象且含该协议要求的数组（Anthropic/OpenAI data、Google/Ollama models）；坏 JSON/HTML/错误结构返回失败。合法空数组可成功，不清除旧模型。
R6. 失败保留本地已有模型与用户覆盖；错误不得泄漏密钥或直接展示未脱敏的服务端响应体。
R7. 本轮保留现有每次请求超时与合并策略，不增加自动后台拉取、模型可用性探测或额外配置项。

## Acceptance
- 第三方 401→200：恰好两次 fetch，URL 相同，第二次只有 Bearer 鉴权，模型正确解析。
- 官方 401 一次结束；相似但不同 hostname 不误识别官方。
- 非401/网络错误/超时不回退；401→401 两次结束。
- 标准请求与回退请求均禁止 follow 重定向；3xx失败。
- 200错误结构/HTML/非法JSON失败，合法空列表保留原模型，其他协议正常数组不回归。
- 带 modelId 的 testProvider messages仍只发原有 x-api-key，不因401重试或改Bearer。
- 纯逻辑改动遵守先写测试并确认缺功能失败，再实现；全量typecheck/test和Biome检查通过。

## Scope / exclusions
只改模型列表服务与回归测试。明确不改：messages鉴权/聊天runtime、模型ID规范化、provider持久化配置、renderer/IPC、静态目录兜底、分页和高级目录配置。本轮不承诺任意网关均兼容。

## Status
用户已批准执行，并要求将模型获取作为独立修复提交。
