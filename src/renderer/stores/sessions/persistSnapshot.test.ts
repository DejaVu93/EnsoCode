import { describe, expect, it } from 'vitest';
import { cachedPartializeSessions } from './persistSnapshot';

const conv = (id: string, extra: { title?: string; text?: string } = {}) => ({
  id,
  projectId: 'p',
  title: extra.title ?? id,
  started: true,
  spawning: false,
  createdAt: 1,
  sessionFile: '/tmp/a.jsonl',
  status: 'running' as const,
  messages: [
    { timestamp: 10, role: 'assistant', content: [{ type: 'text', text: extra.text ?? 'x' }] },
  ],
  commands: [{ name: 'x' }],
  customEntries: [1],
  lastSeq: 99,
  lastOutputAt: 8,
});

describe('cachedPartializeSessions', () => {
  it('strips messages and returns the same object when only transcript changes', () => {
    const first = cachedPartializeSessions({
      conversations: { a: conv('a', { text: 'one' }) },
      order: ['a'],
      activeId: 'a',
    });
    const second = cachedPartializeSessions({
      conversations: { a: conv('a', { text: 'two' }) },
      order: ['a'],
      activeId: 'a',
    });
    expect(first).toBe(second);
    expect(first.conversations.a.messages).toEqual([]);
    expect(first.conversations.a.lastActiveAt).toBe(10);
    expect(first.conversations.a.status).toBe('idle');
    expect(first.conversations.a.toolOutputs).toEqual({});
    expect(first.conversations.a.toolStartedAt).toEqual({});
  });

  it('rebuilds when a persisted field changes', () => {
    const first = cachedPartializeSessions({
      conversations: { a: conv('a') },
      order: ['a'],
      activeId: 'a',
    });
    const next = cachedPartializeSessions({
      conversations: { a: conv('a', { title: 'renamed' }) },
      order: ['a'],
      activeId: 'a',
    });
    expect(next).not.toBe(first);
    expect(next.conversations.a.title).toBe('renamed');
  });
});
