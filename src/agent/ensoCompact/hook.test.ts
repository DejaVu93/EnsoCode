import { describe, expect, it } from 'vitest';
import { createEnsoCompactFactory } from './extension';

type Hook = (event: unknown, ctx: unknown) => unknown;

describe('enso compact hook', () => {
  it('过短会话让出原生', async () => {
    let handler: Hook | undefined;
    createEnsoCompactFactory({ mode: 'balanced' })({
      on(name: string, fn: (...args: never[]) => unknown) {
        if (name === 'session_before_compact') handler = fn as Hook;
      },
    } as never);
    const result = await handler?.(
      {
        reason: 'manual',
        branchEntries: [{ type: 'message', message: { role: 'user', content: 'hi' } }],
        preparation: { tokensBefore: 100, firstKeptEntryId: 'keep' },
        signal: new AbortController().signal,
      },
      {
        sessionManager: { getBranch: () => [] },
        modelRegistry: { find: () => undefined, complete: async () => ({}) },
      }
    );
    expect(result).toBeUndefined();
  });

  it('手动 compact 不因占用低而让出，并交 fromHook 摘要', async () => {
    let handler: Hook | undefined;
    createEnsoCompactFactory({
      mode: 'fast',
      summaryModel: { provider: 'enso-test', id: 'cheap' },
    })({
      on(name: string, fn: (...args: never[]) => unknown) {
        if (name === 'session_before_compact') handler = fn as Hook;
      },
    } as never);
    const branch = [
      {
        type: 'message',
        message: { role: 'user', content: 'MUST keep dark mode. Goal: ship checkout.' },
      },
      { type: 'message', message: { role: 'assistant', content: 'Error: boom' } },
      { type: 'message', message: { role: 'user', content: 'fix src/app.ts' } },
    ];
    const result = (await handler?.(
      {
        reason: 'manual',
        branchEntries: branch,
        preparation: { tokensBefore: 800, firstKeptEntryId: 'keep-1' },
        signal: new AbortController().signal,
      },
      {
        sessionManager: { getBranch: () => branch },
        model: { id: 'session' },
        modelRegistry: {
          find: () => ({ id: 'cheap', provider: 'enso-test' }),
          complete: async () => ({
            content: [{ type: 'text', text: '# Progress\n- started' }],
          }),
        },
      }
    )) as { compaction?: { summary?: string; tokensBefore?: number } } | undefined;
    expect(result?.compaction?.tokensBefore).toBe(800);
    expect(result?.compaction?.summary).toMatch(/Goal/);
    expect(result?.compaction?.summary).toMatch(/dark mode/);
  });
});
