# 实现清单

逻辑面大（切点 + 估价 + 钩子接线），按 TDD 角色分离：tester coworker 先红，主会话再绿。`spawn` 只派一刀。

## 1. 切点纯函数（tester 第一刀）

文件：`src/agent/ensoCompact/budget.ts` + `budget.test.ts`（测试先于实现）。

第一刀用例（< 10 条）：

1. `imageTokens`：短 data 仍 ≥ 1600；长 base64 按 `ceil(len/4)`，远大于 1200。
2. `estimateMessageTokens` 不把 `usage.totalTokens` 算进去。
3. 尾巴一张估价超预算的图 → 切点在该 toolResult 所属组之后（AC1）。
4. 尾巴一条高 `usage` 的 assistant、正文很小 → 仍因忽略 usage 而**可以留下**？不对：R1/AC2 要求切过该条，因为 **pi 下次仍会读它的 usage**。用例：高 usage assistant 必须被踢出（AC2）。
5. 最小尾巴仍超 → `{ fail: 'uncompressible' }`（AC4）。
6. `previousEstimatedAfter` 几乎相等 → `{ fail: 'no_saving' }`（AC5）。

`gate`：`pnpm exec vitest run src/agent/ensoCompact/budget.test.ts`

## 2. 接线（红灯到手后再写实现）

- `types.ts`：`CompactBranchEntry.id`
- `summarize.ts`：`patchCompactSummary` 补 Evicted 段；prompt 的 `SUMMARY_SECTIONS` 加上该段（可选，确定性补丁即可）
- `extension.ts`：选切点 → 扩 summarize 集 → 失败 `cancel: true` → 闭包记 `estimatedAfter`

`hook.test.ts` 补 AC1/AC3/AC4 各一条（第二刀 tester，同一 coworker）。

## 3. 明确不改

- renderer / i18n / supervisor 事件
- `window.ts` 条数尾巴（只给 summarize 兜底）
- eesv 分层预算数字

## 验证

```bash
pnpm exec vitest run src/agent/ensoCompact
pnpm typecheck
```

真机（实现后）：读一张大 jpg 的会话应 compact 一次后能再发，或一次失败，不得出现连续「压缩前 ~731K」成功条。

## 回滚点

只提交 `ensoCompact/**`。异常时 revert 该 commit。
