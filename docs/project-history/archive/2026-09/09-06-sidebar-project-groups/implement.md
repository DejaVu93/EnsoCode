# Implement: 侧边栏项目分组

TDD：带逻辑的切片先红后绿。`routeDrop` / 切片纯函数 / drawer 过滤用 coworker tester 分刀；UI 组件不强制单测。

## 1. Shared 模型与切片纯函数

- [x] `src/shared/types/project.ts`：`ProjectGroup`、`Project.groupId?`
- [x] `src/shared/projectGroups.ts`：`ALL_GROUP_ID` / `UNGROUPED_GROUP_ID`、`filterProjectsByGroup`、`sectionsForAllView`、未知 `groupId` 视作未分组
- [x] 测试：`src/shared/projectGroups.test.ts`（无组、单组、空组占段、归档项目不进活跃段、未知组）
- [x] barrel：`src/shared/types/index.ts` 如需导出

## 2. Settings store

- [x] `stores/settings/types.ts` + `index.ts` initial / actions（见 design）
- [x] `addProject` 可选 `groupId`
- [x] 按 `.trellis/spec/renderer/state.md` 加字段流程；无主题副作用，不必 `applySettings`

## 3. routeDrop

- [x] RED：`dragDrop.test.ts` 增 AC11 用例
- [x] GREEN：`dragDrop.ts` 前缀与新 `DropAction`
- [x] Sidebar `onDragEnd` 执行 move / reorder-groups，并更新 `PROJECT_ORDER_KEY`

## 4. 桌面侧栏

- [x] 选择器组件（节点行下）；0 组不渲染
- [x] 「全部」分段组头（可拖、可折叠、空组可见）
- [x] 置顶 / 归档 / 搜索 / `sessionSwitchSlotIds` 的 `projectIds` 走切片
- [x] 建组 / 编辑组对话框；项目右键移组；加项目默认当前组
- [x] `src/shared/i18n.ts` 全文案
- [x] 当前组、组折叠 localStorage
- [x] 选择器菜单项 droppable

## 5. Pair 下行

- [x] `packages/pair/src/protocol.ts`：`ProjectEntry.groupId?`、`projects` 帧 `groups?`
- [x] `PairCatalogPayload` + `pairCatalog.ts` 组装
- [x] `pairHost` 转发；`projects` 指纹含 groups
- [x] `slimProjectsForPhone` 保留 `groupId`
- [x] pair / metaSync 相关测试补未知字段兼容

## 6. 手机抽屉

- [x] `client.ts` / `App.tsx` 收 `groups`
- [x] `SessionDrawer` 简化选择器 + 分段 + 切片过滤（复用 shared）
- [x] 本地记住选中组；组被删或目录变空则回「全部」
- [x] 无组 / 旧桌面：与现网一致

## 7. 远程节点

- [x] 对方目录无 groups 时不画选择器
- [x] 若本任务帧已有 groups：只读选择器，与手机同简（有则做，没有不阻塞）

## 8. 校验

```bash
pnpm exec vitest run src/shared/projectGroups.test.ts src/renderer/components/chat/dragDrop.test.ts
pnpm typecheck && pnpm test
pnpm exec biome check src/shared/projectGroups.ts src/renderer/components/chat/dragDrop.ts src/renderer/stores/settings src/renderer/components/chat/Sidebar.tsx packages/pair/src/protocol.ts packages/phone/src/SessionDrawer.tsx
```

## 风险与回滚

- **高**：`Sidebar.tsx` 已很大；选择器 / 组头尽量拆文件，避免把拖拽和列表缠死。
- **中**：`projects` 帧加 `groups` 必须保持 `projects` 数组旧形态，旧手机才能忽略。
- **中**：跨组插入同时改 `groupId` 与手排，两步写进同一次用户手势，避免中间帧闪回原组。
- 回滚：revert 本任务提交；settings 多出的字段无读者即闲置。

## 提交建议（小步）

1. `feat: project group model + slice helpers`
2. `feat: settings projectGroups actions`
3. `feat: sidebar group drag routing`
4. `feat: desktop group selector and sections`
5. `feat: pair catalog groups downlink`
6. `feat: phone drawer group filter`
