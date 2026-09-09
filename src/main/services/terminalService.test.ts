import { describe, expect, it } from 'vitest';
import { pickSessionCwd, resolvePtySize, withUtf8Locale } from './terminalService';

const exists = (dir: string) => dir === '/wt' || dir === '/proj';

describe('pickSessionCwd', () => {
  it('隔离会话用 worktree,不用项目根', () => {
    expect(
      pickSessionCwd({
        worktreePath: '/wt',
        projectPath: '/proj',
        home: '/home',
        exists,
      })
    ).toBe('/wt');
  });

  it('无 worktree 时用本地项目根,不落到 home', () => {
    expect(
      pickSessionCwd({ worktreePath: undefined, projectPath: '/proj', home: '/home', exists })
    ).toBe('/proj');
  });

  it('ssh 项目根是远端路径,不采用,无 worktree 时回落 home', () => {
    expect(
      pickSessionCwd({
        worktreePath: undefined,
        projectPath: '/opt/bot2api',
        ssh: true,
        home: '/home',
        exists: () => true,
      })
    ).toBe('/home');
  });

  it('worktree 目录已不存在时回落项目根', () => {
    expect(
      pickSessionCwd({
        worktreePath: '/gone',
        projectPath: '/proj',
        home: '/home',
        exists,
      })
    ).toBe('/proj');
  });
});

describe('resolvePtySize', () => {
  it('缺省落到 80x24', () => {
    expect(resolvePtySize()).toEqual({ cols: 80, rows: 24 });
  });

  it('0 或负数不当成有效尺寸', () => {
    expect(resolvePtySize(0, 0)).toEqual({ cols: 80, rows: 24 });
    expect(resolvePtySize(-1, 12)).toEqual({ cols: 80, rows: 12 });
  });
});

describe('withUtf8Locale', () => {
  it('Finder 启动常见的空 locale 补成 UTF-8，不掉 TERM', () => {
    const next = withUtf8Locale({ TERM: 'xterm-256color', TERM_PROGRAM: 'EnsoCode' });
    expect(next.TERM).toBe('xterm-256color');
    expect(next.LANG).toMatch(/utf-?8/i);
    expect(next.LC_CTYPE).toMatch(/utf-?8/i);
    expect(next.LC_ALL).toBeUndefined();
  });

  it('已是 UTF-8 的 LANG 不改', () => {
    expect(withUtf8Locale({ LANG: 'zh_CN.UTF-8' }).LANG).toBe('zh_CN.UTF-8');
  });

  it('LANG=C / POSIX 换成 UTF-8', () => {
    expect(withUtf8Locale({ LANG: 'C' }).LANG).toMatch(/utf-?8/i);
    expect(withUtf8Locale({ LANG: 'POSIX' }).LANG).toMatch(/utf-?8/i);
  });

  it('GBK 等非 UTF-8 编码改成 同语言.UTF-8，xterm 只走 UTF-8', () => {
    expect(withUtf8Locale({ LANG: 'zh_CN.GBK' }).LANG).toBe('zh_CN.UTF-8');
  });

  it('LC_ALL=C 会压过 LANG，必须一并改成 UTF-8', () => {
    const next = withUtf8Locale({ LANG: 'zh_CN.UTF-8', LC_ALL: 'C' });
    expect(next.LC_ALL).toMatch(/utf-?8/i);
    expect(next.LANG).toMatch(/utf-?8/i);
  });
});
