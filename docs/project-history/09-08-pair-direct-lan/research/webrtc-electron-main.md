# Electron main WebRTC DataChannel 选型研究

> 调研日期：2026-09-08。范围：Electron main ↔ iOS Safari/PWA 或另一桌面端，LAN-only host ICE；中继始终作为控制面与数据回退。

## 结论

**首选 `node-datachannel@0.33.2`，备选 `werift@0.24.4`，不采用隐藏 `BrowserWindow`。**

1. `node-datachannel` 是 libdatachannel 的 N-API 8 绑定；上游明确支持 Electron，libdatachannel 明确列出 Chromium、Firefox、Safari 互通及 mDNS candidate。它的协议成熟度、浏览器互通证据、CPU/内存效率最适合作为生产实现。
2. `werift` 是纯 TypeScript，无 ABI/签名/原生打包风险，保留同一 `DirectPeer` adapter 作为某个平台原生包验证失败时的替换实现。不要一期同时打包两个栈；原生加载失败时首先不声明 `direct-v1`，无感走既有 relay。
3. 隐藏 `BrowserWindow` 虽可直接使用 Chromium `RTCPeerConnection`，但会增加 renderer/preload/IPC、生命周期和崩溃恢复，以及显著常驻内存；它只适合作为定位 native↔Safari 互通问题的实验基线，不是产品 fallback。
4. 产品级最终 fallback 永远是现有加密 relay，而不是强行启动第二套 WebRTC 栈。

## 方案对比

| 维度 | `node-datachannel` | `werift` | 隐藏 `BrowserWindow` |
|---|---|---|---|
| 运行位置 | main 或 `utilityProcess` | main 或 `utilityProcess` | Chromium renderer |
| 实现 | C++ libdatachannel + N-API | TS 实现 ICE/DTLS/SCTP | Chromium WebRTC |
| 浏览器互通证据 | 上游明确 Chromium/Firefox/Safari | Chromium E2E、Firefox runner；Safari 为社区验证，非 CI | 与 Electron 所带 Chromium 一致 |
| mDNS remote candidate | libdatachannel 明确支持 | `multicast-dns` 查询 `.local` A 记录 | Chromium 内建 |
| 打包风险 | 平台 `.node`、签名、optional dependency | 无 native ABI；依赖树较大 | 无 npm native 包，但需新增 renderer 资产 |
| 资源/性能 | 最优，协议在线程/原生层 | JS CPU/GC 风险更高 | 额外 renderer 常驻开销最高 |
| 运维复杂度 | 中 | 低到中 | 高 |
| 建议 | **一期首选** | **构建级备选** | 不采用 |

## `node-datachannel` 评估

- npm 版本 `0.33.2`，Node 要求 `>=18.20.0`，许可证 MPL-2.0；Electron 43 的 Node 基线满足要求。
- 主包仅直接依赖 `detect-libc`；native binary 由 optional platform packages 提供。macOS x64/arm64、Windows x64/arm64、Linux glibc/musl x64/arm64 均有 prebuild。
- 当前各平台包解包约 7.5–9.1 MB，且只有两个文件；安装时只会选择当前平台包。跨 OS 出包必须在目标 OS 构建，或显式保证目标 optional package 被带入。
- N-API 8 不绑定 Electron 的 Node module ABI；上游 Electron demo 说明通常无需 `electron-rebuild`。这比基于 V8 ABI 的 addon 风险低。
- API 直接覆盖需求：`PeerConnection`、offer/answer、local candidate、`DataChannel`、binary message、buffered amount、`maxMessageSize()`；配置支持 `iceServers`、`bindAddress`、port range、`maxMessageSize`。
- `iceServers: []` 可实现 host-only。仍须在 adapter 的 candidate 出口只允许 `typ host`，防止未来配置或库默认变化。
- libdatachannel 默认本地 SCTP 上限 256 KiB；远端 SDP 未声明时按 65,536 bytes。协议层固定 16 KiB 分片是合理的跨实现安全值。

### 本仓库打包注意点

