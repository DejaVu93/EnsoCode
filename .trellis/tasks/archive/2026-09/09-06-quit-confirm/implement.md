# Implement: quit confirmation

## Checklist

- [x] IPC：`APP_CLOSE_REQUEST` / `APP_CLOSE_RESPONSE` 写入 `ipc.ts`；`preload` 出口；`electronAPI` 类型。
- [x] AutoUpdater：`quitAndInstall` 设 `quittingForUpdate`，导出读取。
- [x] Main：主窗口 `close` + `before-quit` 拦截、requestId、超时、`allowQuit` 后 `app.quit()`；设置窗不拦。
- [x] Renderer：`ConfirmDialog` + i18n（Confirm exit / Are you sure you want to exit the app? / Exit）。
- [x] 有可抽的匹配逻辑则同目录单测；`tsc` + 相关 biome。

## Validate

```
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec biome check <touched>
# 手测：关主窗取消/确认；Cmd+Q 取消/确认；关设置窗；确认后进程退出
```

## Rollback

删通道与监听即恢复直接关窗/退出。
