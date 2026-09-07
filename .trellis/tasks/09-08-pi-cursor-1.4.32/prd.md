# PRD：升级 pi-cursor 到 1.4.32

## 问题

Enso 锁在 `@rahularya01/pi-cursor@1.4.31`，并靠 pnpm patch 在 `El` / `Fm` 入口挂 `__ensoCursorHandleInteraction` / `__ensoCursorHandleExec`，同时删掉 `modelDetails`（Fable `not_found`）。上游 1.4.32（2026-09-06）已把 `modelDetails` 删除合进主干（[#23](https://github.com/Rahularya01/pi-cursor/issues/23)）。裸升会丢掉 hook；旧 patch 因 minify 改名对不上。

## 目标

1. 依赖升到 `1.4.32`。
2. 补丁重打到 `patches/@rahularya01__pi-cursor@1.4.32.patch`，只保留两处 hook：有会话桥才接管，否则走上游。不再补丁删除 `modelDetails`。
3. `src/agent/cursor/**` 现有测试保持绿；`piCursorPatch.test.ts` 断言版本 `1.4.32`。

## 非目标

- 不改 Enso 会话桥 / 审批语义。
- 不把上游 in-process HTTP/2 替换现有 spawn 包装（保留兼容）。
- 不升 `@earendil-works/pi-coding-agent`（已是 latest `0.85.1`）。

## 验收

- [x] `package.json` 钉 `1.4.32`，`patchedDependencies` 指向新 patch。
- [x] 已安装 bundle 含两个 `__ensoCursor*` hook，且不含 `modelDetails`。
- [x] `pnpm exec vitest run src/agent/cursor/piCursorPatch.test.ts` 绿。
