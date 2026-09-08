# Implement

按 TDD：主进程 service 先红后绿；renderer 纯逻辑抽出可测；UI 胶水不强制。
每完成一个可独立描述的改动单独 commit。

## 1. Main service（RED → GREEN）

- [ ] `src/main/services/changesSnapshots.test.ts`：tmp dir fixture；用例
  - 非 uuid id 读返回 `{}`、写返回 false 且目录下无文件（防穿越，如 `../x`）
  - 不存在读 `{}`
  - 写后读回一致
  - 坏 JSON / 非对象 / 值非 string 的键 → 过滤后返回
  - 写空对象 → 文件删除
  - prune：只删陌生 uuid 的 `.json`，保留 live 与非 uuid 文件
- [ ] 运行确认红（缺模块）；实现 `src/main/services/changesSnapshots.ts`；绿。
- [ ] commit `feat(changes): 会话快照服务：按会话落盘 userData/changes-snapshots`

## 2. IPC 三点 + 登记

- [ ] `src/shared/types/ipc.ts` 新增 `CHANGES_SNAPSHOTS_READ` / `CHANGES_SNAPSHOTS_WRITE`
- [ ] `src/main/ipc/changes.ts`：unknown 收窄；惰性一次 prune（读 `readSettings()['enso-conversations']`）
- [ ] `src/main/ipc/index.ts` 注册
- [ ] `src/preload/index.ts` `changes: { readSnapshots, writeSnapshots }`
- [ ] `packages/phone/src/stubs/electron-api.ts` 补 stub
- [ ] `src/tooling/productCapabilityCoverage.fixture.ts` 两通道 `excluded(...)`
- [ ] `pnpm typecheck && pnpm test`
- [ ] commit `feat(changes): 快照读写 IPC 与 preload 出口`

## 3. Renderer store

- [ ] `stores/sidePanel/index.ts`：partialize 去掉 `snapshotsByConversation`；`saveSnapshots` 追加 IPC 写；
  新增 `loadSnapshots`；`version: 4` + migrate 迁移旧快照到磁盘
- [ ] 迁移纯函数抽出并测（如 `splitLegacySnapshots(persisted) → { state, snapshots }`），
  放 `stores/sidePanel/migrate.ts` + `.test.ts`
- [ ] commit `perf(sidepanel): 会话快照移出 localStorage，改走主进程落盘`

## 4. ChangesView

- [ ] `mode === 'all'` 时 `loadSnapshots`；`snapshots` 未加载时不聚合、不保存
- [ ] commit `fix(changes): 快照未回读前不聚合，避免覆盖磁盘旧快照`

## 5. 验证

- [ ] `pnpm typecheck && pnpm test && pnpm exec biome check src packages`
- [ ] 真机：打开 Changes、拖宽度、切模式无卡顿；devtools `localStorage.getItem('enso-side-panel').length`
  降到 KB 级；`~/Library/Application Support/enso-code-dev/changes-snapshots/` 出现会话文件
- [ ] 若可复现旧数据：v3 → v4 迁移后文件落盘、Session diff 不变

## 回滚点

每步一个 commit，`git revert` 单步即可。
