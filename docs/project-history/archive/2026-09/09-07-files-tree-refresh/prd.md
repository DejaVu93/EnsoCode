# Files 面板树刷新：write 后自动更新 + 刷新按钮

## Goal

右侧 Files 面板的文件树在 Agent 新建文件后能看到新文件；用户也能手动刷新。不引入目录级 watch，避免会话级常驻监听和句柄泄漏。

## Requirements

- Files tab 打开时，timeline 里**真正完成**的 `write`（有 result，不是 speculative ok）应刷新树，并展开该路径的祖先目录，让新文件可见。
- `edit` 不触发树刷新（只改已有文件内容；已打开文档走现有 watch/重读）。
- 打开 Files tab 时，历史 write 只用来占位「已见过」，不把整棵历史目录全部展开。
- 切换会话后重新占位，不把上一会话的 write 当成新变更。
- 树顶提供刷新按钮，手动 `listDir` 重拉已展开目录（兜底 `bash` 建文件、SSH、外部改盘）。
- 不新增目录 watch / SSH 轮询；不改已打开文件的逐文件 watch 生命周期。
- 刷新按钮文案走 `t()`；已有 `Refresh` 键可复用。

## Acceptance Criteria

- [ ] Agent `write` 新建文件后，Files 树在对应父目录展开时能看到该文件，无需关开 tab。
- [ ] 新建在未展开的嵌套目录时，祖先目录自动展开并显示新文件。
- [ ] `edit` 已有文件不导致整树无意义重刷（不依赖 write 路径）。
- [ ] 打开 Files tab 不会因历史 write 把大量目录突然展开。
- [ ] 树顶有刷新按钮，点击后已展开目录重新 `listDir`。
- [ ] 关闭 Files tab 不留下新的 watcher；本任务不增加任何目录 watcher。

## Notes

- 纯逻辑（祖先目录、哪些 write 算「新完成」）抽到可单测函数；UI 接线保持最小。
- 本任务不上目录 watch；若后续仍不够，再单独立项。
