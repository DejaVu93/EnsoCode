# 无输出停止只认可见生成心跳

## 问题

「无输出则停止」按会话投影的 `lastOutputAt` 判断。当前每次 `message-upsert`（含越界丢正文、空 assistant、空 thinking、仅 toolCall、用户消息）都会刷新该时间戳。界面可以卡在 spinning 的工具卡上，watchdog 却认为一直有输出，2 分钟阈值不会触发。

## 目标

`lastOutputAt` 只在用户能当成「模型还活着」的输出到达时刷新，与设置文案一致：token、思考文本、工具结果。

## 范围

- `src/renderer/stores/sessions/reducer.ts` 的 `lastOutputAt` 写入
- 对应 reducer 单测
- 相关 spec 把「越界 upsert 续命计时器」改成新契约

## 不改

- stall 阈值 UI 与分钟档
- pi 侧 auto-retry / `willRetry`
- 工具卡 running 态的展示逻辑（本次只修心跳，让 watchdog 能在脱节后真正 abort）
- 子模型思考滑块（另案）

## 验收

- 越界 `message-upsert` 只推进 `lastSeq`，不改 `lastOutputAt`
- 非空 assistant text / 非空 thinking / `toolResult` / 非空 `tool-output` 刷新 `lastOutputAt`
- 用户消息、空 assistant（含 Connection error）、空 thinking、仅 toolCall、空 `tool-output` 不刷新
- `pnpm test` 覆盖上述矩阵；`pnpm typecheck` 通过
