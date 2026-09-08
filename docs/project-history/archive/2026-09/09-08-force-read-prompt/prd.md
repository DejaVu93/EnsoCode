# Force read/find：把拦截写进系统提示 Guidelines

## Goal

Force read/find（`bashInterceptEnabled`）打开后，模型仍大量先走 `cat/head/tail/less`，再被运行时打回 `Blocked: Use the 'read' tool instead of cat/head/tail/less.`。拦截本身有效，缺的是系统提示里的硬约束：模型在选工具之前就该知道「读文件用 read，不要用 shell」。

## Context

- 开关打开时，`withBashInterception` 只把 hint 追加到 bash/powershell 的 **description**。
- 普通 coding 会话走 pi 默认 system prompt：`Available tools` 来自 `promptSnippet`，`Guidelines` 来自各工具的 `promptGuidelines`。
- stock `read` 已有一条软提示：`Use read to examine files instead of cat or sed.`
- stock bash guideline 只有 `PI_*` 环境变量，不含「不要用 cat 读文件」。
- Enso 会话用自定义 `customPrompt`，本来就不装 bash，不在本任务范围。

## Requirements

- 打开 Force read/find 时，bash/powershell 除现有 description hint 外，还要带上 `promptGuidelines`，让默认 system prompt 的 Guidelines 出现明确禁令。
- guideline 必须点名工具（`read` / `grep` / `edit` / `write` / `find`），禁止写 “Use this tool when…”。
- 保留已有 `promptGuidelines`（例如 stock 的 `PI_*` 一条），追加而不是覆盖。
- 关闭开关时行为不变：不拦截、description 无 hint、无新增 guideline。
- 不改拦截规则（挡哪些命令、建议哪个工具）、不改开关默认值、不改设置文案。

## Out of scope

- Hashline read 高亮、Hashline edit 时间线 diff（独立问题，另开任务）。
- 不改 Enso 自定义 system prompt。
- 不改 `withBackground` 对 `promptSnippet` 的覆盖（Available tools 一行仍由 background 包装决定）。
- 不改拦截规则本身，也不把 background=true 绕过拦截纳入本轮（若要修，另开）。

## Acceptance Criteria

- [x] `withBashInterception` 包装后，`promptGuidelines` 含「不要用 cat/head/tail/less 读文件，改用 read」以及 grep/edit/write 的对应禁令。
- [x] 包装后仍保留工具原有 `promptGuidelines`。
- [x] 现有 description hint 断言保持绿色。
- [x] `checkBashInterception` 规则测试保持绿色。
