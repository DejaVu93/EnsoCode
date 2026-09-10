import type { FilesReadRelResult } from '@shared/types/filesWorkspace';
import { describe, expect, it, vi } from 'vitest';
import { readWorkspaceDocument, refreshWorkspaceDocument } from './filesWorkspaceRefresh';

const doc = {
  rel: 'file.ts',
  contents: 'main',
  draft: 'main',
  version: 2,
  dirty: false,
  conflict: false,
};
describe('分支切换后的文件内容刷新', () => {
  it('已保存文件读取新内容并更新编辑器版本，不丢失 tab 标识', () => {
    expect(refreshWorkspaceDocument(doc, 'feature')).toEqual({
      ...doc,
      contents: 'feature',
      draft: 'feature',
      version: 3,
      tooLarge: false,
    });
  });
  it('未保存草稿遇到其他分支内容只标记冲突，不覆盖文本或版本', () => {
    const dirty = { ...doc, draft: 'unsaved', dirty: true };
    expect(refreshWorkspaceDocument(dirty, 'feature')).toEqual({ ...dirty, conflict: true });
  });
  it('新分支删除文件或读取失败仍保留草稿并标记冲突', () => {
    const dirty = { ...doc, draft: 'unsaved', dirty: true };
    expect(refreshWorkspaceDocument(dirty, null)).toEqual({ ...dirty, conflict: true });
  });
  it('磁盘未变化不制造编辑器重建，已有草稿不因相同内容变成已保存', () => {
    expect(refreshWorkspaceDocument(doc, 'main')).toBe(doc);
    const dirty = { ...doc, draft: 'unsaved', dirty: true };
    expect(refreshWorkspaceDocument(dirty, 'main')).toBe(dirty);
    expect(refreshWorkspaceDocument(dirty, 'unsaved')).toBe(dirty);
  });
});

describe('工作区读盘的代次守卫', () => {
  it('切换在途不读取会短暂不一致的磁盘内容', async () => {
    const read = vi.fn(async (): Promise<FilesReadRelResult> => ({ ok: true, content: 'old' }));
    expect(await readWorkspaceDocument(read, () => ({ revision: 1, migrating: true }))).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['revision', 'migrating'] as const)(
    '请求未完成时 %s 改变，旧分支内容不得应用到编辑器',
    async (change) => {
      const state = { revision: 1, migrating: false };
      let resolve!: (value: FilesReadRelResult) => void;
      const promise = readWorkspaceDocument(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
        () => state
      );
      if (change === 'revision') state.revision += 1;
      else state.migrating = true;
      resolve({ ok: true, content: 'old branch' });
      expect(await promise).toBeNull();
    }
  );
  it('当前代次保留成功内容与结构化失败，不把读取失败当空文件', async () => {
    const state = () => ({ revision: 2, migrating: false });
    expect(await readWorkspaceDocument(async () => ({ ok: true, content: 'new' }), state)).toEqual({
      ok: true,
      content: 'new',
    });
    expect(
      await readWorkspaceDocument(async () => ({ ok: false, error: 'missing' }), state)
    ).toEqual({ ok: false, error: 'missing' });
  });
});
