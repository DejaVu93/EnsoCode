# compact 只读工具 running 收入组头

## 问题

默认 `compactReadOnlyTools` 下，进行中的 read/grep/find 会先平铺成工具行，完成后立刻并进「Explored / 探索了 N 个文件」组头。虚拟列表高度来回跳，会话界面一抽一抽。

## 目标

compact 模式下，running/reviewing 的只读工具不再钉在组外，只更新组头（Exploring + 统计）。展开组仍按原始顺序平铺全部行。

## 非目标

- 不改 LLM 侧 `explore_fold`
- 不改 compact 关时「最后一轮平铺」
- 不把 edit/write/todo 折进组

## 验收

- compact + ≥3 只读工具（含正在跑的）：只有组头，组头 `exploring=true`，统计含 running 那条
- 展开后含 running 行且不重复
- compact 关：running 最后一轮仍平铺
- edit/write/todo 仍钉在组外