- `package.json` 已允许 native 安装，且 `postinstall` 调用 `electron-builder install-app-deps`；但 `electron-builder.yml` 为 `npmRebuild: false`。对 N-API prebuild 这是可接受的，不应触发源码编译。
- `node-datachannel` 本身没有 install lifecycle build，正常不必加入 `pnpm.onlyBuiltDependencies`；若未来退回源码编译，才需放行并引入 CMake 工具链。
- 将依赖保持 external，不能让 electron-vite 打包器内联动态 platform `require()`；确保平台 optional package 与 `.node` 均进入产物。
- electron-builder 通常会 smart-unpack `.node`，但应在配置中显式验证/必要时设置 `asarUnpack`。分别对 macOS arm64/x64、Windows x64、Linux x64 做**安装后产物**加载测试，而不只测开发环境。
- macOS notarization、Windows 安装包、Linux glibc/musl 各跑一次 `require('node-datachannel')` + 本机 loopback DataChannel smoke test。
- adapter 必须 lazy import；加载异常只记录一次并返回 `null`，host 不发布 capability，不能让 main 启动失败。
- 若需隔离极少见的 native crash，可后续移入 Electron `utilityProcess` 并用 MessagePort 桥接。`utilityProcess` 只是 Node 子进程替代品，本身没有 DOM/`RTCPeerConnection`。

## `werift` 评估

- npm 版本 `0.24.4`，Node 要求 `>=16`，MIT；主包自身解包约 4.2 MB，但另有 x509、crypto、`mediabunny`、`multicast-dns` 等依赖，不能只按主包大小估算产物。
- 完整实现 ICE/DTLS/SCTP/DataChannel，API 接近浏览器；支持 `iceServers: []`、candidate 事件、端口范围和 `maxMessageSize`。默认消息上限 65,536 bytes。
- `.local` remote candidate 会经 `multicast-dns` 查询 A 记录，当前实现超时 10 秒；只观察第一条 A answer，IPv6-only/复杂 mDNS 环境必须实测。
- 优点是纯 JS/TS、跨平台一致、调试容易、无 code signing/ABI 问题。
- 风险是 WebRTC 协议栈由 JS 承担，长期流式发送的 CPU、GC、背压表现需压测；Safari 互通是社区报告，不是自动化 Safari 矩阵。
- 采用条件：任一目标平台的 `node-datachannel` packaged smoke test 无法稳定通过，或 native 包显著阻塞发布。届时只替换 `DirectPeer` adapter，不改状态机/协议。

## 为什么不选隐藏 `BrowserWindow`

- Electron main/`utilityProcess` 没有 WebRTC Web API；只能创建 `show: false` 的 renderer，通过 preload 暴露严格 IPC。
- 必须处理 renderer crash、app suspend、窗口销毁、IPC 二进制复制/转移、CSP 和 capability 生命周期；业务本来在 main，会形成反向代理层。
- 隐藏页面还受 Chromium background 行为影响；即使设置 `backgroundThrottling: false`，也不能消除 OS 挂起或 renderer 崩溃。
- 优点仅是 Chromium wire compatibility 最强且无需 native npm addon。可做诊断 spike：若它能连 iPhone 而两个 Node 栈不能，说明问题在 native ICE/mDNS 互通，而非网络。

## 浏览器 mDNS 与 iOS 约束

- 浏览器通常把 host candidate 的私网 IP 替换为随机 `.local` 名，以避免向信令方泄露 LAN IP；**不能丢弃 `.local` 的 `typ host` candidate，也不能只接受 IPv4 字面量**。
- 首选库与备选库都具备 mDNS resolution。即使解析失败，只要桌面发送的 host candidate 可达，Safari 主动发来的 ICE connectivity check 仍可能让桌面形成 peer-reflexive remote candidate；这可提高成功率，但不应替代 mDNS 测试。
- mDNS 依赖同一 multicast domain。访客 Wi‑Fi/AP client isolation、不同 VLAN、企业防火墙、VPN、IPv6-only 或系统防火墙都可能使“同一 SSID”仍无法直连；这是正常 relay fallback，不应提示错误或无限快速重试。
- iOS 的 Local Network privacy 可能弹窗、被用户拒绝或被策略限制；被拒绝时 LAN ICE 可能失败。应用无法假设权限已授予，也不应把直连作为配对成功前提。
- iOS Safari/PWA 在后台、锁屏或被系统回收时不保证 JS timer 与连接存活；回到前台应立即销毁旧 generation、切 relay 并重新协商，不能依赖后台心跳。
- DataChannel 最大消息在实现间协商且历史差异较大；沿用设计中的 reliable/ordered channel + 16 KiB 分片 + 1 MiB 总帧上限。发送还需看 `bufferedAmount`/low 事件，不能无界排队。
- 不配置 STUN/TURN 意味着只覆盖真实 LAN 可达路径；候选结束后无成功 pair 或 8 秒超时即放弃，不能等待浏览器较长的默认 ICE timeout。

