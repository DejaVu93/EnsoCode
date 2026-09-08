# Review 与验收记录

## 基线与范围

- 原提交 0d31c97；upstream 合并到 0238951，版本 0.1.22。最终 fetch 确认 upstream tip 不变。
- 三个 upstream 类型错误与两个格式错误做最小机械修复（Sidebar props、history-tail mock、persistSnapshot 类型、index 格式）。
- 独立复审发现并修复：edit 元数据假心跳、快照丢工具输出去重基准、Enso capability 更新丢 enabled、自定义子模型覆盖被 provider 行覆盖回写。
- 保留 upstream 活跃工具/coworker/审批超时豁免，不承诺停止活跃工具；可用模型列表按 parent spawn 快照生效，无热更新协议。

## Red / Green

| 切片 | Red | Green |
| --- | --- | --- |
| 心跳输出比较 | reducer 6 fail /44 pass | 50 pass |
| 快照时钟 | reducer 8 fail /50 pass | 58 pass |
| edit 可见对/工具尾巴快照 | reducer 4 fail /58 pass | 62 pass，tester 核对 SHA 未改 |
| catalog 回转 | 4 fail | 18 pass |
| capability 解析 | 4 fail | 12 pass |
| 坐标 1/2/4/6 档 | 4 fail | 19 pass |
| 条目 enabled UI | 2 fail | settings 8 pass |
| Main 候选过滤 | 3 fail | selector 8 pass |
| 便携 enabled | 5 fail + legacy pass | roundtrip/type validation pass |
| Enso update 保留 enabled | 2 fail /2 baseline pass | 4 pass |
| 三态 UI / 优先级 / 不自钳位 | 分别 9/3/2 fail | 修订验收通过 |
| On 立即滑块（去掉 Customize） | 7 fail /35 pass | picker+settings 42 pass |
| 切换自定义模型保留条目覆盖 | 新例 1 fail /31 pass | picker 32 pass，独立 reviewer 通过 |

## 最终自动验证

- `pnpm typecheck` exit 0。
- `pnpm lint` exit 0，798 文件，只剩 2 条既有 info（Biome 配置弃用、timeline 双重取反建议），无 errors/warnings。
- `pnpm test` exit 0，255 文件通过 /1 跳过，2440 测试通过 /4 SSH live 跳过。
- `pnpm build` exit 0；既有 dynamic import chunk 提示不影响构建。
- `git diff --check origin/dev` exit 0。

## 隔离真机 CDP

环境 `/tmp/enso-review-0907`，fake provider 凭证指向 127.0.0.1，无真实模型请求；不使用真实 userData。

- 真实六档逐档点击可选择；低档选择后高档仍在；每档 thumb center = fill right = tick x（误差 <0.1 CSS px）。
- 六档实测 x 坐标：254.5 /305.8984375 /357.296875 /408.6953125 /460.09375 /511.5。
- 受信任 CDP drag 从 max (511.5,475.8125) 到 medium (357.3,475.8125)，input value=2，显示“深度：中”。
- Follow 不显示滑块；点 On 立即出现；Off 隐藏；重新 On 恢复先前 max。
- 单条停用保留配置，邻条不变；页面 reload 后保留“已停用”和独立 medium 档。
- 最终截图 `/tmp/enso-review-final-on.png`，原中间截图 `/tmp/enso-review-entry-switches.png` 只作过程证据，不提交产品仓库。
- UI 测试操作曾遇到后台窗口停止 animation-frame / 多调用间菜单关闭，以及 Vite HMR 不同 URL 模块实例；以最终前台稳定页面的真实 DOM/磁盘结果验收，不把这些驱动问题计为产品失败。

## 用户修订后的最终交互

跟随父会话 / 开（直接选程度）/ 关（不思考）。无 Customize、无深度跟随第二层控制；行开关是候选可用性，关后显示已停用。