# 验证切片

1. 上游更新与已有改动保护：stash 留存，feature 分支快进，保留 GeneralSettings 两个入口。
2. RED/GREEN：智能压缩字段、模型映射、字段覆盖策略、预览和凭证边界。
3. 补齐其他可移植偏好；测试校验、往返及 excluded 字段保留。
4. 独立安全/正确性复核，修复后复测。
5. `pnpm exec vitest run src/main/services/configSync src/main/ipc/settingsConfigSync.test.ts`
6. `pnpm typecheck && pnpm test`，`pnpm lint`，`pnpm build`。
7. 隔离 userData 下 CDP 验证设置界面、导入后多窗口同步，优雅退出。

测试日志存于临时目录，不把生成 diff 或上游源码副本作为产品文档。
