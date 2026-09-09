import { describe, expect, it } from 'vitest';
import { rewriteRemoteWorkingDirectoryPrompt, toPosixRemotePath } from './posixPath';

describe('toPosixRemotePath', () => {
  it('把 Windows 盘符根路径还原成 POSIX', () => {
    expect(toPosixRemotePath('D:/root/semble')).toBe('/root/semble');
    expect(toPosixRemotePath('D:\\root\\semble')).toBe('/root/semble');
    expect(toPosixRemotePath('/root/semble')).toBe('/root/semble');
  });
});

describe('rewriteRemoteWorkingDirectoryPrompt', () => {
  it('替换 SDK 写进提示词的本地盘符 cwd', () => {
    const prompt = 'Guidelines:\n- Be concise\n\nCurrent working directory: D:/root/semble\n';
    expect(rewriteRemoteWorkingDirectoryPrompt(prompt, 'D:/root/semble', 'user@box')).toContain(
      'Current working directory: /root/semble (via SSH: user@box)'
    );
    expect(rewriteRemoteWorkingDirectoryPrompt(prompt, '/root/semble', 'user@box')).not.toContain(
      'D:/root/semble'
    );
  });

  it('没有 cwd 行时追加远程工作目录', () => {
    expect(
      rewriteRemoteWorkingDirectoryPrompt('You are a coding assistant.', '/opt/app', 'h')
    ).toBe('You are a coding assistant.\n\nCurrent working directory: /opt/app (via SSH: h)');
  });
});
