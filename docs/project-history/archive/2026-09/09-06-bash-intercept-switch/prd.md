# Bash intercept switch (default off)

## Goal

给「shell 拦截：禁止用 cat/head/grep/sed -i 等读写文件，强制走 read/grep/edit/write/find」加一个用户开关。默认关闭，打开后才拦截并改 bash 工具描述。

## Requirements

- 设置里提供开关，默认关。旧配置没有该字段时视为关，不需要 migrate 升版本。
- 关：不拦截命令、不往 bash 描述追加拦截 hint；agent 可用 shell 读文件。
- 开：保持现有拦截规则与 hint；新会话生效（与 explore-fold / smart compact 一致）。
- 开关放在 Built-in tools 页，靠近 Explore fold。
- 沿用现有设置字段链路：settings store → persist → spawn-parent 布尔字段 → supervisor 决定是否 wrap `withBashInterception`。缺省不传字段 = 关。

## Out of scope

- 不改拦截规则本身（哪些命令挡、建议哪个工具）。
- 不做 capability / Enso 远程开关。
- 不改已有会话的运行时行为。

## Acceptance Criteria

- [x] 新用户与未写过该字段的旧 settings：拦截关闭，`cat file` 可执行。
- [x] 打开开关后新开会话：匹配规则的命令被 block，并提示改用对应工具；bash 描述含拦截 hint。
- [x] 关掉开关后新开会话：不再 block，描述无 hint。
- [x] `parseAgentCommand` 接受合法布尔、拒绝脏值；缺省字段仍合法。
- [x] `checkBashInterception` 规则测试保持绿色（规则本身不变）。
