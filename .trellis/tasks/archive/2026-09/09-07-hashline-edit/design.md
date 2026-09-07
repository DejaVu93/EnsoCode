# Design: Hashline read/edit

## Behavior gap

现在：`read` 吐纯文本（可带行号），`edit` 是 pi search-replace，多段对照原文件精确匹配。  
应该：开关开时同一会话里 read/grep 记账 snapshot，edit 只吃 hashline 补丁；关则完全回到现在。

行为住在 **agent worker 工具层**（`src/agent/`），不是渲染层拦截。设置只决定 spawn 时选哪套定义。

## Switch chain（与 bashIntercept 同极性：默认关）

```
BuiltinToolsSettings Switch
  → settings.hashlineEditEnabled (zustand persist, default false)
  → settings.json
  → agentHost.readSettingsState()
  → spawn-parent { hashlineEditEnabled?: boolean }
     仅当 **true** 时下发 { hashlineEditEnabled: true }
     缺省 / false 不传 → supervisor 默认关
  → parseAgentCommand 白名单
  → supervisor.spawn(..., hashlineEditEnabled = false)
```

与 bashIntercept 一样：`=== true` 才开。两个字段独立，不因打开一个就改另一个。

必改字段清单（漏一处会静默丢开关或拒掉全部 spawn）：

- `src/renderer/stores/settings/types.ts` / `index.ts`
- `src/main/ipc/settings.ts` allowlist
- `src/main/services/configSync/{index,types,codec,merge}.ts` + preferences 测试
- `src/shared/types/agent.ts` spawn-parent + `parseAgentCommand` + 测试
- `src/main/services/agentHost.ts`
- `src/agent/supervisor.ts`
- `src/shared/searchAnything.ts` + 测试
- `src/shared/i18n.ts`
- `src/tooling/productCapabilityCoverage.fixture.ts`（与 exploreFold / bashIntercept 一样标 excluded 或列入权威源）

不新增 IPC。不升 `SETTINGS_VERSION`：缺字段 = 关。

设置页：Hashline 行放在 Force read/find 旁。`hashlineEditEnabled && !bashInterceptEnabled` 时可提示一起开拦截（更多走 tag）；**不说 edit 会失败**。不自动 flip。

## Tool surface

开关开时 supervisor 不挂 `createNormalizedEditTool` / 裸 `createReadToolDefinition` / stock grep，改挂：

| 工具名 | 对模型 | 实现 |
| --- | --- | --- |
| `read` | 仍叫 `read` | wrap stock read：文本成功后记 snapshot、改写输出为 `[path#TAG]` + `N:line` |
| `grep` | 仍叫 `grep` | wrap stock grep：按文件记 snapshot（≤ 4MiB）、文件头带 `#TAG` |
| `edit` | 仍叫 `edit` | 双模式：hashline `{ input }` **或** pi `{ path, edits[] }`，一次一种 |

名字不变，避免 Cursor bridge / 审批 kind / writeScope / checkpoint 再分一套。  
`withApproval(..., 'file-edit')`、`withWriteScope`、`withCheckpoint`、`remoteOps.edit` 继续包在外。

关：现有 `createNormalizedEditTool` + stock read/grep，零 hashline 代码路径。

## Bash / `cat` 不记账

Snapshot 只来自 hashline 的 `read` / `grep` / 成功的 `edit` / `write`。`bash` 的 `cat`/`head`/`git show` 不进 store。

hashline **形状** fail-closed（无 tag / 瞎编 tag 不写盘，叫 `read`）。不从 bash 输出补记账。

**replace 兼容（拦截关也能改）：** 入参是 `{ path, edits:[{oldText,newText}] }`（含 JSON 字符串等已归一化形态）→ 交给现有 `createNormalizedEditTool`，不要求 snapshot。`cat` 再 `oldText` edit 与今天一样。

分派（`prepareArguments` / execute 入口）：
1. 有非空 `edits` 或遗留 `oldText`+`newText` → replace
2. 有 `input` 字符串（或能 parse 成 hashline 的单字段补丁）→ hashline
3. 两者都有 → 拒，提示一次一种
4. 都不像 → 拒，列出两种形状

schema 用宽松对象 + 运行时分流，不要 TypeBox 互斥到模型发 replace 就被挡。prompt：优先抄 `[path#TAG]` 走 `input`；没有 tag 再用 `edits[]`。

## Snapshot

每托管会话一个 `InMemorySnapshotStore`（session 对象上懒建，随会话死）。

- tag = 全文件归一化文本的 4 hex（去行尾 `[ \t\r]`，与 OMP `computeFileHash` 同语义）。实现用 Node 侧稳定 32-bit hash（如 `xxhash-wasm` 或纯 TS xxHash32），**禁止 `Bun.hash`**。
- 路径键走 `realpath`，与 OMP `canonicalSnapshotKey` 同：macOS `/tmp` vs `/private/tmp`、symlink 不得拆成两个 tag。
- 超过 4MiB 不打 tag，read 保持现有截断输出，edit 不得假装能锚。
- 同一 path 连续同内容 read 合并；共享行不一致视为盘变了，发新 tag。
- 远程：`record` 用 `remoteOps.read` 读到的文本，不读 guest 本地同名路径。

