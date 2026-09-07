# Hashline 行锚点 read/edit

## Goal

把 oh-my-pi 的 Hashline 协议抄进 Enso：开启时 `read`/`grep` 给出行锚点 + snapshot tag，`edit` 优先按行号改。**默认关**。开着也兼容原来的 `{path, edits:[{oldText,newText}]}`：没打开 Force read/find、模型用 `cat` 时仍能改文件。设置页可提一句建议一起开拦截（更多走 tag），不强绑。

## Why

pi edit 一次调用里所有 `edits[]` 对照同一份原文件精确匹配。模型一次塞多段时，后半段原文容易漂（空白、记错、按「改完再改」写 `oldText`），整次失败。Hashline 用 `[path#TAG]` + `PUT N.=M:` 锚定最近一次 read，从根上绕开这段对打。

## Requirements

- 设置页 Built-in tools 增加开关「Hashline edit」，紧贴 Force read/find tools。默认关。旧配置没有该字段视为关，不升 `SETTINGS_VERSION`。
-　开：新会话的 `read`/`grep`（文本、可编辑路径）输出带 `[path#TAG]` 与 `N:line`；成功的 hashline `edit`/`write` 也回写新 tag。`edit` **双模式**：带 tag 的 hashline 补丁（`PUT`/`CUT`/`MV`/`REM`、register、`N*`）走行锚；`{path, edits:[{oldText,newText}]}` 走现有 pi replace（含 `normalizeEditArguments`）。一次调用只走一种，不混拼。hashline 行号对 tagged 原快照。
- 关：read/grep/edit 保持现有 pi 行为与 prompt；已有会话不热切换。
- 开关沿用 bashIntercept 链路：settings store → persist → `spawn-parent` 布尔 → `parseAgentCommand` 白名单 → supervisor 选实现。缺省不传字段 = 关；仅 `true` 时下发。
- 文件在 read 之后被改：先走 snapshot 恢复；证不出唯一安全结果则拒，并让模型重新 read。不静默猜位置。
- 远程 / SSH 会话同样走该协议：snapshot 与 apply 经现有 `remoteOps.read` / `remoteOps.edit`。
- 时间线仍能展示 edit diff。Hashline 调用没有 `edits[].oldText`，不能只靠现有 `extractEdits`。
- 子代理 / coworker / readonly 子代理：写工具开时用 hashline edit；只读工具开时 read/grep 仍出锚点（方便父会话或后续写会话复用），但不暴露 hashline edit。
- 用户可见文案走 `t()` + `src/shared/i18n.ts`。

## Defaults

- **默认关。** 与现网 pi replace 兼容。
- 两个开关独立，**不自动联动、不因拦截关而关掉 replace 兼容**。Hashline 开、Force read/find 关：`edit` 仍吃 `oldText` 替换，`cat` 过的文件能改。设置页可提示「一起打开拦截，模型会更多走 tag、少踩 oldText」，不说「不一起开会拒」。
- hashline 形状（`input` 补丁 / `[PATH#TAG]`）按 hashline 校验：无 tag、瞎编 tag fail-closed，不降级成 replace。replace 形状（`path` + `edits[]`）按现有 pi 规则。

## Protocol scope（尽量对齐 OMP hashline，不是只抄 PUT 一行）

必须对齐（相对 `oh-my-pi/docs/tools/edit.md` + `@oh-my-pi/hashline`）：

- `[PATH#TAG]` 节、4 位大写 hex snapshot（全文件归一化内容指纹）
- `PUT N.=M:` / `PUT <N:` / `PUT >N:` / `PUT >$:` + `+TEXT` 体
- `CUT N.=M` / 匿名与具名 register / 跨节 paste
- `REM` / `MV DEST`
- 同 path 多节合并、重叠锚点拒绝、空 old / 无改动拒绝
- stale tag 恢复（能证明唯一映射才合并，否则 mismatch + 重读）
- `N*` 块锚点：host 注入 `BlockResolver`；有 natives 就解析，没有就拒并提示改用显式范围（不猜）

明确不抄：

- `ast_edit` + `xd://resolve|reject` 两阶段预览
- 万能 `read`（zip/sqlite/pdf/AST 折叠）
- LSP diagnostics / format-on-write
- constrained Lark 采样（`grammar.lark` 可作文档，不接解码器）
- OMP `eval` / `conflict://` / `artifact://`

## Constraints

- 不能 `npm` 直装 `@oh-my-pi/hashline`：它绑 `Bun.hash` / `Bun.file`、`@oh-my-pi/pi-natives`、`@oh-my-pi/pi-utils`。协议与 patcher 要进本仓库（vendor 或改写），hash / FS / LRU / line-diff / block-resolve 换成 Node / 现有依赖。
- 不把 tree-sitter 或 OMP natives 塞进 Electron ABI，除非另开任务证明值得。块锚点可先降级。
- 不改 pi stock `createEditToolDefinition` 本身；开关打开时换成我们的定义。
- `parseAgentCommand` 字段白名单必须同步，漏了会让全部会话起不来。
- 新增布尔走现有 persist，不新增 IPC 通道。
- 不改已有会话运行时；新开会话生效。
- 手机端 / pair：非目标（与 bashIntercept 一致，不投影该开关）。

## Acceptance Criteria

- [ ] 新用户与未写过该字段的旧 settings：Hashline 关；新会话仍是 stock `read` + `{path, edits:[{oldText,newText}]}`。
- [ ] 打开开关后新开会话：`read` 出现 `[path#TAG]` 与行号前缀，`edit` 接受 `PUT` 补丁并改盘。
- [ ] 打开时一次多段不重叠 `PUT` 对照同一快照成功；后一段按「改完后行号」写则失败并提示对照原快照。
- [ ] 仅 `cat`/`bash` 读过、无 snapshot：hashline 形状（无 tag / 瞎编 tag）拒绝不改盘；**replace 形状（`oldText`/`newText`）仍能改盘**（拦截关时的兼容路径）。
- [ ] `oldText` 对不上这类漂（空白 / 智能引号 / 记错原文）不再是失败主路径：模型只抄行号即可改中。
- [ ] 磁盘在 read 后被外部改到无法唯一 remap：edit 拒绝，不写错位。
- [ ] 无 BlockResolver 时 `PUT N*:` 拒绝并指导改用 `PUT N.=M:`；有 resolver 时块替换可用。
- [ ] `parseAgentCommand` 接受合法布尔、拒绝脏值；缺省字段合法且行为为关。
- [ ] Hashline 开且 Force read/find 关：设置页可出现「建议一起开拦截，更多走 tag」；不暗示 edit 会失败。不自动改另一开关。
- [ ] 时间线能显示 hashline edit 的 diff（或至少 unified patch），失败态能展开错误。
- [ ] config sync / Search Anything / 设置页文案覆盖该开关。
- [ ] 远程会话：hashline 开时经 `remoteOps` 读写，不在 guest 本机落目标文件。
- [ ] `pnpm typecheck && pnpm test` 绿。

## Notes

对照仓库：`/Users/j3n5en/project/oh-my-pi`（`packages/hashline`、`packages/coding-agent/src/edit/`、`docs/tools/edit.md`、`docs/tools/read.md`）。先前调研：`.trellis/tasks/archive/2026-09/09-04-omp-gap-research/research/tools.md` 把 Hashline 标成 P1。
