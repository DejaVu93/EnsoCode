# 冷打开先出会话尾窗

## 问题

点开已有会话会空转「正在恢复会话…」，直到 worker 整轮 spawn（runtime / skills / MCP / jsonl 回放）才出正文。用户只想看历史时也要付同样代价。persist 不存 messages。

## 方案

Main 用 SessionManager.open + getBranch + projectMessage + takeSnapshotTail 读父会话 jsonl 尾窗，独立 hydration IPC，不伪造 worker generation。点开先上屏；needsHistoryHydration / composer busy 只在「连尾巴都没有」时转圈。浏览不自动 spawn（本切片可仍自动 spawn，但正文不再等它）。

## 验收

- 有 sessionFile 的冷会话，点开后在 spawn 完成前就能看到尾窗消息
- 路径必须在 sessions 目录内，且等于该会话已登记的 sessionFile
- 投影走 projectMessage，不把未脱敏字段送 renderer
- 真 worker snapshot 到达后覆盖只读尾巴（含 historyBaseIndex）
- 尾巴已上屏时不再用全屏「正在恢复会话…」挡住时间线
