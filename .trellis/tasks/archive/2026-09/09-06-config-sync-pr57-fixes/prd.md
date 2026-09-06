# PRD：修 PR #57 config-sync 审查项

## 背景

`feat/config-sync-upstream-audit`（PR #57）已实现可移植 `.enso-config` 导出/导入。
独立审查（含 Fable 5.1）确认安全底座可用，但有真实使用会失败与安全缺口，现状不建议合入。

本任务只修审查项，不扩功能面。

## 必须改

1. **指纹 + commit 白名单成对收紧**
   - `settingsFingerprint` 不得绑定整份 `settings.json` / `cachedSettings`（含 `enso-conversations`）。
   - 指纹只覆盖 `enso-settings.state` 的 `SYNC_FIELDS`。
   - `commitSettingsTransaction` / import commit 只应用 `SYNC_FIELDS`（外加 staged `path` / `sourcePath`）。
   - excluded 字段（`projects` / `proxy*` / `onboarded` 等）只取 **commit 时刻** 本机值。
   - 验收：preview 后改 `enso-conversations`，commit 仍成功；preview 后改 `projects`/`customProxyUrl`，commit 后仍是最新本机值。

2. **匹配本机 MCP 时不得用包内 `env` 覆盖并保持 enabled**
   - `normalizedMcpIdentity` 不含 env；加密包带 env 会整表覆盖已启用 server。
   - 验收：已匹配且已启用的 MCP，包内 env 不得静默覆盖；不一致则拒绝或强制 `enabled=false` 并在摘要可见。

3. **导出不得因单个坏 / symlink skill 整包失败**
   - `collectBundle` 对所有 skill（含 disabled）无条件 `collectSkillResource`，symlink 即 throw。
   - 验收：disabled 或不可读 / symlink skill 不阻断其余配置导出；失败项进 warning 或具名错误。

## 应该改（同一轮）

4. 预览披露 provider host、MCP 执行面、被改写的 `defaultModel` / `approvalReviewer`。
5. 导入启用指令关掉未匹配本机指令时，摘要计 `updated` 或明确 warning。
6. 锁步测试：`SYNC_FIELDS` portable 标量 = `SCALAR_SETTING_KEYS`；portable 字段 = `STATE_KEYS` = `SYNC_FIELDS`；并覆盖 `planImport` 内联列表。
7. `planImport` 失败不得报成「密码错误」（区分 `ConfigSyncCodecError`）。
8. 导入备份 `settings.config-sync-backup-*` 有保留上限（对齐普通 backup 的 5 份）。

## 本轮不做

- 信任确认主进程化、明文「仅偏好」导出、MCP `command` 脱敏、二次 open 废旧 token、skill +x 一律 0600：记入 follow-up，不挡本任务。

## 非目标

- 不改 `net.fetch` / child-history 测试提交。
- 不改 OAuth 永不导出、明文禁 secret/resource 的既有契约。
