import { describe, expect, it } from 'vitest';
import {
  parseTerminalShell,
  resolveTerminalShellFile,
  terminalShellsForPlatform,
} from './terminalShell';

describe('parseTerminalShell', () => {
  it('合法值原样返回', () => {
    expect(parseTerminalShell('pwsh')).toBe('pwsh');
    expect(parseTerminalShell('zsh')).toBe('zsh');
  });

  it('脏值回落 auto', () => {
    expect(parseTerminalShell('nushell')).toBe('auto');
    expect(parseTerminalShell(undefined)).toBe('auto');
    expect(parseTerminalShell(42)).toBe('auto');
  });
});

describe('resolveTerminalShellFile', () => {
  it('auto 在 win32 读 COMSPEC,缺省 cmd.exe', () => {
    expect(resolveTerminalShellFile('auto', 'win32', { COMSPEC: 'C:\\x\\cmd.exe' })).toBe(
      'C:\\x\\cmd.exe'
    );
    expect(resolveTerminalShellFile('auto', 'win32', {})).toBe('cmd.exe');
  });

  it('auto 在非 win32 读 SHELL,缺省 /bin/zsh', () => {
    expect(resolveTerminalShellFile('auto', 'darwin', { SHELL: '/bin/bash' })).toBe('/bin/bash');
    expect(resolveTerminalShellFile('auto', 'linux', {})).toBe('/bin/zsh');
  });

  it('win32 预设映射到可执行文件名', () => {
    expect(resolveTerminalShellFile('cmd', 'win32', {})).toBe('cmd.exe');
    expect(resolveTerminalShellFile('powershell', 'win32', {})).toBe('powershell.exe');
    expect(resolveTerminalShellFile('pwsh', 'win32', {})).toBe('pwsh.exe');
    expect(resolveTerminalShellFile('git-bash', 'win32', {})).toBe('bash.exe');
  });

  it('非 win32 预设映射到 shell 名', () => {
    expect(resolveTerminalShellFile('zsh', 'darwin', {})).toBe('zsh');
    expect(resolveTerminalShellFile('bash', 'linux', {})).toBe('bash');
    expect(resolveTerminalShellFile('fish', 'darwin', {})).toBe('fish');
  });

  it('平台不匹配的预设当 auto', () => {
    expect(resolveTerminalShellFile('pwsh', 'darwin', { SHELL: '/bin/zsh' })).toBe('/bin/zsh');
    expect(resolveTerminalShellFile('fish', 'win32', {})).toBe('cmd.exe');
  });
});

describe('terminalShellsForPlatform', () => {
  it('只列本平台预设,auto 居首', () => {
    expect(terminalShellsForPlatform('win32')).toEqual([
      'auto',
      'cmd',
      'powershell',
      'pwsh',
      'git-bash',
    ]);
    expect(terminalShellsForPlatform('darwin')).toEqual(['auto', 'zsh', 'bash', 'fish']);
  });
});
