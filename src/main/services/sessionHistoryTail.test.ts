import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as projection from '../../agent/projection';
import { projectParentHistoryTail, resolveParentHistoryFile } from './sessionHistoryTail';

const sessionDir = '/tmp/agent/sessions';

describe('resolveParentHistoryFile', () => {
  it('accepts a file inside the sessions directory', () => {
    expect(
      resolveParentHistoryFile(sessionDir, path.join(sessionDir, '2026-01-01T00-00-00-000Z.jsonl'))
    ).toBe(path.resolve(sessionDir, '2026-01-01T00-00-00-000Z.jsonl'));
  });

  it('rejects traversal and missing files', () => {
    expect(
      resolveParentHistoryFile(sessionDir, path.join(sessionDir, '../escape.jsonl'))
    ).toBeNull();
    expect(resolveParentHistoryFile(sessionDir, undefined)).toBeNull();
    expect(resolveParentHistoryFile(sessionDir, '')).toBeNull();
  });
});

describe('projectParentHistoryTail', () => {
  it('projects and windows from the end', () => {
    const branch = [
      {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 },
      },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 2 },
      },
      { type: 'custom', customType: 'other', data: {} },
    ];
    const tail = projectParentHistoryTail(branch as never);
    expect(tail.baseIndex).toBe(0);
    expect(tail.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 2 },
    ]);
  });

  it('drops unprojected fields', () => {
    const tail = projectParentHistoryTail([
      {
        type: 'message',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
          providerData: { secret: true },
        },
      },
    ] as never);
    expect(tail.messages[0]).not.toHaveProperty('providerData');
  });

  it('先截尾窗再投影，不扫整卷', () => {
    const spy = vi.spyOn(projection, 'projectMessage');
    const branch = Array.from({ length: 80 }, (_, i) => ({
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: `m${i}` }], timestamp: i },
    }));
    const tail = projectParentHistoryTail(branch as never);
    expect(tail.baseIndex).toBe(20);
    expect(tail.messages).toHaveLength(60);
    expect(spy).toHaveBeenCalledTimes(60);
    spy.mockRestore();
  });
});
