# 实施与验收

用户已批准 PRD 行为范围并开始；本轮不 commit。

1. [x] 记录 git 基线；读取 before-dev、spec、enso-cdp；主会话 BCE 初查后精读读取契约。
2. [x] 保存 reading-contract 研究及技术设计；请独立 reviewer 审查契约。
3. [x] 第一片：手动重读协议解析测试（合法往返、脏输入拒绝），保存 RED 输出后实现类型/parser。证据 tdd-01-red/green.txt。
4. [x] 第二片：worker 只读旁路（tdd-02）、生命周期索引旁路（tdd-03）、Main 关联/超时/退出（tdd-04 pendingReloads）。
5. [x] 第三片：Main 来源选择 `conversationReload.ts`（tdd-05 live/history；tdd-06 根会话 jsonl 尾窗 `tail`）；IPC `AGENT_CONVERSATION_RELOAD` + preload `reloadConversation(conversationId)`。
6. [x] 第四片：纯归并 `reload.ts`（tdd-07：live 水位重放 / history / tail / 失败原样）；store action `reloadConversation`（tdd-08：在途合并、事件缓冲重放、删除/代际丢弃、失败返回原因）。
7. [x] Sidebar 会话行 + CoworkerTabs（父/子 tab）菜单「重新读取会话」，reloading/spawning 禁用 + 图标转圈，失败 toast；i18n 中文。
8. [x] typecheck：本任务 0 错误（剩余 7 个为基线 rebase 遗留：configSync worktreeRoot、Sidebar lastActiveAt、filesTreeRefresh、persistSnapshot slice、reducer.test startedAt）。Biome：本任务新文件干净，改动文件仅剩基线已有的 import 排序问题。全量 vitest：本任务相关全绿；19 个失败文件均为基线 CRLF 行尾问题（stash 后复现），见 full-test.txt。
9. [x] enso-cdp 真机验证（隔离 userData + ENSO_CDP_PORT=9333，不碰真实数据）：
   - Sidebar 会话行右键菜单出现「重新读取会话」（重命名之后）；CoworkerTabs 父 tab 菜单同样出现。截图 research/cdp-menu.png。
   - 活会话：本地删掉正文后点菜单 → 2 条消息回来，草稿 `my draft` / started / lastSeq 保留，~300ms。
   - 离线（release 后 started=false）：重读走 jsonl 尾窗，正文回来且未 spawn（started 仍 false）。
   - 失败：不存在的 id → `No parent history file.`；空 id → `conversationId is required`。
10. [x] 清理：dev 实例已停，隔离 userData / 临时脚本已删；不提交。

每刀测试小于10例，inline RED-GREEN；不得测试和实现同时写。
