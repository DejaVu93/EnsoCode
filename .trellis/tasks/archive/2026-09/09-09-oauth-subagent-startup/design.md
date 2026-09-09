# 最小修复设计

## 修改边界
- src/shared/providers/antigravity.ts：mergeAntigravityModels 保留所有有效 discovered spec，不再因被逻辑模型认领而删除 raw ID；既有逻辑入口继续按现有可用性规则构建。同 ID 去重保留现有逻辑语义。
- src/agent/subagent.ts：createSubSession 拒绝时更新同一 SubagentInfo 为 failed，清空 currentActivity，resultText 保存错误，然后重新抛出原错误。
- 两处同名测试：先建立失败用例，再修改实现。

## 原则与权衡
原始模型 ID 当作不透明标识，不从名字合成新逻辑模型或推断能力。已有逻辑模型表只保留旧入口，不新增 alias/迁移。代价是模型列表可能同时出现逻辑入口与真实 wire 条目；这是避免破坏旧配置且保持真实模型可解析的最小兼容面。

OAuth Main 和 worker 仍各自 refresh 同一个 provider 实现；本次修复的是刷新过程中删除 ID，不承诺跨进程离线快照一致性或按账号目录隔离。

## 生命周期
保留立即发布 starting 的反馈。同步/异步模式均在创建成功后才进入现有 run；创建失败没有异步 dispatched 回执或额外完成通知。Renderer 已有 failed 展示与收起，优先不改 UI。

## 回滚
两项修复可独立撤回；不修改持久化 schema，无数据迁移。
