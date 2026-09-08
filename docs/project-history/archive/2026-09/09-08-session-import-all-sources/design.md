# 设计：多来源会话导入

## 行为差距

现在：导入对话框只扫 Claude Code / Codex。
应该：同一入口按当前项目列出 Grok / Cursor / pi / oh-my-pi / Factory / OpenCode / Gemini CLI 的会话，预览拉平文本，写入 pi v3 jsonl。

行为住在 `src/main/services/sessionImport/`。IPC / preload / 对话框分组已经按 `sourceId` + `sourceName` 工作，不新开通道。

## 边界

改：

- `src/shared/types/sessionImport.ts`：扩展 `sourceId` 联合类型
- `src/main/services/sessionImport/`：每个新来源一个读取器 + `index.ts` 编排
- `src/main/services/sessionImport/sessionImport.test.ts`：fixture 单测
- `ImportSessionDialog.tsx`：注释改成「本地 AI 应用」，文案仍走 i18n

不改：

- IPC 通道、preload 签名、`writePiSession` 契约
- Claude Code / Codex 解析行为
- provider / asset 扫描
- 工具调用、思维链、附件、跨项目整机扫描

## 编排

`listExternalSessions` / `readExternalSession` / `importExternalSession` 继续当唯一对外入口。

```
listExternalSessions(projectPath)
  → 各 list*(projectPath, home?)
  → 丢掉 sessions.length === 0 的来源

readExternalSession(sourceId, sessionPath)
  → 对应 read*(sessionPath) 的 messages

importExternalSession(...)
  → read* → writePiSession
```

`sourceId` 在 IPC 边界已是 `string`；未知 id 仍返回 `[]` / `null`。

建议来源顺序（稳定、与现网一致，新来源接在后面）：

1. `claude-code` / `codex`（保持）
2. `grok` — Grok CLI
3. `cursor` — Cursor
4. `pi` — pi
5. `oh-my-pi` — oh-my-pi
6. `factory` — Factory
7. `opencode` — OpenCode
8. `gemini-cli` — Gemini CLI

`home` 继续可注入（现有 Claude / Codex 模式），测试用临时目录，不读本机 `~`。

## 共享契约

`ExternalSession.path` 仍是「可读的绝对路径，作唯一标识」。对多文件存储（OpenCode / Grok），用**该会话的主元数据或正文文件**当 path，读取器再解析兄弟文件。

`SimpleMessage` 不变：只 `user` / `assistant` 文本。空文本、sidechain、tool、reasoning、`<system-reminder>` / `<user_info>` 等噪声一律丢掉。Cursor / Grok 用户正文常包在 `<user_query>`：抽出标签内文本，抽不到且整段以 `<` 开头则跳过（对齐 Codex）。

标题优先级：来源自带标题 → 首条 user 文本前 40 字 → `''`。

损坏行 / 缺文件 / 目录不存在：该来源返回空，不抛、不拖垮其它来源。

不做路径大小写归一（与现有 Codex `cwd === projectPath` 一致）。

## 各来源

### Grok CLI（`grok`）

盘：`{home}/.grok/sessions/{encodeURIComponent(projectPath)}/{id}/`

- 列表：该目录下每个子目录若存在 `chat_history.jsonl` 且解析后有消息
- path：`chat_history.jsonl` 绝对路径
- 标题：同目录 `summary.json` 的 `session_summary`，否则首条 user
- `updatedAt`：`summary.json.updated_at` 或文件 mtime
- 正文：jsonl 的 `type === 'user' | 'assistant'`；`content` 为 string 或 `{type:'text', text}[]`；跳过 `system` / `reasoning` / `tool_result` / 带 `synthetic_reason` 的行

### Cursor（`cursor`）

盘：`{home}/.cursor/projects/{encodeCursorProjectDir}/agent-transcripts/{id}/{id}.jsonl`

`encodeCursorProjectDir`：去掉开头的 `/`（Windows 再处理盘符），把剩余 `/` 换成 `-`。例：`/Users/j3n5en/project/enso-code` → `Users-j3n5en-project-enso-code`。

- path：该 jsonl
- 行：`{ role, message: { content: [{type:'text', text}] } }`
- 用户文本抽 `<user_query>`；无文本轮次跳过

### pi / oh-my-pi（`pi` / `oh-my-pi`）

盘：

- pi：`{home}/.pi/agent/sessions/**/*.jsonl`
- oh-my-pi：`{home}/.omp/agent/sessions/**/*.jsonl`

同一套 v3 解析器，根目录不同。目录名不可靠（oh-my-pi 本机是 `-project-billcom-web`），**必须读 header `type=session` 的 `cwd` 过滤项目**。

