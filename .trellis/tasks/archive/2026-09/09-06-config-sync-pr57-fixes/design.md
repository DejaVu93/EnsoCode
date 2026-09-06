# Design：config-sync 审查修复

## 指纹与事务

- `settingsFingerprint` 改为对 `enso-settings.state` 的 `SYNC_FIELDS` 做稳定序列化（字段排序、structured clone 可比较值）。
- `commitSettingsTransaction(expected, patch)`：
  1. 用同一指纹函数比当前 cache；
  2. `flushSettings`；
  3. 再读 latest，**只把 patch 中属于 `SYNC_FIELDS` 的键**写入 `enso-settings.state`；
  4. 其余顶层 store 与 excluded 字段原样保留 latest。
- import `commitImportForSender` 在组 patch 时只拷 `SYNC_FIELDS` + staged 路径，不再 `{ ...plan.state }`。

## MCP env

- 匹配成功：本机 `env` 优先；包内 env 与本机不等时 **不覆盖**，并 `enabled=false` + warning（或直接 throw identity conflict——实现取「禁用 + warning」，避免整包导入失败）。
- `normalizedMcpIdentity` 仍可比 command/args/url；env 单独处理。

## 导出 skill 容错

- disabled skill：不收集 resource；state 中剔除或标 omitted，避免 codec 要求 resource 配对失败。
- enabled 但不可读 / symlink：记入 export warnings（若导出 API 暂无 warnings 字段，则跳过该项并在 file 写出成功；UI 可后续再挂）。最小：跳过失败 skill，其余继续；不要整包 throw。
- 错误文案带 skill id/name。

## 预览与摘要

- 扩展 `ConfigSyncSummary` 或 `warnings`：provider `name + api + host`、MCP `transport + command/url`、标量模型引用新目标。
- instruction 互斥：`summaryFor` 把被关掉的本机指令计入 `updated`，或 `addWarnings`。

## 错误分类

- preview catch：`ConfigSyncCodecError` → 密码/损坏；其它 → 原错误或「无法应用该配置包」。

## 备份轮转

- `commitSettingsTransaction` 写完 backup 后，按文件名排序删掉超出 `MAX_BACKUPS`（5）的 `settings.config-sync-backup-*.json`。
