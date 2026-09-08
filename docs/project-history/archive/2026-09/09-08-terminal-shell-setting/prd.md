# 侧边栏终端可配置 shell

## 背景

侧边栏终端（`terminalService.localShellSpec`）本地 pty 固定读 `COMSPEC`（Windows）/ `SHELL`（其它），用户想换 pwsh 只能改系统环境变量。现有 `windowsLocalShell` 设置只管 agent 命令工具，09-05 任务明确把侧边栏默认壳留作另开任务。

## 目标

新增设置项 `terminalShell`，决定本地侧边栏终端 spawn 的可执行文件。仅影响本地 pty；SSH 项目仍走 `ssh`，远端登录壳不动。

## 非目标

- 不改 agent 命令工具的选壳（`windowsLocalShell`）
- 不给已打开的 terminal tab 热切换
- 不做自由路径输入（二期）
- 不做 shell 参数（`-l` 等）

## 需求

1. `src/shared/terminalShell.ts`：预设枚举 + `parseTerminalShell`（脏值→`auto`）+ 纯函数 `resolveTerminalShellFile(pref, platform, env)` 返回可执行文件名。
   - `auto`：Win = `COMSPEC || cmd.exe`；其它 = `SHELL || /bin/zsh`（现有行为）
   - Win 预设：`cmd`、`powershell`、`pwsh`、`git-bash`（`bash.exe`）
   - 非 Win 预设：`zsh`、`bash`、`fish`
   - 平台不匹配的预设当 `auto`
2. `localShellSpec(cwd, shellFile?)` 接受可执行文件；`resolveSpawnSpec` 从 `readSettings()` 读 `terminalShell` 传入。
3. 渲染层 settings store：字段 `terminalShell`、`setTerminalShell`，rehydrate 时规范化；`SETTINGS_STATE_FIELDS` 登记；config-sync 排除（机本地）。
4. 设置 UI：Appearance 页终端区新增 Select，按当前平台只列本平台预设 + Auto；文案注明「新开终端生效，SSH 不受影响」。
5. 搜索目录 `searchAnything` 登记 `appearance.terminalShell`。
6. 缺可执行文件由 node-pty spawn 报错，已有 `createTerminal` catch 返回 `ok:false`，不额外处理。

## 验收

- 单测：`parseTerminalShell` 脏值回落；`resolveTerminalShellFile` 覆盖 auto/各预设/平台不匹配。
- `pnpm typecheck && pnpm test` 通过，`biome check` 干净。
- macOS 上选 `bash` 后新开终端为 bash；Auto 行为与改前一致。
