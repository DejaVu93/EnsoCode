# 实现清单

按 TDD 走。解析器跨模块，用 coworker 角色分离：tester 只写测试，红灯到手前不写实现。每刀 < 10 个用例；`wait` 带本刀 vitest 的 `gate`，以退出码验收。

类型扩展必须跟第一刀实现一起做（否则测试 import 新 `sourceId` 编不过），但读取器本体仍等红灯。

## 0. 不动的契约

- 不改 `SESSIONS_*` IPC、preload 签名、`writePiSession`
- 不改 Claude Code / Codex 解析
- 不读本机 `~`，一律注入 `home` / `storageRoot`
- 不导入 tool / thinking / 附件

验证基线（回归，每刀绿后顺手跑）：

```bash
pnpm exec vitest run src/main/services/sessionImport/sessionImport.test.ts
```

全量收尾：

```bash
pnpm typecheck && pnpm test && biome check src/main/services/sessionImport src/shared/types/sessionImport.ts src/renderer/components/chat/ImportSessionDialog.tsx
```

## 1. 编排与类型

- 扩 `ExternalSessionSource.sourceId`：`grok | cursor | pi | oh-my-pi | factory | opencode | gemini-cli`
- `index.ts` 用来源表驱动 `list` / `read` / `import`，空来源仍滤掉，未知 id 返回 `[]` / `null`
- 对话框文件头注释改成「本地 AI 应用」

tester 第一刀只锁编排：未知 id、空来源不出现。新读取器的快乐路径按后面切片补。

## 2. 按来源切片（每刀：红 → 绿 → 同命令再跑一遍为 0）

每刀测试覆盖：快乐路径列出+读文本；噪声/损坏不崩；项目过滤。

| 刀 | 文件 | fixture 要点 |
| --- | --- | --- |
| A | `grok.ts` | `{home}/.grok/sessions/{encodeURIComponent(cwd)}/{id}/chat_history.jsonl` + `summary.json`；抽 `<user_query>`；跳过 system/reasoning/synthetic |
| B | `cursor.ts` | `{home}/.cursor/projects/{strip-/ then /→-}/agent-transcripts/{id}/{id}.jsonl`；抽 `<user_query>` |
| C | `pi.ts` | `{home}/.pi/agent/sessions/**` 与 `{home}/.omp/agent/sessions/**` 共用解析；**按 header `cwd` 过滤**；非空 `title` 行 |
| D | `factory.ts` | 复用 `encodeClaudeProjectDir`；`session_start.title`；跳过 `<system-reminder>` |
| E | `opencode.ts` | 注入 `storageRoot`；`project.worktree` 对齐；path = session 元数据 json；拼 `part` 的 `type=text`；跳过 `parentID` |
| F | `gemini.ts` | `tmp/<slug>/chats/session-*.jsonl` 与 `tmp/<sha256>/chats/` 都能列；无 chats 不出现；跳过 `kind=subagent` |

实现者每刀只改对应读取器 + `index.ts` 注册，不改已绿测试。

## 3. 收尾

- 现有 Claude / Codex / `writePiSession` 用例仍绿
- typecheck / 全量 test / biome 干净
- 提交粒度：先 `feat: 扩展会话导入来源类型与编排`，再按来源各一次 `feat: 导入 Grok CLI 会话` …；或全部绿后按「类型+编排」与「各读取器」拆两次。不要和无关重构捆在一起。

## 回滚

各读取器独立。某来源挂了：从 `index.ts` 表里拿掉该行，该来源从对话框消失，其它来源不受影响。不要改 `writePiSession` 来迁就某一种输入。

## 审查点

- 空目录 / 坏 json / 未知 id 不抛
- OpenCode / Grok 的 `path` 在 list 与 read 之间一致
- Gemini 同时认 slug 与 sha256
- pi / oh-my-pi 不靠目录名过滤
- 没有把 tool / thinking 写进 `SimpleMessage`
- 没有新 IPC、没有读真实 `$HOME`
