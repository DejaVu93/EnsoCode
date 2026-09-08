# PRD: Changes 面板 diff 高亮移到 Worker

## 背景

快照移出 localStorage 后，Changes 面板会话 → Git 切换仍卡 3–5 秒。CDP CPU profile（6 个文件、
约 120 KB 源码）：主线程 2054 ms 全在 `@shikijs/engine-javascript` 的 `findNextMatchSync`——
shiki JS 正则引擎在主线程**同步**高亮整份 old/new 文本。IPC `git.diffHead` 仅 119 ms。

`CodeView` / `FileDiff` 都传了 `disableWorkerPool`，且应用里从未挂 `WorkerPoolContextProvider`，
所以 @pierre/diffs 的 worker 池一直没启用。

## 目标

1. diff 高亮在 Web Worker 里跑，主线程不再被 shiki 阻塞；切换模式时 UI 立即响应，高亮结果异步填充。
2. 池挂在主窗口根部，`ChangesView` 先接入；`FilesView`（编辑态 `File`）与聊天 `EditDiff` 后续按需去掉 `disableWorkerPool` 即可复用。
3. Worker 不可用（构建产物缺失、CSP 拒绝）时自动退回主线程高亮，不白屏。

## 非目标

- 换 WASM 引擎（`shiki-wasm`）——另评。
- `buildTimeline` 三处重复计算去重。

## 约束

- 走 Vite `?worker` 引入 `@pierre/diffs/worker/worker.js`，dev 与 electron-vite build 都要能起。
- `index.html` CSP 已含 `worker-src 'self' blob:`，不放宽 CSP。
- 高亮主题/语言与 `codeHighlighter.ts` 的 `CODE_THEME` / `LANGS` 保持一致，不分叉。
- 只在主窗口挂 provider；settings 窗口不需要。

## 验收标准

- AC1 同一会话切到 Git（6 文件 / 120 KB）：CDP profile 主线程 shiki 自耗时 < 200 ms，
  `setChangesMode` 到下一帧 < 100 ms。
- AC2 Session / Git / Files 面板 diff 高亮效果与改前一致（颜色、词级 diff、折叠）。
- AC3 dev 与 `pnpm build` 产物中 worker 文件存在、DevTools 可见 worker 线程。
- AC4 `pnpm typecheck && pnpm test` 与 biome 通过。
