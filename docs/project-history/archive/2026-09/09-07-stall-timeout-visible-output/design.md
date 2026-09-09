# 设计与边界

## 生成进展

- 行为位于 renderer reducer；不往 store 订阅回调塞判定。
- message-upsert 使用 historyBaseIndex 换算后的原消息比较新增可见 text/thinking、工具结果和 write/edit 预览。空白/纯工具占位/元数据变化不算。
- tool-output 按 toolCallId 比较全量文本。保持投影更新和 seq 前进，即便心跳不更新。
- snapshot 时同代且前后 running 保留 runStartedAt/lastOutputAt；首次/新代 running 以接收时间建立 runStartedAt，不把历史正文当新输出。
- 上游 task/subagent/approval 等可见状态心跳保持；活跃工作豁免保持独立策略。

## 推理配置

- ModelPicker 继续复用既有 Slider/Switch，不改全局 slider 样式；刻度按轨道百分比定位，文字两端向内对齐。
- 自定义 API 模型复用 resolveCustomModelView，与 main/worker 分层一致；OAuth 只按 catalog。必要时修复 catalog 元数据回转丢失 xhigh/minimal 支持集的问题，先测试。
- 设置条目缺省是跟随父会话，不持久化 follow 字符串；最终 UI 用三态，不再展示全局默认预览或逐字段继承说明。
- On 立即显示滑块并在缺少档位时原子写入可选默认档；Off 保留档位；调档只更新该条目的 thinkingLevel。Follow 清除二者，不能由渲染 effect 生成继承项覆盖。
- 条目启用独立于推理：SubagentModelEntry.enabled?: boolean，缺省 true；行尾 Switch 仅更新 enabled。main pickSubagentModelRefs 在去重前过滤 false，便携配置 codec 保留布尔值。沿用现有 spawn 配置快照生命周期，不打断已经运行的子任务。
- 用户后续批准简化交互：子模型 popup 用三态推理替代 switch+说明；仅 On 展示滑块，无 Customize/深度跟随第二层控制。主会话继续既有二态开关。
- 独立复审追加：capabilityGateway 更新条目时保留 enabled；自定义子模型的有效能力用条目覆盖合并 provider 行覆盖，OAuth 仍 catalog 权威。edit 心跳只比较可见 old/new 对，空对不是输出；同轮快照保留未完成工具尾巴供去重。

## 文件边界

- sessions/reducer.ts 及测试：心跳与 snapshot 时钟。
- chat/ModelPicker.tsx 及测试：坐标、能力支持集、继承提示展示。
- settings/SubagentModelsSettings.tsx 及测试、shared/i18n.ts：按字段标记继承/独立，双语文案。
- shared/modelCatalog.ts 及测试：仅必要的支持集无损转换。
- shared/types/assets.ts、main/services/subagentModels.ts 及测试、configSync codec 及测试：条目启用可持久化并影响候选列表。
- specs/task artifacts：最终契约、red/green 与验收证据。
- upstream 基线：Sidebar props、history tail mock、persistSnapshot 结构类型及 index 格式，纯类型/机械修复。

## 兼容与回滚

不加 IPC、不修改 worker 优先级；只新增兼容旧数据的可选 enabled 字段。按同步、心跳、模型能力、UI、条目启用的独立提交回滚。
最终 fetch upstream 后再次检查差异与全量验证，PR 来源 fork，目标原仓库 dev。

子模型自定义编辑器的努力覆盖可以改变实际请求配置，不能用当前所选 low 来缩小滑块支持集；该编辑入口保留全部可覆盖档位。普通主会话仍遵循 provider 行/catalog 能力，OAuth 始终只认 catalog 支持集。