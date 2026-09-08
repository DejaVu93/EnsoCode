# 切回半截回复会话时强制对齐 snapshot

## Goal

从其他会话切回来时，即使本地已有半截权威正文，也向 worker 要一次 snapshot，把后台丢掉的流式 upsert 补齐。离开会话时才给 `lastViewedAt` 盖章，TTL 按「离开后再留 5 分钟」计算。

## Why

切走超过热窗口后，renderer 丢弃后台 `message-upsert`，但 `status` / `turn-completed` 照样落地。本地留下半条权威回复。切回时 `needsHistoryHydration` 看见权威消息就跳过 snapshot，用户看到半截已完成回复，发「继续」才因越界 upsert 触发全量灌入。

`lastViewedAt` 现在按切入盖章：在会话里坐超过 5 分钟再切走，该会话立刻变冷，半截更容易留下。

## Requirements

- 切到已启动或可 resume 且未 failed 的会话：无条件 `requestSnapshot`。`needsHistoryHydration` 只继续门控 jsonl 尾窗补水与 Preparing，不再单独决定要不要对齐 worker。
- 本地已有权威正文时仍不要重复打 `readParentHistoryTail`。
- `lastViewedAt` 在离开时盖章；正在看的会话仍始终热。注释与实现一致：离开后再留 `MESSAGE_CACHE_TTL_MS`。
- 不改 send / spawn / 输入锁 / Virtuoso 贴底。不改 worker 投影与冷缓存 TTL 数值。

## Acceptance Criteria

- [x] 切到「已有半截权威 assistant、status=idle、started」的会话会调用 `requestSnapshot`，且不调用 `readParentHistoryTail`。
- [x] 切到空窗可 resume 会话仍走原来的尾窗 + snapshot。
- [x] 离开会话后，在 TTL 内后台 `message-upsert` 仍会写入；超过 TTL 才丢。
- [x] 相关单测绿；本次改动文件 biome 干净。仓库里另有与本次无关的既有 `tsc` 报错。
