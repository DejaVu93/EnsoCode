# 重新读取会话：技术设计

## 行为边界

当前没有手动强制重读入口，惰性 child 历史加载会命中缓存且失败静默。目标是在 Sidebar/CoworkerTabs 为右键目标重读权威消息和关联时间线，不改变代理执行、草稿或后端历史。

正文真实来源为活动 worker 与非活动会话 safe journal。菜单仅发起 store action；Main 决定读取来源，renderer 不决定文件路径。

## 独立手动读取契约

不重构现有自动 snapshot 协议。为手动重读新增具有关联 requestId 的只读请求和确定的成功/失败结果：

1. renderer 仅传 conversationId；Main 查询当前 worker 身份及自己的持久化元数据。
2. 活动 worker：同步读取当前 SessionSnapshot，同时携带 generation 与事件 seq 水位；独立结果，不作为普通 snapshot 广播，避免自动 snapshot 分支改变 started/审批状态。
3. 非活动历史：复用现有 readChildHistory 的安全路径与 safe journal 投影能力，通用命名；不 spawn/resume，不恢复代理执行。路径仍由 Main 查询并检查目录和 enso- 前缀。读取异常返回失败。
4. worker 请求必须有响应关联、超时及退出清理，不把 enqueue ack 当作读取成功。

## 并发与状态保留

同会话重读合并在途请求；各会话独立。申请期间的实时事件继续正常处理，同时为本次读取保留必要的事件序列。活动快照先作为投影基准，再按序重放水位之后的事件，以免 IPC reply 晚于实时事件造成倒退；generation 改变或会话删除时不应用旧结果。历史响应若遇到会话复活也不得覆盖新代。

手动应用只更新权威正文/关联投影，保留草稿、选中目标、排队消息、运行/审批状态；保留尚未被权威确认的 optimistic 用户尾巴。失败不改变旧正文。错误由菜单反馈。成功为空也是有效权威结果，不能以非空门控跳过。

## 预期文件范围

- shared agent 类型、解析器及 IPC 常量：手动读取请求结果与水位契约。
- worker supervisor：无副作用快照读取与结果响应。
- main agentHost：请求关联、退出/超时处理。
- main IPC agent：权威选择读取源，安全历史读取，入参校验。
- preload：只暴露 conversationId 方法。
- renderer sessions store 与纯 reducer/helper：强制请求、在途保护、结果归并。
- Sidebar、CoworkerTabs、shared i18n：一致菜单与错误/禁用状态。
- 对应测试：按小片 TDD 红后绿。

不新增轮询、不刷新应用、不改变存储格式，不扩展远端/手机菜单，不改已有自动重载语义。

## 待实现前审查

审核角色确认事件缓冲/水位应用及 Main 生命周期源选择；任何需新增行为超出上述边界时报告主会话，不自行扩大范围。
