# Design: quit confirmation

## Boundary

- In: 主窗口 `close`、`app` Quit（`before-quit`）、renderer 标题栏 `window.close`。
- Out: 设置窗 `close`、单实例锁失败的那个进程 `app.quit()`、`autoUpdater.quitAndInstall()`、脏文件保存。

## Flow

```
close | before-quit
  → 已允许退出 / 更新安装？直接过
  → 确认进行中？preventDefault
  → preventDefault，向主窗口 workbench 发 APP_CLOSE_REQUEST(requestId)
  → renderer 弹 ConfirmDialog
  → APP_CLOSE_RESPONSE(requestId, { confirmed })
  → 否 / 超时：结束，窗口与 app 保持
  → 是：allowQuit = true → app.quit()（再入 before-quit / close 时放行）
```

关窗与 Quit 共用一次确认。关窗确认后也 `app.quit()`，避免 macOS 只关窗留 Dock。

## IPC（三点式）

| 通道 | 方向 | 载荷 |
| --- | --- | --- |
| `APP_CLOSE_REQUEST` | main → renderer | `requestId: string` |
| `APP_CLOSE_RESPONSE` | renderer → main | `requestId`, `{ confirmed: boolean }` |

preload：`window.electronAPI.app.onCloseRequest(cb)` / `respondCloseRequest(requestId, { confirmed })`。

发往主窗口必须用 `getWindowWebContents` / `sendToWindow`（pinned workbench，不是 `win.webContents`）。

## Main 落点

- 状态与监听挂在 `MainWindow` 创建处（或 `createAppWindow` 仅当 `pinWorkbenchView`），**不要**拦设置窗。
- `before-quit`：未允许则 `preventDefault` + 同一套 ask；已允许则现有 pair/browser/settings flush 照旧。注意现有 `before-quit` 已有多处订阅，新增拦截必须在它们之前、且只拦截一次。
- `AutoUpdater.quitAndInstall`：先标 `quittingForUpdate`，确认逻辑读此旗标跳过。
- 超时（约 30s）或窗口已毁：当取消。
- 单实例锁失败进程：不创建主窗，不走确认。

## Renderer

- `App.tsx`（或小 hook）：听 `onCloseRequest`，开 `ConfirmDialog`。
- 标题「Confirm exit」，描述「Are you sure you want to exit the app?」，确认按钮「Exit」（destructive）。
- 取消 / 点遮罩 / Escape：`confirmed: false`。确认：`confirmed: true`。
- 无 dirtyPaths。

## Tests

纯函数抽出「是否拦截 / 响应是否匹配 requestId」可单测；Electron 窗口行为不强制 e2e。
