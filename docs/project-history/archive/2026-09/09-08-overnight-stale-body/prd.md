# 过夜冷会话半截正文

## 现象

进程不退、过夜挂着。早上切到一个夜里被 worker 闲置回收的会话：显示半截旧正文，无 loading、无提示；在别的会话坐满 5 分钟再切回才刷出全文。

## 根因

1. `index.ts` snapshot 处理 `keepBody = partial || hot`：手机 `subscribe/history` 触发的 targeted snapshot 广播到桌面，把当时的半截正文灌进冷会话；之后 upsert 因冷被丢；5 分钟回收定时器只在切会话时武装，夜里不再切 → 半截常驻。
2. 切回已无条件 `requestSnapshot`，但 worker 30 分钟回收后回 `{sessions: [], partial: true}`，renderer 对不在快照里的会话 `continue`；`needsHistoryHydration` / `chatTimelineBusy` 见权威正文即当就绪；浏览不 resume。

## 需求

- R1 ~~切回 started=false 会话先清空~~ → **改在 `parent-ended` 到达时**：会话在渲染层是冷的就清空正文（messages/customEntries/historyBaseIndex/historyLoading），热的保留。切回时仍 `requestSnapshot`。
  - 改动原因：`started=false` 区分不了「jsonl 尾窗上屏的浏览态正文」和「冷缓存掉队的旧正文」，按切回清空会让浏览态每次切回重读、丢掉已上翻的旧页（`上滑只按当前 historyBaseIndex` 用例暴露）。掉队只可能发生在冷缓存期间，parent-ended 那一刻按热度判定最准。
- R2 snapshot `keepBody` 只看 `isMessageCacheHot`；会话在 snapshot 里时 `started: true` 不变。
- R3 worker `snapshot` 命令带 `sessionId` 时，事件带回 `sessionId`。renderer：`partial && sessionId` 且目标不在 `sessions` → `started: false`；若正在看则清空正文并 hydrate。

## 验收

- [x] store 测试：parent-ended 冷会话清正文 / 热会话保留；partial 冷会话不留正文但 started；空 partial 带 sessionId 收回 started 并 hydrate；spawning 中不动
- [x] supervisor 测试：targeted snapshot 事件带 sessionId，全量不带
- [x] `pnpm test` 2598 通过；typecheck 6 个报错与 HEAD 一致（非本次引入）；biome 干净

## 提交

- `d4a30ebd` feat(agent): targeted snapshot 事件回带 sessionId
- `86de778c` fix(sessions): partial 快照不灌冷正文、parent-ended 清冷正文、空快照收回 started
