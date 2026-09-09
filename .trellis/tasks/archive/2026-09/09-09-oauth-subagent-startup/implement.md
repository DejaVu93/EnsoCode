# 执行与验证

[√] 两条独立只读定位，确认不新增框架或持久化迁移。
[√] tester 第一刀：subagent.test.ts 同步/异步创建拒绝，RED 2 failed / 18 passed，缺 failed update。
[√] 实现 subagent.ts 创建失败终态，GREEN 20 passed。
[√] tester 第二刀：antigravity.test.ts 修订错误的折叠契约并新增 opaque ID 防线，RED 3 failed / 92 passed，缺 raw IDs。
[√] 实现 merge 保留 raw，GREEN 95 passed。
[√] 第三刀补发现 ID 恰为逻辑同名但无 route 的边界：旧逻辑 RED（目录为空），改按本次实际 inserted ID 去重，GREEN 96 passed。测试名称断言修订为保留远端名称，不发明逻辑 metadata。
[√] 独立复审无阻断项；保留原始请求和既有逻辑路由表征，双文件 116 passed。
[√] pnpm typecheck、pnpm lint 通过（仅 2 条既有 info）。默认全量并发首轮 5 项 5s 超时；不改断言/超时，用 pnpm exec vitest run --maxWorkers=2 完整重跑：255 files passed，2445 tests passed，4 live tests skipped。
[√] 隔离 Electron TaskBar UI 验证：running→failed、错误浮层、计时消失、未展开 5.6s 后收起、展开保留可关闭。证据 /tmp/enso-oauth-subagent-ui-evidence.json 和 7 张截图。为 renderer store 注入，不是 OAuth 真网或两厂商 LLM 端到端验收。
[√] 隔离 dev/userData 已清理，未读取/修改真实凭据，未结束用户应用。
[√] 默认 pnpm test 再跑通过：255 files / 2445 tests passed，4 live tests skipped；首轮超时未再现。
[√] 两项代码修复分别提交：19dffa9（启动失败终态）、9710266（保留发现模型 ID）。

## 已知边界
- 当前修复不统一 Main/worker 离线快照，也不改善现有账号目录共享。
- 已有逻辑同名 ID 的请求仍按原 LOGICAL_BY_ID 路由；本次只保障目录不丢失，不重写路由协议。
- raw wire 的思考参数沿用现有管线，不从 high 等后缀猜能力或档位。
- 老进程已卡住的 subagent 条目是内存状态，完整更新重启后清空；不会向旧进程补发终态。
- OAuth 真实账号推理成功尚未验证，不宣称已通过。
