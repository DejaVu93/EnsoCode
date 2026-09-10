import type { WorkspaceBranches } from '@shared/types/worktree';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceBranchList, type WorkspaceBranchListProps } from './WorkspaceBranchList';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => createElement('input', props),
}));

const data: WorkspaceBranches = {
  currentBranch: 'main',
  headCommit: 'abc',
  affectedConversationIds: ['current', 'sibling'],
  branches: [
    { name: 'main', occupied: false },
    { name: 'Feature/Task', occupied: false },
    { name: 'enso/task', occupied: true, worktreeConversationId: 'other' },
    { name: 'external/task', occupied: true },
  ],
};
const render = (props: Partial<WorkspaceBranchListProps> = {}) =>
  renderToStaticMarkup(
    createElement(WorkspaceBranchList, {
      data,
      loading: false,
      error: null,
      disabled: false,
      query: '',
      onQueryChange: vi.fn(),
      onSelect: vi.fn(),
      onCreate: vi.fn(),
      onRetry: vi.fn(),
      ...props,
    })
  );
const button = (html: string, label: string) =>
  html.match(/<button\b[\s\S]*?<\/button>/g)?.find((row) => row.includes(label)) ?? '';

describe('工作区分支列表', () => {
  it('搜索忽略前后空白和大小写，保留真实分支名', () => {
    const html = render({ query: '  FEATURE/  ' });
    expect(html).toContain('Feature/Task');
    expect(html).not.toContain('enso/task');
    expect(html).not.toContain('external/task');
  });
  it('当前分支标记为已选并禁用，其他本地分支可以切换', () => {
    expect(button(render(), '>main<')).toContain('aria-current="true"');
    expect(button(render(), '>main<')).toContain('disabled=""');
    expect(button(render(), 'Feature/Task')).not.toContain('disabled=""');
    expect(button(render(), 'Feature/Task')).toContain('Feature/Task');
  });
  it('Enso 占用分支显示新建会话动作，外部占用只显示原因并禁用', () => {
    const html = render();
    expect(button(html, 'enso/task')).toContain('New conversation in this worktree');
    expect(button(html, 'enso/task')).not.toContain('disabled=""');
    expect(button(html, 'external/task')).toContain('Branch is checked out in another worktree.');
    expect(button(html, 'external/task')).toContain('disabled=""');
  });
  it.each(['busy', 'running', 'dirty'] as const)('权威 %s 状态禁止切换和创建', (blockedReason) => {
    const html = render({ data: { ...data, blockedReason } });
    expect(button(html, 'Feature/Task')).toContain('disabled=""');
    expect(button(html, 'Create branch from HEAD…')).toContain('disabled=""');
  });
  it('HEAD 不存在不可创建；detached HEAD 仍能选择已有分支', () => {
    expect(
      button(render({ data: { ...data, headCommit: null } }), 'Create branch from HEAD…')
    ).toContain('disabled=""');
    expect(
      button(render({ data: { ...data, currentBranch: null } }), 'Feature/Task')
    ).not.toContain('disabled=""');
  });
  it('加载与查询错误时禁用旧列表，错误允许重试', () => {
    expect(button(render({ loading: true }), 'Create branch from HEAD…')).toContain('disabled=""');
    expect(
      button(render({ error: 'Could not load branches.' }), 'Create branch from HEAD…')
    ).toContain('disabled=""');
    expect(render({ error: 'Could not load branches.' })).toContain('Retry');
  });
  it('无匹配结果给出空态，所有状态都说明影响共享工作区的会话', () => {
    const html = render({ query: 'missing-branch' });
    expect(html).toContain('No matching local branches.');
    expect(html).toContain('Switching branches affects all conversations in this workspace.');
  });
});
