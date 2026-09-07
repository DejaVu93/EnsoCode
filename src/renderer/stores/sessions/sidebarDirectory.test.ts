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
});