## 最小 `DirectPeer` API

```ts
type DirectCandidate = { candidate: string; sdpMid: string | null }
type Unsubscribe = () => void

interface DirectPeer {
  createOffer(): Promise<string>                 // guest 创建 ordered channel
  acceptOffer(sdp: string): Promise<string>      // host 等待 ondatachannel，返回 answer
  acceptAnswer(sdp: string): Promise<void>
  addIceCandidate(candidate: DirectCandidate): Promise<void>

  onIceCandidate(cb: (candidate: DirectCandidate) => void): Unsubscribe
  onOpen(cb: () => void): Unsubscribe
  onMessage(cb: (bytes: Uint8Array) => void): Unsubscribe
  onClose(cb: () => void): Unsubscribe
  onFailed(cb: (error?: Error) => void): Unsubscribe

  send(bytes: Uint8Array): boolean               // false = 未 open 或背压拒绝
  close(): void                                  // 幂等，不再触发业务回调
}

type DirectPeerFactory = () => DirectPeer | null
```

约束：factory 每代只建一个 peer；先注册回调再开始 SDP；candidate adapter 只发 `typ host` 且保留 `.local`/IPv6；所有库异常归一到单次 `onFailed`；`close()` 后忽略迟到 callback。SDP 与 candidate 仍通过 E2E relay 信令，DataChannel payload 仍是 `sealFrame`，接口不接触业务明文。

## 落地门槛

1. 先做独立 adapter spike：Electron packaged host ↔ Chrome/Android、Safari/iPhone、Electron guest，验证 offer/answer、trickle ICE、`.local`、16 KiB binary、断网 close。
2. 在支持矩阵每个平台验证 unpacked native addon 可加载、签名/安装后可运行；失败即不声明 capability。
3. iPhone 覆盖：允许/拒绝 Local Network、前后台、Wi‑Fi↔蜂窝、访客 Wi‑Fi/AP isolation；这些失败都必须快速回 relay。
4. 记录 selected candidate pair；同内网应落在 host/prflx 路径，跨网为 srflx/prflx；任何 `typ relay` 候选出现即视为过滤缺陷（本方案不配 TURN）。
   （注：调研初期范围为 LAN-only；后续 PRD D5 已扩为 LAN + STUN 打洞，本文其余结论——库选型、mDNS、打包、API 面——不受影响。）
5. 若 `node-datachannel` 仅在某平台不通过，先用 `werift` adapter 重测；隐藏 `BrowserWindow` 只用于对照诊断。

## 主要资料

- [`node-datachannel` README / Electron 与平台支持](https://github.com/murat-dogan/node-datachannel)
- [`node-datachannel` API](https://github.com/murat-dogan/node-datachannel/blob/master/API.md)
- [libdatachannel features：browser interoperability、mDNS candidate](https://github.com/paullouisageneau/libdatachannel#features)
- [`werift` README / interoperability](https://github.com/shinyoshiaki/werift-webrtc)
- [Electron Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [Electron `utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron `BrowserWindow` / `backgroundThrottling`](https://www.electronjs.org/docs/latest/api/browser-window)
- [WebRTC mDNS ICE candidates draft](https://datatracker.ietf.org/doc/html/draft-ietf-rtcweb-mdns-ice-candidates-04)
- [MDN `RTCSctpTransport.maxMessageSize`](https://developer.mozilla.org/docs/Web/API/RTCSctpTransport/maxMessageSize)
- [Apple：Local Network privacy](https://support.apple.com/102229)
