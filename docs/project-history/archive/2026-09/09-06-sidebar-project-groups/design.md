# Design: 侧边栏项目分组

## Boundaries

- **权威**：组目录 + 项目 `groupId` 在 settings store（随 `settings.json` 多窗口同步）。
- **展示偏好**：桌面当前组、组折叠 → localStorage（新 key，与 `enso-collapsed-projects` 并列）。手机当前组 / 组折叠只存在 PWA 本地。
- **手机只读组结构**：改组只发生在桌面；下行 `projects` 帧带齐即可。
- **拖拽**：继续走 `App.tsx` 的 `DndContext`，动作只扩 `routeDrop` + Sidebar `onDragEnd`。
- **不改** source authority / worker cwd。组不是工作区。

## Data

```ts
// src/shared/types/project.ts
interface ProjectGroup {
  id: string;
  name: string;
  emoji?: string;
  color?: string;
  order: number;
}

interface Project {
  // 现有字段
  groupId?: string;
}
```

`SettingsState` 增 `projectGroups: ProjectGroup[]` 与 actions：

- `createProjectGroup({ name, emoji?, color? })` → 追加，`order = max+1`
- `updateProjectGroup(id, patch)`
- `removeProjectGroup(id)` → 清空成员 `groupId`
- `reorderProjectGroups(ids)` 或 `moveProjectGroup(activeId, overId)`
- `setProjectGroupId(projectId, groupId | null)`

`addProject` 接受可选 `groupId`（对话框默认当前组）。

旧 settings 缺字段：`projectGroups = []`，项目无 `groupId`。

## Desktop UI

```
[NodeSwitcher]     🔍 +
[GroupSelector]          // 仅 projectGroups.length > 0
[会话搜索]
置顶（切片内）
项目（全部=分段 / 单组=扁平）
归档（切片内，仍按项目再分组）
```

选择器对齐 EnsoAI：`ALL` / 用户组 / `UNGROUPED`。常量 `__all__` / `__ungrouped__` 放 shared（桌面 i18n + 手机共用），避免两边各写一份。

切片纯函数（建议 `src/shared/projectGroups.ts` 或 `stores/settings/projectGroups.ts`，手机也能 import 的放 shared）：

```ts
filterProjectsByGroup(projects, archivedIds, selected: 'all' | 'ungrouped' | groupId)
sectionsForAllView(projects, groups, archivedIds) // 含空组
visiblePinnedIds(...)  // 所属项目落在切片
```

会话切换槽的 `projectIds` 改为切片后的活跃项目顺序（各组内仍用现有 `projectOrder`）。

## Drag

`dragDrop.ts` 增：

```ts
projectGroupDragId(id) // 'project-group:<id>'
UNGROUPED_GROUP_DROP_ID // 'project-group:__ungrouped__'
selectorGroupDropId(id) // 'selector-group:<id|__ungrouped__>'

| { type: 'project-group'; groupId: string }

| { kind: 'move-project-to-group'; projectId; groupId: string | null; beforeProjectId?: string }
| { kind: 'reorder-groups'; activeId; overId }
```

`routeDrop`：

- project over `project-group:` / `selector-group:` → move（已在该组且无 before → null）
- project over `project:` 且目标不同组 → move + `beforeProjectId`
- project over `project:` 且同组 → 现有 reorder
- project-group over project-group（非 ungrouped）→ reorder-groups
- chat / file over 组头 → null

Sidebar `onDragEnd` 执行 store + `writeSidebarOrder(PROJECT_ORDER_KEY)`：跨组插入时先改 `groupId` 再把 id 插到手排数组对应位置。

选择器菜单项注册 droppable，悬停展开（已有菜单打开态即可；拖到关闭的 trigger 上先 `setOpen(true)`）。

## Pair / phone

`ProjectEntry` 增 `groupId?: string`。

`projects` 帧扩为：

```ts
{ type: 'projects'; projects: ProjectEntry[]; groups?: ProjectGroup[] }
```

`PairCatalogPayload.projects` 同步带 `groupId`；payload 增 `projectGroups`。`pairCatalog` 下发；`pairHost` 原样转发。`slimProjectsForPhone` 继续剥 `path`，保留 `groupId`。指纹纳入 `groups`（可并进现有 `projects` 通道，避免新通道逼旧客户端解析未知 type）。

手机：

- `client.ts` 把 `groups` 交给 App / Drawer。
- `SessionDrawer` 有组时在标题下加简化选择器（无 + / 编辑）。
- 过滤 / 分段复用 shared 纯函数 + 现有 `drawerOrder`。
- 组头可折叠；无拖。

旧手机：忽略 `groups` 与 `groupId`，项目数组顺序未变，扁平列表仍对。

## Remote node

`RemoteNodeSidebar` 仅当对方目录带 `groups` 时显示只读选择器（与手机同简）。本任务若远程帧还没有组字段，选择器不出现（AC12）。不要在本机 store 里给远程捏组。

## Compatibility / rollback

- 字段全可选；回滚桌面后手机丢掉选择器，项目行仍在。
- 删 `projectGroups` 数组但项目仍留 `groupId`：当未知组，视作未分组（或选择器不列空壳）。实现时：过滤 `groupId` 不在目录里的项目进未分组。

## Tradeoffs

- 组进 settings 而不是 localStorage：多窗口 / 重启一致；手排仍本地（与现项目顺序策略一致）。
- `groups` 挂在 `projects` 帧而不是新通道：旧客户端不认识字段即忽略；新通道旧客户端可能直接丢整帧。
- 手机不同步当前组：避免桌面切组把手机正在看的列表抽空。
