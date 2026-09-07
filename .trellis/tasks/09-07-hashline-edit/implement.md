# Implement: Hashline read/edit

逻辑面大、跨模块，按切片 TDD。tester coworker 一刀一停；红灯前不写实现。

## Slice 0 — 开关链路（可与 hashline 核心并行）

纯字段，inline 即可（用例 < 10）。

1. settings store 默认 `false`，setter；Built-in tools 开关紧贴 Force read/find；Hashline 开且拦截关时可提示一起开（更多走 tag，不说会拒）。
2. `parseAgentCommand` 白名单 + 脏值测试（对照 `bashInterceptEnabled`，断言缺省=关）。
3. agentHost：仅 `true` 时下发。
4. supervisor：参数默认 `false`，先接到一个布尔，暂不换工具（slice 3 再接）。
5. configSync allowlist / portable + preferences 测试。
6. searchAnything `tools.hashlineEditEnabled`。
7. settings ipc allowlist。

验证：`pnpm exec vitest run src/shared/types/agent.test.ts src/main/services/configSync/preferences.test.ts src/shared/searchAnything.test.ts`

## Slice 1 — hashline 纯核心（vendor 改写）

`src/agent/hashline/`：format（tag）、parser、apply、snapshots、patcher（内存 FS）、recovery fail-closed。

tester 先写（每刀 < 10 例）：

- tag：同行尾空白 / CRLF 归一后稳定；内容变则变。
- `PUT 1.=1:` 内存文件替换。
- 同调用两段不重叠 PUT，行号对原快照。
- 后一段按改完后文本当锚 → 失败。
- stale tag + 无法唯一 remap → 不写。
- `N*` 无 resolver → 明确错误。

gate 示例：`pnpm exec vitest run src/agent/hashline/*.test.ts`

实现者只改 `src/agent/hashline/**`，不动测试。

## Slice 2 — read/grep wrap + snapshot store

`src/agent/hashline/fileSnapshotStore.ts`、`withHashlineRead`、`withHashlineGrep`。

- 文本 read 成功 → record + 改写模型可见输出。
- 大文件 / 图片 / `agent://` 不打 tag。
- path 规范化。

测 wrap 用假 stock tool，不断 pi 内部。

## Slice 3 — edit 工具定义 + supervisor 接线

`src/agent/hashline/editTool.ts`：宽松 schema + 运行时分流。`edits[]` / 遗留 oldText → `createNormalizedEditTool`；`input` 补丁 → Patcher。两者都有则拒。

tester：replace 形状仍改盘；hashline 无 tag 拒；混拼拒。

supervisor：`hashlineEditEnabled === true` 时

- read/grep 走 wrap
- edit 走 hashline 定义，仍 `scoped('file-edit', ...)`
- 否则现有路径

测：supervisor 或小工厂「开/关各挂哪套」；edit 对临时文件走一轮 PUT。

远程：Filesystem 适配 `remoteOps`；无远程夹具则单测适配器入参。

## Slice 4 — 时间线 / Changes

`extractEdits` 或并列 `extractHashlineDiff`：从 details.diff/patch 出可渲数据。  
`EditDiff` / `sessionChanges`：无 `edits[]` 时用 patch 或 details 快照。  
现有 `edits[]` 会话不得回退。

## Slice 5 — prompt + 产品面收口

- hashline edit/read/grep promptGuidelines
- productCapabilityCoverage fixture
- biome / typecheck

## Validation

```bash
pnpm typecheck && pnpm test && pnpm exec biome check src/agent/hashline src/agent/editTool.ts src/agent/supervisor.ts src/renderer/stores/settings src/shared/types/agent.ts
```

手工：开 Hashline、关拦截 — `read`+`PUT` 与 `cat`+`oldText` 都能改；关 Hashline 后新会话只有 replace。

## Rollback

设置关 + 新会话。slice 1–2 可独立留在仓库不接线。

## Review gates

- 默认关是否真的「缺字段=关、只传 true」
- 双模式：replace 不要求 tag；hashline 形状 fail-closed；一次一种
- 工具名未改、审批/writeScope 未绕过
- 没引入 Bun / OMP natives
- 没抄 ast_edit / 万能 read
