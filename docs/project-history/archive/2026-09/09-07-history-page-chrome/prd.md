# 上滑历史 loading 与到头提示

## Goal

桌面、手机、远程节点上滑补更早历史时，顶部要有加载态；已经到第 0 条时要有到头提示。三端共用 `MessageTimeline` Header，不各写一套。

## Requirements

- 在途翻页：顶部显示转圈 +「正在加载更早消息…」
- 已到第 0 条（含短会话一页就完）：顶部显示「已到对话开头」
- 还有更早且不在加载：顶部不占文案（保持现有空白垫）
- 空时间线仍走现有 Preparing / 空态，不显示到头
- 手机 `historyPending` 必须进 React 状态，否则转圈不会刷新
- 桌面 `olderHistoryInFlight` 要进会话投影，ChatView 才能订阅
- 文案走 i18n（英 key / 中译）
- 不改分页预算、不 spawn、不改 jsonl 切片

## Acceptance Criteria

- [x] 桌面冷开长会话上滑：顶部出现 loading，页到了 loading 消失
- [x] 滚到第 0 条（或短会话本来就从 0 开始）：顶部出现到头提示
- [x] 手机同样有 loading / 到头；在途时再滑不连环发
- [x] 远程节点复用同一 Header
- [x] `loadOlderHistory` 在途置 `historyLoading`，结束清掉；相关单测先红后绿

## Notes

- 手机 `PairClient.historyPending` 已有，只是没回调到 UI
- 远程 `NodeView.historyPending` 已有，只是没传到时间线