## Hashline core（vendor，不 npm）

从 `/Users/j3n5en/project/oh-my-pi/packages/hashline` 搬协议，落在 `src/agent/hashline/`：

```
parser / apply / patcher / recovery / snapshots / clipboard / messages / format
```

替换点：

| OMP | Enso |
| --- | --- |
| `Bun.hash.xxHash32` | Node xxHash32（同语义测过） |
| `Bun.file` / `Bun.write` NodeFilesystem | `node:fs/promises`；远程再套一层 `remoteOps` |
| `@oh-my-pi/pi-utils` LRU | 本仓库小 FIFO / Map |
| `diffLineRuns`（recovery） | JS 行 diff（`diff` 包已在 pi edit-diff；或最小 Myers）。恢复质量可略差，失败必须 fail-closed |
| `nodeChainAt` / `blockRangeAt` | 可选 `BlockResolver`；首版可恒 `null`（`N*` 拒） |
| `syntax.ts` 边界修复 | 无 natives 时只做文本归一，不做树修复 |

保持对外补丁语法与 OMP `prompt.md` / `docs/tools/edit.md` 一致，便于模型已有记忆。

`Filesystem` 抽象留下：本地 `NodeFilesystem`，远程实现 `readText`/`writeText`/`exists`/`delete`/`move` 调 `remoteOps`。

## read / grep wrap

- 只改**模型可见** `content`；TUI/时间线可用未加前缀文本（OMP 的 `displayContent`）。聊天里现有 `ReadFileView` 若被行前缀弄乱，渲染侧剥 `N:` / 头，或走 details。
- 图片 / 目录 / 不可编辑虚拟路径：不打可写 tag。
- `withAgentRead`（`agent://`）仍在最外；hashline wrap 在 stock read 与 `withAgentRead` 之间，避免给虚拟 agent 输出打锚。

## edit execute

1. parse `input`（可带或不带 `*** Begin Patch`）
2. `Patcher.prepare`：语法、tag、重叠、可见行、无改动 — 全部失败则不写盘
3. 按节 commit；OS 写失败可以留下已落地前缀（与 OMP 相同，写进 prompt）
4. 成功：新 `[path#TAG]`、可选 preview、`details: { diff, patch, firstChangedLine }`
5. 失败：`ToolError` 文本含失败节、tag、指导重 read；不要只说 `oldText must match exactly`

审批：hashline 预览用 `details.diff` / unified patch，不要从 `edits[]` 拼。

## Timeline / Changes

现 `extractEdits` 只认 `{oldText,newText}`。开 hashline 后：

- 优先 `toolResult.details.diff` 或 `details.patch`
- 否则从成功结果文本里的 preview 退化
- `sessionChanges.reconstructOld` 对 hashline 不适用：Changes 侧栏用磁盘 + patch，或存 `oldText`/`newText` 快照到 details

失败的 edit 仍以 `state: 'error'` + output 展示。

## Prompt

开：hashline 语法 + 「有 tag 用 `input`；无 tag 用 `edits[]`，勿编造 tag」。read/grep 仍出锚点。  
关：一字不改现有 snippet。

不做 per-model 排除表。

## Child / readonly

- `tools === 'readonly'`：hashline wrap 的 read/grep，无 edit。
- 写子代理：与父同一开关（spawn 时从父/全局 settings 传入，不单独设）。
- locked Enso 子代理：不换工具。

## Risks

- **vendor 体积**：hashline 包大、测试多。只搬运行时 + 我们自己的 vitest 契约（parse/apply/tag/recovery fail-closed），不搬 bun test 全家桶。
- **弱模型**：语法比 `{oldText,newText}` 陡。默认开；关是逃生舱。观察后再考虑按模型回退。
- **hash 碰撞**：4 hex 是 OMP 语义，不是密码学。会话内 path+tag 查找；碰撞当 stale。
- **Electron / Cursor**：工具名不变；参数 schema 变。Cursor native `writeArgs` 仍映射 pi MCP edit — 开 hashline 时 Cursor 原生 write 对不上，保持现状（本任务不修 Cursor 原生帧）。

## Compatibility / rollback

- 关开关 + 新会话 = 全回滚。
- settings 字段可随配置同步 portable。
- 不迁移历史 tool 参数；旧会话时间线仍按 `edits[]` 渲。

## Out of scope（再次收口）

万能 read、ast_edit、LSP、Lark 约束解码、pair 投影、已有会话热切换、把 `@oh-my-pi/pi-natives` 编进 Electron。
