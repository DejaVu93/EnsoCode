/** 侧边栏终端本地 pty 用哪个 shell；只影响交互终端，不影响 agent 命令工具 */
export const WINDOWS_TERMINAL_SHELLS = ['cmd', 'powershell', 'pwsh', 'git-bash'] as const;
export const UNIX_TERMINAL_SHELLS = ['zsh', 'bash', 'fish'] as const;
export const TERMINAL_SHELLS = [
  'auto',
  ...WINDOWS_TERMINAL_SHELLS,
  ...UNIX_TERMINAL_SHELLS,
] as const;

export type TerminalShell = (typeof TERMINAL_SHELLS)[number];

const WINDOWS_FILES: Record<(typeof WINDOWS_TERMINAL_SHELLS)[number], string> = {
  cmd: 'cmd.exe',
  powershell: 'powershell.exe',
  pwsh: 'pwsh.exe',
  'git-bash': 'bash.exe',
};

export function parseTerminalShell(value: unknown): TerminalShell {
  return typeof value === 'string' && (TERMINAL_SHELLS as readonly string[]).includes(value)
    ? (value as TerminalShell)
    : 'auto';
}

export function terminalShellsForPlatform(platform: string): readonly TerminalShell[] {
  return ['auto', ...(platform === 'win32' ? WINDOWS_TERMINAL_SHELLS : UNIX_TERMINAL_SHELLS)];
}

/** 平台不匹配的预设按 auto 处理，auto 沿用系统默认（COMSPEC / SHELL） */
export function resolveTerminalShellFile(
  preference: TerminalShell,
  platform: string,
  env: Record<string, string | undefined>
): string {
  if (platform === 'win32') {
    if (preference in WINDOWS_FILES) return WINDOWS_FILES[preference as keyof typeof WINDOWS_FILES];
    return env.COMSPEC || 'cmd.exe';
  }
  if ((UNIX_TERMINAL_SHELLS as readonly string[]).includes(preference)) return preference;
  return env.SHELL || '/bin/zsh';
}
