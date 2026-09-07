# Hashline read highlight and edit diff

## Goal

Hashline 开启后，时间线里 read 结果仍能正常语法高亮，edit 结果仍能看到 diff；带 offset 的 read 不再把 Hashline 编辑锁死。

## Root causes

1. `withHashlineRead` 把 `[path#TAG]` 头和 `N:` 行号写进 toolResult content，renderer 原样喂给 `ReadFileView` → shiki 高亮失效。
2. Hashline 松 schema 暴露了顶层 `oldText/newText`，模型改用 `{path, oldText, newText}`；renderer `extractEdits` 只认 `edits[]` → 无 diff。
3. `withHashlineRead` 忽略 `offset` 从 1 编号，并把截断提示行也编号；快照记录的是局部正文，tag 永远对不上整文件 → 之后的 Hashline edit 必报 stale。

## Requirements

- renderer 展示 read 输出前剥掉 Hashline 头与行号 gutter；非 Hashline 输出原样不动。
- `extractEdits` 接受顶层 `{oldText, newText}` 作为单块 diff。
- `withHashlineRead` 对局部读取（offset>1 或带截断提示）按 offset 编号、截断提示不编号、快照记录整文件；无法读整文件时不加头不编号。
- 不改拦截规则、hashline patch 语法、edit 执行路径。

## Acceptance Criteria

- [x] `stripHashlineRead` 剥掉头+gutter；无头文本原样返回（单测）。
- [x] timeline 里 read 的 `output` 已剥 gutter；legacy `{path,oldText,newText}` edit 得到一块 `edits`（单测）。
- [x] `withHashlineRead` offset=5 时输出 `5:` 起，尾部提示不带编号，`store.get(path, tag)` 为整文件（单测）。
- [x] `pnpm test` 全绿，biome 干净。
