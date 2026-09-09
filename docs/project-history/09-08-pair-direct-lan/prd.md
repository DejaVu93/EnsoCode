# 配对直连：同内网 / 跨网打洞走 P2P，失败回退中继

## Goal

已配对的两端（桌面 host ↔ 手机 PWA / 桌面 guest）业务帧优先点对点传输：同内网走 LAN 直连，跨网经 STUN 打洞直连；直连不可用（NAT 打不通、网络切换、对端旧版本）时无感回退到现有中继通道。用户价值：延迟更低、不依赖公网中继的可用性与带宽、流式输出更顺。

## Background（代码现状）

- 三端共用 `@enso/pair`（`packages/pair/src`）。桌面 host `src/main/services/pairHost.ts`、桌面 guest `src/main/services/pairGuest.ts` 运行在 Electron main（Node）；手机 `packages/phone/src/client.ts` 是 **https PWA**（由 relay 同域提供）。
- 中继 `packages/relay/src/room.ts`：每 pairId 一间 DO 房，1 host + 1 guest，只转发密文（room.ts:157-169），明文控制帧仅 5 种（`protocol.ts:17-23`）。业务帧 AES-GCM(contentKey) E2E，**relay 不解析**——新增加密帧类型无需改 relay。
- 传输层无序号/ack；断线恢复 = 手机 `sinceIndex` 游标增量（client.ts:310-328 / pairPolicy.ts:256-280）+ snapshot 兜底 + meta 指纹重推（pairHost.ts:742-780）。
- 网络变化检测统一入口：main 侧 `pairNetworkWatch.ts`（3s 轮询网卡指纹）+ `powerMonitor.resume` → `reviveAll('network-change')`；手机侧 `visibilitychange`/`online` → `client.nudge()`（`revive.ts:42-45 shouldReplaceOnNudge`）。
- 旧端兼容基线：旧 PWA 忽略未知 `HostToPhone` 帧（protocol.ts:222-226）；旧桌面 `parsePhoneCommand` 白名单丢弃未知 `PhoneToHost` 帧；三端对未知明文控制帧静默忽略。
- 全仓库零 WebRTC / mDNS / 直连代码。

## Confirmed decisions

- **D1 范围含手机**（用户：手机最常用）。手机是 https PWA，浏览器禁止 https 页连 `ws://LAN-IP`（混合内容），`wss://` 需 LAN 侧可信证书（iOS 不现实）→ 直连通道 **只能是 WebRTC DataChannel**。桌面↔桌面复用同一 WebRTC 路径（一套代码）。
- **D2 必须有版本回退兜底**（用户：用户可能没更新桌面端）。新旧任意组合都必须仍能经中继正常工作；直连是能力协商成功后的加速路径，不是前提。
- **D3 中继保持常连作为控制面**（技术决定）：在线状态（peer-joined/left）、解绑（1008/revoked）、直连信令都走现有中继 WS；直连只承载业务帧。回退 = 把发送目标切回中继 WS，不需要重建连接。反向不成立：中继 WS 断开不拆直连（AC1 前提）。
- **D4 信令走中继的 E2E 加密帧，host 声明能力、guest 发起 offer**（技术决定）：SDP / ICE candidate 作为新增 `HostToPhone` / `PhoneToHost` 帧类型经中继转发，中继不感知、不需要重新部署；候选地址不暴露给中继。host 在既有 `host-info` 帧声明 `capabilities`，guest 收到才发 offer → 旧桌面永不收到未知帧，零告警。
- **D7 main 侧 WebRTC 选 `node-datachannel`**（研究结论，`research/webrtc-electron-main.md`）：N-API 8 预编译、上游支持 Electron 与 Safari 互通。备选 `werift`（纯 TS），仅替换 adapter。原生模块加载失败 → host 不声明能力，退化为现状。
- **D5 LAN + STUN 打洞，不用 TURN**（用户确认，覆盖早先的 LAN-only）：ICE 同一轮 gathering 产出 host + srflx 候选，优先内网对；中继本身就是兕底，不引入 TURN。STUN 并行配 `stun.cloudflare.com:3478` + `stun.miwifi.com:3478` + `stun.chat.bilibili.com:3478`（国内地址为社区公开、无 SLA，失效仅少一份候选不影响其余）。列表由 host 在 `host-info` 下发，手机跟随桌面配置，日后换地址/可配置只改桌面端。
- **D6 最小通道指示**（用户确认）：桌面设置页设备行与手机状态条各显示「直连 / 中继」只读标签；状态载荷新增 `transport: 'relay' | 'direct'`，不加任何设置开关。

