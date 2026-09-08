# 过夜冷会话半截正文

## 现象

进程不退、过夜挂着。早上切到一个夜里被 worker 闲置回收的会话：显示半截旧正文，无 loading、无提示；在别的会话坐满 5 分钟再切回才刷出全文。

## 根因

1. `index.ts` snapshot 处理 `keepBody = partial || hot`：手机 `subscribe/history` 触发的 targeted snapshot 广播到桌面，把当时的半截正文灌进冷会话；之后 upsert 因冷被丢；5 分钟回收定时器只在切会话时武装，夜里不再切 → 半截常驻。
2. 切回已无条件 `requestSnapshot`，但 worker 30 分钟回收后回 `{sessions: [], partial: true}`，renderer 对不在快照里的会话 `continue`；`needsHistoryHydration` / `chatTimelineBusy` 见权威正文即当就绪；浏览不 resume。

## 需求

- R1 切回 `started === false && sessionFile && status !== 'failed'` 的父会话：**先清空正文**（messages/customEntries/historyBaseIndex/historyLoading）再 `hydrateParentHistoryTail`，同时仍 `requestSnapshot`。清空后 Preparing 自然出现。
- R2 snapshot `keepBody` 只看 `isMessageCacheHot`；会话在 snapshot 里时 `started: true` 不变。
- R3 worker `snapshot` 命令带 `sessionId` 时，事件带回 `sessionId`。renderer：`partial && sessionId` 且目标不在 `sessions` → `started: false`；若正在看则清空正文并 hydrate。

## 验收

- [ ] messageCache 纯函数测试：R1 判定函数、R2 keepBody
- [ ] store 测试：切回 started=false 会话先清空再 hydrate；partial 冷会话不留正文；空 partial 带 sessionId 收回 started 并 hydrate
- [ ] supervisor 测试：targeted snapshot 事件带 sessionId
- [ ] `pnpm typecheck && pnpm test` 通过，`biome check` 干净
