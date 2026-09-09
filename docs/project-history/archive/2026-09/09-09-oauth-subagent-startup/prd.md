# OAuth 模型可解析性与 subagent 启动失败收尾

## 背景
用户从 Antigravity 拉取并选择 gemini-3.8-flash-high，subagent 启动时报 oauth model not found。工具调用已报错，但底部子代理条目持续 starting…、持续计时，展开输出显示 running。

## 要求
- 合法发现的远端模型 ID 应能进入运行时目录，不因本地显示归组而被丢弃。
- 不添加逐模型别名、全局后缀剥离或猜测新模型能力。
- 保留既有逻辑模型和 thinking 路由的兼容性。
- subagent 启动失败必须从 running 进入 failed，保留可读错误，停止活跃显示并使用已有收起机制。
- 同步和异步派发均应遵守启动失败契约，不返回假的 dispatched 成功回执。

## 验收
- 原始 low/medium/high、tiered 及未知远端 ID 均按原身份保留；已有逻辑入口不重复。
- 原始 ID 请求不被重写为另一个模型，已有逻辑入口的请求路由不变。
- createSubSession 拒绝后发出同 ID failed 更新，清空 currentActivity、保留错误，原错误仍传给调用方。
- 失败后 UI 不继续 starting/running 或持续计时；未展开条目按现有超时收起，展开条目可读错误并可关闭。
- RED/GREEN、typecheck、完整测试、Biome 和可用的隔离界面验证记录完整。

## 非目标
不新建统一模型框架，不迁移用户模型设置，不重构 OAuth token/配额/账号轮换，不修改无关 provider 行为。
