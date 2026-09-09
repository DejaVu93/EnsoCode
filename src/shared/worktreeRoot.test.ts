import { describe, expect, it } from 'vitest';
import { isAbsolutePathLike, resolveWorktreeRoot } from './worktreeRoot';

const FALLBACK = '/Users/me/Library/Application Support/enso/worktrees';

describe('resolveWorktreeRoot', () => {
  it('未设置或类型不对时回落默认目录', () => {
    expect(resolveWorktreeRoot(undefined, FALLBACK)).toBe(FALLBACK);
    expect(resolveWorktreeRoot(null, FALLBACK)).toBe(FALLBACK);
    expect(resolveWorktreeRoot(42, FALLBACK)).toBe(FALLBACK);
    expect(resolveWorktreeRoot({ path: '/tmp/x' }, FALLBACK)).toBe(FALLBACK);
  });

  it('空串或纯空白回落默认目录', () => {
    expect(resolveWorktreeRoot('', FALLBACK)).toBe(FALLBACK);
    expect(resolveWorktreeRoot('   ', FALLBACK)).toBe(FALLBACK);
  });

  it('相对路径不被接受', () => {
    expect(resolveWorktreeRoot('foo/bar', FALLBACK)).toBe(FALLBACK);
    expect(resolveWorktreeRoot('./x', FALLBACK)).toBe(FALLBACK);
    expect(resolveWorktreeRoot('../x', FALLBACK)).toBe(FALLBACK);
    expect(resolveWorktreeRoot('~/worktrees', FALLBACK)).toBe(FALLBACK);
  });

  it('绝对路径去掉首尾空白后原样返回', () => {
    expect(resolveWorktreeRoot(' /tmp/x ', FALLBACK)).toBe('/tmp/x');
  });

  it('接受 Windows 盘符与 UNC 路径', () => {
    expect(resolveWorktreeRoot('C:\\wt', FALLBACK)).toBe('C:\\wt');
    expect(resolveWorktreeRoot('D:/wt', FALLBACK)).toBe('D:/wt');
    expect(resolveWorktreeRoot('\\\\srv\\share', FALLBACK)).toBe('\\\\srv\\share');
  });
});

describe('isAbsolutePathLike', () => {
  it('区分绝对与相对路径', () => {
    expect(isAbsolutePathLike('/tmp')).toBe(true);
    expect(isAbsolutePathLike('C:\\wt')).toBe(true);
    expect(isAbsolutePathLike('\\\\srv\\share')).toBe(true);
    expect(isAbsolutePathLike('tmp')).toBe(false);
    expect(isAbsolutePathLike('')).toBe(false);
  });
});
