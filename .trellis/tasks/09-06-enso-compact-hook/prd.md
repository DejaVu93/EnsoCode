# Replace pi-smart-compact with Enso compact hook

## Goal

设置里打开「验证式智能压缩」后，父会话的 `/compact` 与自动 compact 走 **Enso 自己的** `session_before_compact` 摘要（确定性抽取 + 单轮合成），apply 仍由 Pi `session.compact()` 完成。卸掉 `pi-smart-compact`。失败回退原生 compact。

## Requirements

- 保留现有开关、摘要模型、档位（Fast / Balanced / Thorough / Auto）。默认关；改设置只影响之后新 spawn / 重启后的父会话。
- 打开后仅父会话挂 Enso compact hook；子代理 / coworker / Enso locked 仍 `noExtensions`。
- hook **不注册任何工具**（无 `smart_recall` / `smart_save_memory` / `smart_compact`），不写 `~/.pi/agent/settings.json`。
- 摘要内容至少保住：用户硬约束、当前目标、未完成项、错误、改过/读过的关键路径。结构稳定，时间线仍凭 `fromHook` 标「验证式压缩完成」。
- 手动 `/compact`：**不要**因「省不够 10%」或档位目标窗口让出原生。档位只影响留多长尾巴、摘要多细。
- 自动 compact：超时 / 模型找不到 / 合成失败 / 会话过短（几乎无前缀）→ 让出原生；不卡会话、不丢消息。
- 不新增 slash 命令；不做 loops、context graph、跨会话记忆、metrics dashboard、TUI 审批。
- 从依赖与打包中移除 `pi-smart-compact`（`package.json` / lockfile / `electron-builder.yml` 拷贝 / `src/types/pi-smart-compact.d.ts` / `persistEnsoSmartCompactSettings`）。
- UI 文案改为「Enso 验证式压缩」，不再暗示第三方包。i18n 中英同步。

## Constraints

- 不整仓 fork EESV，不把 `pi-smart-compact` 源码搬进仓库再删。只复用 compact 核：抽取字段、成对工具、留尾巴、失败回退。
- 不自己改 session 消息树；只在 `session_before_compact` 交摘要。
- 设置仍走现有 `settings.json` / zustand persist；不必单为文案升 `SETTINGS_VERSION`。
- `spawn-parent` 已有 `smartCompactEnabled` / `smartCompactSummaryModel` / `smartCompactMode` 白名单保持兼容。
- worker 只准 import `@shared` 与 pi sdk；摘要 LLM 走会话已解析的模型 registry，不另开 IPC。

## Acceptance Criteria

- [ ] 开关关：父会话不挂 compact hook，`/compact` 与现在原生一致。
- [ ] 开关开：新父会话能交出 `fromHook: true` 的摘要；时间线标验证式。手动 compact 不因 10% 收益闸让出。
- [ ] hook 可见工具集不含 `smart_recall` / `smart_save_memory` / `smart_compact`。
- [ ] spawn 父会话不再 merge / 写 `~/.pi/agent/settings.json` 的 `smartCompact` 段。
- [ ] 产物与运行时不再 `require` / `import` `pi-smart-compact`。
- [ ] 合成失败或超时：原生 compact，会话可继续。
- [ ] 子会话 / locked 不加载该 hook。
- [ ] 协议脏输入仍被 `parseAgentCommand` 拒绝；合法字段通过。
- [ ] 抽取 + 摘要拼装的纯函数有 Red-Green 单测；全量相关测试绿。

## Notes

- 旧任务 `09-06-smart-compact-switch` 的「挂第三方包」约束被本任务推翻；实现时先卸包再接线，不要两套 hook 并存。
- 旧任务可在本任务合入后 archive，不在本期改它的文档。
