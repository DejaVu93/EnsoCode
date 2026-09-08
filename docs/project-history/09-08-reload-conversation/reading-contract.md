# 会话重读契约调查

## 基线

初始 `git status --short`：tracked diff 为空。已有未跟踪项：本任务目录、09-07-title-rolling-anchor-topic 任务目录、tmp-cdp-state.js、tmp-cdp-turn.js、tmp-cdp.mjs。不得清除或提交这些已有内容。

## 初查

由主会话代理 BCE 语义检索，确认以下路径后实现者精读。

- `src/renderer/stores/sessions/index.ts`：`loadChildHistory`（513 行附近）仅惰性加载 child；started、已有 messages 或 historyLoadAttempted 均阻断。失败静默，成功通过 projectSafeJournal 投影 messages/customEntries。
- `src/main/ipc/agent.ts`：`readChildHistory`（239 行附近）实际未限制 child，按 Main agentSessionIndex.persistedConversation 的 sessionFile 读取。校验必须在 userData/agent/sessions 内且 basename 为 enso- 前缀，绝不接受 renderer 路径。当前调用 restore 没有本地异常转换。
- `src/main/services/agentHost.ts`：`requestSnapshot`（742 行附近）ok 只代表入队。worker 未就绪时会延迟；不适合作为手动成功反馈。
- `src/agent/supervisor.ts`：handleCommand(snapshot) 同步获取 snapshotSessions 并 emit；SessionSnapshot 不带事件 seq。snapshotSessions 含 messages、commands、customEntries、审批和提问等。
- `src/renderer/stores/sessions/reducer.ts`：snapshot 分支不做 seq/旧 generation 拒绝，直接 lastSeq=0。sameGeneration 仅决定 activeMs。消息保留尚未被权威 user 消息确认的 optimistic 尾巴。
- `src/renderer/stores/sessions/index.ts`：全局 snapshot 回调还会 started=true、清 error、清 pendingCapabilityAsks 和 activeOauthAsk。手动刷新不可无差别套用。

## 结论

不能仅给菜单接 requestSnapshot，也不能通过 spawn/resume 读取历史。需关联请求完成/失败的只读读取契约及快照水位，在正确层阻止迟到读覆盖实时事件。缓存门控仅保留在自动惰性读取路径，手动动作必须强制读取。

## 必须保留

草稿、排队/在途用户消息、运行状态和审批；失败保留旧投影；inactive 父子历史可重复读；主会话右键目标与子标签右键目标不能误用 activeId。范围不扩展远端/手机、存储格式、自动轮询。
