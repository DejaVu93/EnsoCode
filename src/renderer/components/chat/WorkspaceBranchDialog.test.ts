import type { WorkspaceBranches } from '@shared/types/worktree';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceBranchDialog, type WorkspaceBranchDialogProps } from './WorkspaceBranchDialog';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return Object.fromEntries(
    [
      'Dialog',
      'DialogContent',
      'DialogHeader',
      'DialogTitle',
      'DialogDescription',
      'DialogPanel',
      'DialogFooter',
    ].map((key) => [key, Wrap])
  );
});
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    type,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    type?: 'button' | 'submit';
  }) => createElement('button', { disabled, type: type ?? 'button' }, children),
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => createElement('input', props),
}));

const data: WorkspaceBranches = {
  currentBranch: 'main',
  headCommit: 'abc',
  affectedConversationIds: ['one'],
  branches: [{ name: 'main', occupied: false }],
};
const render = (props: Partial<WorkspaceBranchDialogProps> = {}) =>
  renderToStaticMarkup(
    createElement(WorkspaceBranchDialog, {
      initialName: '',
      data,
      busy: false,
      disabled: false,
      error: null,
      returnFocus: { current: null },
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      ...props,
    })
  );
const submit = (html: string) =>
  html.match(/<button\b[\s\S]*?<\/button>/g)?.find((row) => row.includes('Create and switch')) ??
  '';

describe('新建工作区分支弹窗', () => {
  it('空值与已有分支不能提交，名称大小写保持 Git 语义', () => {
    expect(submit(render())).toContain('disabled=""');
    expect(submit(render({ initialName: ' main ' }))).toContain('disabled=""');
    expect(render({ initialName: 'main' })).toContain('A branch with this name already exists.');
    expect(submit(render({ initialName: 'Main' }))).not.toContain('disabled=""');
    expect(submit(render({ initialName: 'Main' }))).toContain('Create and switch');
  });
  it('明确从当前 HEAD 创建并影响全部共享会话', () => {
    const html = render();
    expect(html).toContain(
      'Creates a branch from the current HEAD and switches every conversation in this workspace to it.'
    );
    expect(html).toContain('Branch name');
  });
  it('无 HEAD、未知、阻止状态均不可提交', () => {
    for (const value of [
      null,
      { ...data, headCommit: null },
      { ...data, blockedReason: 'dirty' as const },
    ]) {
      expect(submit(render({ initialName: 'new', data: value }))).toContain('disabled=""');
    }
  });
  it('提交中禁用输入、确认和取消，失败保留名称并展示原因', () => {
    const html = render({ initialName: 'feature/new', busy: true });
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(submit(html)).toContain('disabled=""');
    expect(html).toMatch(/<button disabled=""[^>]*>Cancel<\/button>/);
    const failed = render({ initialName: 'feature/new', error: 'Git failed' });
    expect(failed).toContain('value="feature/new"');
    expect(failed).toContain('Git failed');
  });
});
