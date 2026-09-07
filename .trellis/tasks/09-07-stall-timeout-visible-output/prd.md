# 生成心跳与子模型配置 review 修复

## 目标与背景

用户要求 review `0d31c97`，修复发现的问题，同步最新上游并从 DejaVu93 fork 向 J3n5en/EnsoCode:dev 提交一个 PR。
初始基线 fe3fab8 更新至 0238951（180 个上游提交）；保留新增的 historyBaseIndex 尾窗与活跃工具/watchdog 豁免。
用户后续确认：单个子模型开关指条目可用性，不是推理开关；否决重复“跟随会话”按钮和多行解释，选择三态推理交互。

## 要求与验收

### R1 生成心跳

- reducer 对合法 upsert 更新投影/seq，但只有新增可见内容刷新 lastOutputAt。
- 非空 text/thinking、工具结果、变化的 tool-output、write/edit 可见预览算输出；空 assistant/空白/用户消息/静态工具占位/越界 upsert 不算。
- 同位置递增 seq 的重复输出不刷新；工具参数元数据、对象键顺序变化不算进展。
- edit 空 old/new 占位不算输出，真实删除算。沿用时间线提取函数，不复制协议解释。

### R2 快照时钟

- 首次/新代 running snapshot 以接收时间建立 runStartedAt，不把历史正文当新输出。
- 同代连续 running 保留时钟与未完成工具输出基准；已完成工具尾巴清除。
- idle/failed 显式清空时钟、结算 activeMs；新代不继承旧时钟/工具尾巴。
- 测试覆盖 store 浅合并 `{...old,...projection}` 和 historyBaseIndex 尾窗，保留上游快照行为。

### R3 模型能力与滑块

- 自定义模型 UI 与执行层复用能力分层；OAuth 只认 catalog，不吃自定义行覆盖。
- catalog 支持集回转无损，尤其 minimal/xhigh/null；自定义显式子模型 on/max 不得被 provider 行 off/high 在渲染时回写覆盖。
- 当前选定努力档不能成为 UI 自身的上限而锁死滑块；关推理后仍能重新开启。
- 1/2/4/6 档安全；圆点中心、填充终点与刻度位置一致；两端不溢出，单档不产生 NaN。

### R4 单子模型可用性

- 每个条目单独 enabled 开关；关闭后整行弱化、显示“已停用”，保留模型/描述/推理配置，其他行不变。
- Main 在候选去重前过滤 disabled 条目，重开恢复，旧数据缺 enabled 默认启用。
- 设置持久化/rehydrate、便携明文/加密导出导入（merge/replace）保留 enabled；非法非布尔值拒绝。
- Enso 更新能力只编辑描述等字段时必须保留旧 enabled，不能静默重新启用。
- 沿用父会话启动时下发候选快照的架构；新启动父会话生效，一句短提示说明，不中断既有子任务。

### R5 清晰推理交互（用户选择的方案）

- 子模型 popup 显示有明显选中态的“跟随主会话 / 开启 / 关闭”。主聊天选择器仍保留二态推理开关。
- 跟随父会话继承思考开关和程度，不展示伪实际全局默认值；点开启立即显示可调滑块，不得再要求点击“自定义”；关闭不思考并保留最后档位。
- 点击跟随清除 reasoning/thinkingLevel 两项覆盖；On 写 reasoning:on，缺档位时同时初始化为可选默认档（有既存档位则保留）；Off 只改 reasoning，调档只改 thinkingLevel。无独立的“深度跟随”第二层控制。
- 去掉重复的行级跟随按钮、独立设置/source 段落、长继承说明。当前模式/档位变化应一眼可见。

### R6 交付

- 可单测逻辑测试先红后绿，独立 reviewer 确认；typecheck、lint、全量 test、build 通过。
- 隔离 ENSO_USER_DATA_DIR/CDP 验证真实滑块、条目与推理开关、重载持久化，不用真实凭证或付费模型。
- 分行为小步提交，最终再次 fetch upstream 后复测，推 fork、向原仓库 dev 提交一个 PR。

## 非目标

- 不改变上游活跃工具/coworker/审批等待超时豁免、自动重试次数或工具执行时间策略。
- 不新增热更新父会话候选列表协议、不修改 worker 覆盖优先级、不合并 PR。
- 不修改用户真实配置；同步后的既有类型/格式错误仅最小机械修复，不重构周边模块。
