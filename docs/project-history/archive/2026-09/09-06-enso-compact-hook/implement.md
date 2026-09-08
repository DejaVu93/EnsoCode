# Implement: Enso compact hook

TDD：抽取 / 窗口 / 摘要拼装 / 协议保持 inline Red-Green（每刀 < 50 行或 < 10 例）。跨文件接线不拉 tester coworker，除非单测切片膨胀。

## Slice 1 — 卸包，hook 空壳仍 fail-closed

1. 新建 `ensoCompact/extension.ts`：hidden inline extension，只 `pi.on('session_before_compact', () => {})`（先让出）。
2. `createSessionResourceLoader` 改挂这个 factory；删 `smartCompactInlineExtension` 对 `pi-smart-compact` 的依赖。
3. 删 `persistEnsoSmartCompactSettings` 的 spawn 调用与 `ENSO_SMART_COMPACT_CONFIG` 写盘。
4. `pnpm remove pi-smart-compact`；清 `electron-builder.yml`、d.ts。
5. 更新 / 删除只测包 factory 的用例；保留 `providerKeyFor` 测试。

验收：开关开时会话能 spawn；`/compact` 走原生（空 hook）；`import 'pi-smart-compact'` 编译失败。

## Slice 2 — 抽取 + 窗口（无 LLM）

1. RED：fixture 会话条目 → constraints / files / errors / open loops。
2. RED：工具 call 无 result 不得单独进尾巴；档位改变 keepRecent。
3. GREEN：`extract.ts` / `window.ts`。
4. hook：无模型或前缀过短仍让出；有抽取结果但先不调用 LLM（slice 3 再接）。

## Slice 3 — 单轮合成 + 确定性补丁

1. 固定章节模板；LLM 输入 = 抽取 JSON + 截断后的前缀文本。
2. 漏 goal/constraint/error 用抽取补丁补上。
3. hook 成功返回 `{ compaction: { summary, tokensBefore } }`。`tokensBefore` 用 `preparation.tokensBefore` 或消息估算，不再包装 `getContextUsage` 糊弄第三方。
4. 超时 / throw → 让出。手动 reason 不跑 10% 收益闸。

验收：单测用假 completer；不必堆到 70% 占用。

## Slice 4 — 设置文案与搜索目录

- `SmartCompactPicker` / i18n / `searchAnything`：Built into Enso / 第三方包措辞改成 Enso 自有摘要。
- 档位说明改为「影响摘要预算与尾巴，不决定是否压缩」。

## Slice 5 — 回归

- `pnpm typecheck &&` 相关 vitest + `biome check`
- 有条件：隔离 CDP `/compact`（假 provider），确认 `fromHook: true` 且工具列表无 `smart_recall`
- 不要动真实 userData

## 提交建议

独立提交，message 不需要「和」「顺便」：

1. `refactor: drop pi-smart-compact host wrapper`
2. `feat: Enso session_before_compact extract and window`
3. `feat: Enso verified compact summary`
4. `docs:` 仅当设置文案单独成提交

## 完成

用户确认实现后 `task.py start`。合入后 archive `09-06-smart-compact-switch`。
