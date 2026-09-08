# 扩展会话导入到所有已支持 provider 扫描的来源

## Goal

在现有「导入会话」对话框里，把本机其他 AI 应用的项目会话拉平成可 resume 的 EnsoCode 对话。凡是已经能扫到、且磁盘上有项目级会话记录的来源，都应出现在同一入口，而不是只支持 Claude Code / Codex。

## Background

现有导入只接两个来源（`src/main/services/sessionImport/index.ts`）：

- Claude Code：`~/.claude/projects/{encodeClaudeProjectDir}/` 下的 `.jsonl`
- Codex：`~/.codex/sessions/**/rollout-*.jsonl`，用首行 `session_meta.payload.cwd` 过滤项目

导入契约已经稳定：列表 → 预览拉平文本 → `writePiSession` 写成 pi SessionManager v3 jsonl。`SimpleMessage` 只保留 `user` / `assistant` 文本，工具调用不进预览、不进 resume 文件。

用户点名的来源：pi、oh-my-pi、Cursor；同时要求「能导入 provider 的应用也应能导入会话」。范围确认后纳入 MVP 的还有 Grok CLI、Factory、OpenCode、Gemini CLI。

### 已确认的来源盘

| 来源 | 现有扫描 | 本机会话落盘 | MVP |
| --- | --- | --- | --- |
| Claude Code | provider + asset + 会话 | `~/.claude/projects/{encoded}/*.jsonl` | 保持 |
| Codex | provider + 会话 | `~/.codex/sessions/**/rollout-*.jsonl` | 保持 |
| Grok CLI | provider + recentProjects | `~/.grok/sessions/{urlencode(cwd)}/{id}/chat_history.jsonl` + `summary.json` | 纳入 |
| Cursor | provider + asset | `~/.cursor/projects/{path-/→-}/agent-transcripts/{id}/{id}.jsonl` | 纳入 |
| pi | 未进 SCAN_APP | `~/.pi/agent/sessions/**/*.jsonl`（v3，header 含 `cwd`） | 纳入 |
| oh-my-pi | 未进 SCAN_APP | `~/.omp/agent/sessions/**/*.jsonl`（同 v3，另有 `title` 行） | 纳入 |
| Factory | asset | `~/.factory/sessions/{claude-style-encoded}/{uuid}.jsonl` | 纳入 |
| OpenCode | asset | `~/.local/share/opencode/storage/{project,session,message,part}` | 纳入 |
| Gemini CLI | asset | 官方：`~/.gemini/tmp/<sha256(cwd)>/chats/session-*.jsonl`；本机可能为空 | 纳入（空则不出现） |
| CC Switch / Hermes / OpenClaw / EnsoAI | provider 或 asset | 无对话正文 | 不纳入 |
| Alma / Cherry Studio | provider | 本机未装，格式未核实 | 不纳入 |

`SCAN_APP_IDS` 与「磁盘上真有会话」不是同一集合。若干 provider 扫描目标只存密钥，没有对话。

### 解析提示（实现时用，不改现有拉平契约）

- Grok：只收 `type=user|assistant`；跳过 `system` / `reasoning` / `tool_result` / `synthetic_reason`；用户正文常包在 `<user_query>`；标题读同目录 `summary.json.session_summary`。
- Cursor：`role` + `message.content[].text`；用户正文常包在 `<user_query>`；跳过无文本轮次。
- pi / oh-my-pi：读 `type=message` 的 text part；标题优先非空 `type=title`，否则首条 user；**按 header `cwd` 过滤项目**，不要赌目录名编码。
- Factory：`session_start.title` + `message` 的 text part；跳过 `<system-reminder>` / tool_use / tool_result。
- OpenCode：`session.directory`（或 `project.worktree`）对齐项目；正文在 `storage/part/<messageId>/` 的 `type=text`，不在 `message/*.json` 本身。
- Gemini CLI：`~/.gemini/tmp/<sha256(projectPath)>/chats/session-*.jsonl`（官方也认 `.json`）；跳过 `kind=subagent`；消息 `type=user|assistant` 的文本 part。本机无 chats 时该来源直接滤掉。

## Requirements

- 导入入口、预览与写入路径沿用现有对话框 / IPC / `writePiSession`，不新开第二种导入 UX。
- `ExternalSessionSource.sourceId` 扩展为新来源联合类型；无会话的来源不出现在列表里（与现在「空来源直接滤掉」一致）。
- 每个新来源：按当前项目路径列出会话，损坏行 / 缺文件不崩，空文本与系统噪声不进 `SimpleMessage`。
- 导入结果仍是可 resume 的 pi v3 jsonl + 标题 + 消息数。
- 解析器用临时目录 fixture 单测，不读本机 `~/.grok` 等真实目录。

## Acceptance Criteria

- [ ] Grok / Cursor / pi / oh-my-pi / Factory / OpenCode / Gemini 各自在对应该项目的 fixture 下能列出、预览、导入出非空文本轮次。
- [ ] Gemini 目录不存在或只有 `.project_root`、没有 `chats/session-*` 时，不出现该来源、不抛错。
- [ ] 未知 `sourceId`、损坏 jsonl、无消息文件仍返回空列表 / 空消息，不抛错。
- [ ] 现有 Claude Code / Codex 行为与测试不被破坏。
- [ ] 对话框按来源分组展示新来源名称（pi、oh-my-pi、Grok CLI、Cursor、Factory、OpenCode、Gemini CLI）。

## Out of Scope

- 导入工具调用、思维链、MCP 事件、附件或可继续执行的 tool 状态。
- 为没有会话存储的 provider 应用（CC Switch / Hermes / OpenClaw / EnsoAI）伪造空分组。
- Alma / Cherry Studio（本机未装，格式未核实）。
- Antigravity 的 `.pb` 会话、Gemini `history/` 里仅有 `.project_root` 的目录。
- 改 provider / asset 扫描本身。
- 跨项目「扫整机全部会话」。
- 导入 EnsoCode 自己的 `userData/agent/sessions`（已是原生会话）。
- 把 pi / oh-my-pi 源文件原样复制（即使它们已是 v3 jsonl，仍走拉平契约，避免带入不可 replay 的 tool）。
