# 执行与验证

- [x] 完成初始 read-only review，用户确认修复及上游 PR。
- [x] fetch 两个远端，比较上游 180 提交中的 watchdog/history 改动。
- [x] 合并最新 origin/dev；最小修复已存在的类型/格式问题，检查后提交同步。
- [x] TDD 切片：重复消息/工具输出与可见 write/edit 预览。
- [x] TDD 切片：snapshot 时钟保留与恢复，含历史尾窗。
- [x] TDD 切片：自定义行覆盖、OAuth 能力、单档与 4/6 档刻度。
- [x] TDD 切片：子模型三态思考，On 立即调节、Off 保留档位、Follow 清除覆盖。
- [x] TDD 切片：每个子模型条目独立启用/禁用、候选过滤、便携导入导出；enabled 缺省启用。
- [x] 每个独立行为修复运行 focused test、typecheck、lint、全量 test 后提交。
- [x] 隔离 ENSO_USER_DATA_DIR 启动 Electron，CDP 验证真实圆点/刻度与开关/复位/重载，截图留 /tmp。
- [x] 独立只读 review，修复发现后再跑验证。
- [x] 更新 spec 与任务验收记录。
- [x] 再次 fetch origin；上游仍为 0238951，已包含，无需再 merge。
- [ ] 推送 fork/fix/generation-stall-visible-output；gh pr create --repo J3n5en/EnsoCode --base dev --head DejaVu93:fix/generation-stall-visible-output。

验证命令：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check`。
不得宣称 mock/SSR 通过就等于真实布局通过；不触碰真实 userData 或收费模型。