## Requirements

- R1 能力协商：新端在进房后声明支持直连；仅当双方都声明才发起 WebRTC 协商。对端未声明（旧版）→ 保持中继，不产生错误、不重试风暴。
- R2 直连建立：双方在同一内网时，通过中继信令交换 SDP/ICE，建立 DataChannel；建立成功后业务帧改走 DataChannel。
- R3 帧格式不变：DataChannel 上传输的仍是 `sealFrame` 密文帧，与中继通道同一 contentKey、同一解析路径。
- R4 回退：DataChannel 关闭 / ICE 断连 / 网络指纹变化 / 心跳超时 → 立即切回中继发送；期间不丢帧语义靠既有游标 + snapshot 恢复。
- R5 重试：回退后按退避重试直连；网络变化事件触发立即重新协商。
- R6 中继与旧端零破坏：`packages/relay` 无需改动即可支撑本功能；旧桌面 × 新手机、新桌面 × 旧手机、旧 × 旧三种组合行为与现状一致。
- R7 候选范围：ICE 允许 `typ host` 与 `typ srflx`，拒绝 `typ relay`（不配 TURN）；协商 15s 超时即放弃回中继。对称 NAT / 运营商 NAT / AP isolation / VPN / iOS 本地网络权限被拒导致的失败都是正常回退，不提示错误。
- R10 STUN 配置随 host：`host-info` 下发 `iceServers` 列表，guest 不硬编码；缺省（理论上不会，因为 caps 与 iceServers 同帧）则不发起。
- R8 通道可观测：`PairStatusDevice` / `RemoteNodeStatus` 新增可选 `transport` 字段，手机 `ClientEvents` 新增 `onTransport` 回调（`ConnState` 枚举不变）；桌面设备行「在线」旁与手机状态条显示对应标签；切换时实时更新。
- R9 安全不退化：SDP 指纹经 E2E 信道交换，DataChannel 上仍是 `sealFrame` 密文；STUN 服务商只见公网 IP，不见内容与配对关系。

## Acceptance Criteria

- AC1 同一 Wi‑Fi 下新桌面 + 新手机：进房后 10s 内建立直连；断开中继网络（如屏蔽 relay 域名）后流式输出继续正常。
- AC2 手机切到蜂窝网络：数秒内回退中继，会话继续；随后若 NAT 可打洞则 15s 内重建直连（标签「直连」），否则维持中继不报错；回到 Wi‑Fi 后重新直连。
- AC8 跨网直连验证：桌面在家庭宽带（普通 NAT）、手机在蜂窝网络，至少一种运营境下能建立直连且选中候选对为 srflx/prflx；屏蔽全部 STUN 地址后仍能 LAN 直连。
- AC3 旧桌面 + 新手机：手机不报错、不反复重试，行为与现状一致。
- AC4 新桌面 + 旧 PWA（service worker 缓存）：桌面不报错，走中继。
- AC5 `packages/relay` 无 diff；relay 单测不变。
- AC6 纯逻辑（能力协商状态机、通道选择/回退决策、信令帧解析、分片编解码）有 vitest 覆盖，遵循 TDD。
- AC7 直连建立/回退时，桌面设备行与手机状态条标签在 1s 内切换为「直连」/「中继」。

## Out of Scope

- TURN 中转（中继已承担该角色）。
- STUN 地址用户可配置（机制已预留：host 下发）。
- 中继端任何改动。
- 直连通道承载在线状态 / 解绑语义（仍由中继负责）。
- 文件/大对象传输优化。

## Risks / Deferred

- 原生模块打包：需在每个目标平台用安装后产物验证 `.node` 可加载（implement.md 步骤 0 spike gate）；失败不阻塞发版，只是该平台无直连。
- 浏览器 mDNS `.local` 候选与 Electron 侧互通需真机（iPhone Safari）验证，属 spike 范围。
- 中继不可达但直连存活时，在线标签可能短暂不准（在线态仍以中继为源），接受。
- 国内公共 STUN 无 SLA，可能静默失效；并行配置下仅降低国内成功率，不影响正确性。地址列表集中在 main 侧一个常量。
- 对称 NAT 下打洞失败是预期行为（估计 30–50% 场景），靠中继兕底。
- 二期：`utilityProcess` 隔离原生崩溃。
