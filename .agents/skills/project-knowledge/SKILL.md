---
name: project-knowledge
description: >
  Navigate EnsoCode's long-term engineering conventions, layer boundaries, testing rules,
  historical decisions, and high-cost pitfalls. Use before non-trivial or cross-layer changes,
  when adding IPC or session/worker behavior, when debugging state/history/input issues,
  when a fix reveals a reusable rule, or when the user asks to search or capture project knowledge.
  项目知识导航、踩坑检索、根因沉淀、TDD 和工程约定。
---

# Project Knowledge

这是项目知识的导航和维护入口，不替代权威文档，也不恢复任务状态机或工作流。先按下面的场景选择最相关的文档，避免无目的地通读整个知识库。

## 动手前：先读什么

| 场景 | 必读资料 |
| --- | --- |
| 任意非平凡改动 | `AGENTS.md`、`docs/engineering-guidelines.md` |
| 跨主进程 / preload / renderer | `docs/engineering-reference/guides/cross-layer-thinking-guide.md`、`main/ipc.md` |
| Main、worker、child、session | `docs/engineering-reference/main/services.md`、`renderer/state.md` |
| 新增或修改 IPC | `docs/engineering-reference/main/ipc.md` |
| provider、skill、MCP、指令扫描 | `docs/engineering-reference/main/services.md`、`testing.md` |
| React、Zustand、持久化 | `docs/engineering-reference/renderer/state.md`、`renderer/components.md` |
| UI、弹窗、窗口、样式 | `docs/engineering-reference/renderer/components.md`、`dialogs.md`、`styling.md`、`main/windows.md` |
| 纯逻辑、协议、解析器、路径校验 | `docs/engineering-reference/testing.md` |
| 怀疑已有类似实现 | `docs/engineering-reference/guides/code-reuse-thinking-guide.md` |

动手前至少回答：行为差距是什么、行为真正属于哪一层、哪些文件必须改、哪些相邻问题明确不做。

## 排障时：先查症状和根因

先看 `docs/engineering-reference/big-question/index.md`，再打开与症状最接近的条目：

| 症状 | 优先检查 |
| --- | --- |
| preload 改动后应用启动失败 | `big-question/preload-externalization.md` |
| 状态不更新、一直加载、推送无效 | `main/ipc.md`、`main/windows.md` |
| 同一个资源被导入多份 | `big-question/dedupe-identity.md` |
| 冷会话 / 历史为空，先发消息后正文消失 | `big-question/optimistic-echo-blocks-snapshot.md` |
| 多轮后历史消息消失 | `big-question/agent-end-run-scoped-messages.md` |
| worktree 切换后文件写错位置 | `big-question/worktree-move-races.md` |
| CDP 点击、拖拽或输入时好时坏 | `big-question/cdp-hidden-window-input.md` |
| retry、回退、恢复行为异常 | `big-question/pi-auto-retry-willretry.md`、`checkpoint-cross-session-wipe.md` |
| 弹窗或下拉无响应 | `big-question/dialog-layering.md`、`ui-component-classname.md` |

排查应沿完整链路验证可观察事实：

```text
UI → store/reducer → preload → IPC → Main → worker / 文件 / 网络
```

优先检查 IPC 返回值、持久化文件、worker 事件和 CDP 运行时状态，不要只根据症状所在的组件猜根因。

历史设计、研究和开发日志位于 `docs/project-history/`。它们用于找背景和已有决策，不是当前规范；如果历史资料和当前源码或工程规范冲突，以当前源码、`AGENTS.md` 和 `docs/engineering-reference/` 为准。

## 测试与验证

改动纯函数、解析器、协议校验、路径校验或 reducer 时必须遵循：

1. 先写测试并确认它因缺少功能而失败（RED）。
2. 写最小实现使其通过（GREEN）。
3. 跑全量测试后提交。

修 bug 同样先写复现测试。测试应断言可观察行为，不要只断言内部调用或错误文案。涉及模型自主调用工具的链路，至少用两个不同厂商的模型真机验证。

提交前运行：

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## 发现新知识后：如何沉淀

完成实现或排障后，只有具备复用价值的结论才写入文档。判断标准：

- 是否是一个其他模块也可能遇到的根因或边界条件？
- 是否改变了以后实现、测试或排查的默认做法？
- 是否有明确的回归测试、真机证据或可观察现象？

按类型选择落点：

| 知识类型 | 落点 |
| --- | --- |
| 高频、稳定的硬规则 | `AGENTS.md` |
| 项目级开发约定或跨层规则 | `docs/engineering-guidelines.md` |
| 某一层或某一模块的详细契约 | `docs/engineering-reference/main/`、`renderer/`、`shared/` 或 `guides/` |
| 真实踩坑、症状与根因错位、排查成本高 | `docs/engineering-reference/big-question/` |
| 一次性设计背景、方案比较、历史决策 | `docs/project-history/` |
| 纯回归防线 | 对应测试文件；必要时加简短背景注释 |

新增高代价陷阱使用以下结构，务必写清真实症状和回归防线：

```md
# 问题标题

## 症状

## 根因

## 修法

## 回归防线

## 相关代码
```

更新文档后同步检查相邻规范和已有链接，避免把同一规则复制成互相漂移的多份内容。不要把一次性的聊天总结、未经验证的猜测或完整任务日志直接写进长期规范。

## 维护边界

- 本 skill 只负责知识检索和知识沉淀。
- 不创建或维护任务状态，不引入 workflow、session pointer、JSONL manifest 或平台 hook。
- 不把 `docs/project-history/` 当作当前行为契约。
- 不为重复已有规则而新增抽象；优先更新最接近权威来源的文档。
