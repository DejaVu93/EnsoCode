# 本机核实过的会话落盘

实现以 `prd.md` / `design.md` 为准。这里只记 2026-09-08 在本机看到的真实形状，避免再猜。

## Grok CLI

`~/.grok/sessions/{encodeURIComponent(cwd)}/{uuid}/`

- `summary.json`：`session_summary`、`created_at`、`updated_at`、`info.cwd`
- `chat_history.jsonl`：`type=user|assistant|system|reasoning|tool_result`；user 常带 `<user_query>`；带 `synthetic_reason` 的 user 是技能/MCP 注入

## Cursor

`~/.cursor/projects/{path 去头斜杠后 /→-}/agent-transcripts/{id}/{id}.jsonl`

行：`{ role, message: { content: [{ type: 'text', text }] } }`。user 文本常包 `<timestamp>` + `<user_query>`。

例：`/Users/j3n5en/project/enso-code` → `Users-j3n5en-project-enso-code`。

## pi / oh-my-pi

- `~/.pi/agent/sessions/**/*.jsonl`（本机可为空）
- `~/.omp/agent/sessions/**/*.jsonl`

v3：`type=title`（可空）、`type=session`（`cwd` / `id`）、`type=message`（`message.role` + text parts）。
oh-my-pi 目录名是 `-project-billcom-web` 这类短名，**不能当 cwd**。

## Factory

`~/.factory/sessions/{encodeClaudeProjectDir}/{uuid}.jsonl`

首行 `session_start` 含 `title`、`cwd`。随后 `type=message`，形状接近 pi。user 常有 `<system-reminder>`。

## OpenCode

`~/.local/share/opencode/storage/`（darwin 本机不在 Application Support）

- `project/{id}.json`：`worktree`
- `session/{projectId}/{sessionId}.json`：`directory`、`title`、`time.updated`、可选 `parentID`
- `message/{sessionId}/{messageId}.json`：只有 `role`，没有正文
- `part/{messageId}/{partId}.json`：`type=text|tool|reasoning|step-*`

## Gemini CLI

官方文档：`~/.gemini/tmp/<project_hash>/chats/`，`project_hash = sha256(projectRoot)`。
本机 `~/.gemini/projects.json` 把绝对路径映到 slug（`bot2api`），`tmp/bot2api` 只有 `.project_root`，没有 `chats/`。
实现必须同时认 slug 与 sha256；没有 `session-*` 就不出现该来源。
文件前缀 `session-`，扩展名 `.jsonl` 或 `.json`；`kind=subagent` 跳过。

## 明确没有对话正文

CC Switch / Hermes / OpenClaw / EnsoAI：只有密钥或项目列表。
Alma / Cherry Studio：本机未装。
Antigravity `.pb` / Gemini `history/` 仅 `.project_root`：不纳入。
