# Implement

工作分支：`feat/config-sync-upstream-audit`（PR #57）。小步提交，一条审查项一 commit。

切片（TDD；每刀 < 50 行测试或 < 10 用例，超了再拆）：

1. **指纹 + 白名单**（红：`settingsConfigSync.test.ts` / `importSafety.test.ts`）
   - conversations 变更不挡 commit
   - projects/proxy 不被 preview 快照盖掉
   - 实现：`settingsFingerprint`、`commitSettingsTransaction`、`commitImportForSender` patch

2. **MCP env**（红：`mergeMapping.test.ts`）
   - 匹配且包内 env 不同 → 保留本机 env、禁用、warning
   - 实现：`mcpEntry` / warnings

3. **导出 skill 容错**（红：`index.test.ts` 或 `assets` 集成）
   - symlink / 缺失 / disabled 不整包失败
   - 实现：`collectBundle`

4. **摘要 / 指令互斥 / 预览明细 / 错误分类 / 四表锁步 / 备份轮转**
   - 可按文件拆 commit

验收：`pnpm exec vitest run src/main/services/configSync src/main/ipc/settingsConfigSync.test.ts src/main/ipc/settings.ts` 相关文件 + `pnpm typecheck`。

每刀：tester coworker 先红灯 → 实现变绿 → Fable reviewer 审 → 修 → 再审。
