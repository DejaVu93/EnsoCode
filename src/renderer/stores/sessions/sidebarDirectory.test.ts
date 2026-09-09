import { describe, expect, it } from 'vitest';
import { selectSidebarConversations } from './sidebarDirectory';

const conv = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  projectId: 'p',
  title: 't',
  status: 'running',
  spawning: false,
  createdAt: 1,
  messages: [{ timestamp: 10, content: extra.text ?? 'x' }],
  coworkerIds: [],
  subagents: [],
  ...extra,
});

describe('selectSidebarConversations', () => {
  it('reuses the directory when only message text changes', () => {
    const first = selectSidebarConversations({ a: conv('a', { text: 'one' }) });
    const second = selectSidebarConversations({ a: conv('a', { text: 'two' }) });
    expect(second).toBe(first);
    expect(second.a.messages).toEqual([]);
    expect(second.a.lastActiveAt).toBe(10);
  });

  it('rebuilds when title or status changes', () => {
    const first = selectSidebarConversations({ a: conv('a') });
    const next = selectSidebarConversations({ a: conv('a', { title: 'u', status: 'idle' }) });
    expect(next).not.toBe(first);
    expect(next.a.title).toBe('u');
    expect(next.a.status).toBe('idle');
  });

  it('父会话 idle 但 coworker running 时投影 hasRunningChild，供侧栏蓝点', () => {
    const directory = selectSidebarConversations({
      parent: conv('parent', { status: 'idle', coworkerIds: ['kid'] }),
      kid: conv('kid', { status: 'running', parentId: 'parent' }),
    });
    expect(directory.parent.status).toBe('idle');
    expect(directory.parent.hasRunningChild).toBe(true);
    expect(directory.kid.hasRunningChild).toBe(false);
  });

  it('coworker 从 idle 变为 running 时重建目录，父条目 hasRunningChild 翻转', () => {
    const parent = conv('parent', { status: 'idle', coworkerIds: ['kid'] });
    const first = selectSidebarConversations({
      parent,
      kid: conv('kid', { status: 'idle', parentId: 'parent' }),
    });
    const second = selectSidebarConversations({
      parent,
      kid: conv('kid', { status: 'running', parentId: 'parent' }),
    });
    expect(second).not.toBe(first);
    expect(first.parent.hasRunningChild).toBe(false);
    expect(second.parent.hasRunningChild).toBe(true);
  });
});