- 深度上限与 Codex 类似（≤ 4），文件上限 2000，按 mtime 截断
- path：jsonl 本身
- 标题：非空 `type=title.title`，否则首条 user
- 正文：`type=message` 且 `message.role` 为 user/assistant 的 text part；跳过 thinking / tool

即使源文件已是 pi v3，仍走拉平再 `writePiSession`，不原样复制（避免带入不可 replay 的 tool）。

### Factory（`factory`）

盘：`{home}/.factory/sessions/{encodeClaudeProjectDir(projectPath)}/{uuid}.jsonl`

编码与 Claude Code 相同（`encodeClaudeProjectDir` 已导出，直接复用）。

- 标题：`session_start.title`（忽略空的 `New Session` 时可回退首条 user）
- 正文：`type=message` 的 text part；user 且 `/^<[a-z-]+/` 的噪声跳过（与 Claude 一致）

### OpenCode（`opencode`）

盘：`{home}/.local/share/opencode/storage/`（若 `XDG_DATA_HOME` 有值则 `{XDG_DATA_HOME}/opencode/storage`，测试可注入 `storageRoot`）

结构：

```
project/{projectId}.json          { id, worktree }
session/{projectId}/{sessionId}.json   { id, directory, title, time.updated, parentID? }
message/{sessionId}/{messageId}.json   { id, role, time? }
part/{messageId}/{partId}.json         { type, text?, tool? }
```

- 列表：`project/*.json` 里 `worktree === projectPath`，再列对应 `session/{id}/*.json`
- 跳过有 `parentID` 的子会话（与 Gemini 跳过 subagent 同类：导入父对话即可）
- path：session 元数据 json 的绝对路径（读取器由此解析 `id`，再读 message/part）
- 标题：`title`
- `updatedAt`：`time.updated`
- 正文：按 message 时间排序；只收 `role=user|assistant`；每个 message 拼接其 `part` 里 `type=text` 的 `text`

### Gemini CLI（`gemini-cli`）

官方：`{home}/.gemini/tmp/<project_hash>/chats/session-*.jsonl`（也认 `.json`）。
`getProjectHash(root) = sha256(root)`。
本机新版本用 `~/.gemini/projects.json` 把路径映到可读 slug（`/Users/.../bot2api` → `bot2api`），`tmp/bot2api` 即该 slug。

列表时对每个 identifier 探一次 `tmp/<id>/chats/`，去重后合并：

1. `projects.json` 里该 `projectPath` 的 slug
2. `sha256(projectPath)` 的 hex

文件名：`session-` 前缀 + `.jsonl` / `.json`。
元数据 `kind === 'subagent'` 或 `hasResumableContent === false` 时跳过。
JSONL：逐行对象；消息行有 `type: 'user'|'assistant'` 与 `content`（string 或 text parts）。整文件 JSON：`{ sessionId, messages, kind, firstUserMessage, startTime, lastUpdated }`。
标题：`firstUserMessage` 或 `summary` 或首条 user。
本机只有 `.project_root`、没有 `chats/session-*` 时该来源直接消失。

## 文件形状

```
sessionImport/
  helpers.ts          可选：parseLine / textOfTextParts / unwrapUserQuery（只给新来源用）
  claudeCode.ts       不动行为
  codex.ts            不动行为
  grok.ts
  cursor.ts
  pi.ts               list/read pi + oh-my-pi 共用解析，两个 list 入口
  factory.ts
  opencode.ts
  gemini.ts
  piJsonl.ts          不动
  index.ts            注册表
  sessionImport.test.ts
```

`helpers.ts` 三次以上才抽。不要为了共用去改 Claude / Codex。

## 测试

同目录 `sessionImport.test.ts`，临时目录 fixture，中文场景名。每个新来源至少：

1. 快乐路径：列出 → 标题 / 消息数对 → `read` 文本轮次对
2. 噪声与损坏：系统标签、reasoning/tool、坏 json、缺文件 → 空或不崩
3. 项目过滤：别的 cwd / 别的编码目录不出现
4. Gemini 特有：无 `chats/` 不出现；slug 与 sha256 两种 identifier 都能列到

编排层补：未知 `sourceId` 返回空；空来源不进 `listExternalSessions`。

TDD：解析器类、跨模块，用 coworker 角色分离。每刀 < 10 个用例。红灯到手前不写实现。

## 渲染层

对话框已按 `source.sourceName` 分组。只需改文件头注释。来源显示名由 main 给英文专有名词（与现有 Claude Code / Codex 一致），不必进 i18n 表。

## 风险

- OpenCode / Gemini 无单一 jsonl：path 约定必须在 read 与 list 之间一致，测试锁住。
- Gemini 目录标识演进：同时认 slug 与 sha256，避免只跟文档或只跟本机。
- pi 目录名不等于 cwd：只信 header。
- 大目录（Codex / pi 全局扫）：沿用深度与文件上限，避免一次导入卡死。
