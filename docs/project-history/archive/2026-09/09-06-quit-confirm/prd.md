# App quit confirmation

## Goal

关闭或退出桌面应用时弹出二次确认（对标 EnsoAI「确认退出」），避免误点红绿灯 / 标题栏关闭 / Cmd+Q 直接退出。确认后**退出整个应用**（含 macOS 关主窗）。

## Confirmed

- EnsoAI：主窗口 `close` 先 `preventDefault`，向 renderer 发 `APP_CLOSE_REQUEST`；renderer 弹 Dialog（「确认退出」/「确定要退出应用吗？」）。确认后 main `forceClose`。更新安装退出跳过。脏文件保存流不纳入（EnsoCode 无对等编辑器脏文件）。
- EnsoCode 现状：主窗口 `close` 直接关；macOS 关主窗后应用可留 Dock；`WINDOW_CLOSE` 只是 `win.close()`；`before-quit` 只做 pair / browser / settings flush。
- 弹窗用现有 `ConfirmDialog`。文案中英双语。
- 设置窗口关闭不确认。更新 `quitAndInstall` 跳过确认。
- **产品决议**：macOS 关主窗与 Quit 同一语义——确认后退出整个应用。

## Requirements

- 主窗口关闭（红绿灯、标题栏关闭、`window.close` IPC）与应用退出（菜单 Quit / Cmd+Q / Ctrl+Q）都先确认；取消则继续使用。
- 确认后 `app.quit()`，走现有 `before-quit` 清理。
- 设置窗口关闭不弹。
- 自动更新安装退出不弹。
- 确认进行中重复关窗 / Quit 不叠窗。
- renderer 未就绪或超时：取消本次关闭/退出，不杀进程。
- 不包含「不再提示」、脏文件保存、dev 跳过。

## Acceptance Criteria

- [ ] 主窗口关闭弹出确认；取消不关窗、不退出。
- [ ] Quit / Cmd+Q / Ctrl+Q 弹出同一确认；取消不退出。
- [ ] 确认后整个应用退出（macOS 不留 Dock 幽灵进程），`before-quit` 清理仍执行。
- [ ] 关设置窗口不弹确认。
- [ ] 更新安装退出不弹确认。
- [ ] 确认中重复触发不叠窗。

## Notes

- Lightweight UI + 小段 IPC 协议：`prd` + `design` + `implement`。
