import { describe, expect, it } from 'vitest';
import { resolveNewSessionProjectId } from './NewSessionSheet';

const projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('resolveNewSessionProjectId', () => {
  it('空列表返回空串', () => {
    expect(resolveNewSessionProjectId([], null, 'a')).toBe('');
  });

  it('无预填、无手选时回落列表第一项', () => {
    expect(resolveNewSessionProjectId(projects, null)).toBe('a');
    expect(resolveNewSessionProjectId(projects, null, null)).toBe('a');
  });

  it('项目旁新会话预填该项目', () => {
    expect(resolveNewSessionProjectId(projects, null, 'b')).toBe('b');
  });

  it('预填不在列表中时回落第一项', () => {
    expect(resolveNewSessionProjectId(projects, null, 'missing')).toBe('a');
  });

  it('用户手选覆盖预填', () => {
    expect(resolveNewSessionProjectId(projects, 'c', 'b')).toBe('c');
  });

  it('手选不在列表中时回落预填', () => {
    expect(resolveNewSessionProjectId(projects, 'gone', 'b')).toBe('b');
  });
});
