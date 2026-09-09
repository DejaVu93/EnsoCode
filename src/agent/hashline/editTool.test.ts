import { describe, expect, it, vi } from 'vitest';
import { createHashlineEditTool } from './editTool';

const handlers = () => ({
  applyReplace: vi.fn(async () => 'replace-result'),
  applyHashline: vi.fn(async () => 'hashline-result'),
});

describe('createHashlineEditTool', () => {
  it('replace 参数只交给原替换处理器', async () => {
    const callbacks = handlers();
    const tool = createHashlineEditTool(callbacks);
    const params = { path: '/a.ts', edits: [{ oldText: 'a', newText: 'b' }] };
    await expect(tool.execute('call-1', params)).resolves.toBe('replace-result');
    expect(callbacks.applyReplace).toHaveBeenCalledOnce();
    expect(callbacks.applyReplace).toHaveBeenCalledWith(params);
    expect(callbacks.applyHashline).not.toHaveBeenCalled();
  });

  it('Hashline 参数只交给补丁处理器', async () => {
    const callbacks = handlers();
    const tool = createHashlineEditTool(callbacks);
    const params = { input: 'PUT...' };
    await expect(tool.execute('call-2', params)).resolves.toBe('hashline-result');
    expect(callbacks.applyHashline).toHaveBeenCalledOnce();
    expect(callbacks.applyHashline).toHaveBeenCalledWith(params);
    expect(callbacks.applyReplace).not.toHaveBeenCalled();
  });

  it('input 混发空壳 edits 走补丁处理器', async () => {
    const empty = handlers();
    await createHashlineEditTool(empty).execute('call-3a', { input: 'PUT...', edits: [] });
    expect(empty.applyHashline).toHaveBeenCalledOnce();
    expect(empty.applyReplace).not.toHaveBeenCalled();

    const blank = handlers();
    await createHashlineEditTool(blank).execute('call-3c', {
      input: 'PUT...',
      edits: [{ oldText: '', newText: '' }],
    });
    expect(blank.applyHashline).toHaveBeenCalledOnce();
    expect(blank.applyReplace).not.toHaveBeenCalled();
  });

  it('input 混发非空 edits 时拒绝，两边处理器都不调用', async () => {
    const filled = handlers();
    const tool = createHashlineEditTool(filled);
    await expect(
      tool.execute('call-3b', {
        input: '[a#0000]',
        edits: [{ oldText: 'a', newText: 'b' }],
      })
    ).rejects.toThrow(/both|exactly one mode/i);
    expect(filled.applyReplace).not.toHaveBeenCalled();
    expect(filled.applyHashline).not.toHaveBeenCalled();
  });

  it('无效参数直接拒绝', async () => {
    const tool = createHashlineEditTool(handlers());
    await expect(tool.execute('call-4', {})).rejects.toThrow();
  });
});
