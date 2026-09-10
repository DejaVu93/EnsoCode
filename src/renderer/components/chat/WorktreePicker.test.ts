import type { SessionWorktree, WorktreeStatus } from '@shared/types/worktree';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/stores/sessions';
import { WorktreeBadge, worktreeHoverText } from './WorktreeBadge';
import { WorktreePicker } from './WorktreePicker';

const harness = vi.hoisted(() => ({
  conversations: {} as Record<string, Conversation>,
  statuses: {} as Record<string, WorktreeStatus>,
  projectKind: 'local',
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      Object.entries(params ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
        key
      ),
  }),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (selector: (state: unknown) => unknown) =>
    selector({
      conversations: harness.conversations,
      worktreeStatuses: harness.statuses,
    }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ projects: [{ id: 'project', kind: harness.projectKind }] }),
}));
vi.mock('@/components/ui/popover', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Popover: Wrap,
    PopoverPopup: Wrap,
    PopoverTrigger: ({
      children,
      disabled,
      title,
    }: {
      children?: ReactNode;
      disabled?: boolean;
      title?: string;
    }) => createElement('button', { disabled, title, type: 'button' }, children),
  };
});
vi.mock('@/components/chat/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('./WorktreeRenameDialog', () => ({ WorktreeRenameDialog: () => null }));

const worktree: SessionWorktree = {
  conversationId: 'source',
  projectId: 'project',
  repoPath: '/repo',
  path: '/worktrees/task',
  branch: 'feature/task',
  baseBranch: 'main',
  baseCommit: 'abc',
  createdAt: 1,
  name: 'Readable task',
};
const conversation = (id: string, extra: Partial<Conversation> = {}): Conversation =>
  ({
    id,
    projectId: 'project',
    title: '',
    messages: [],
    status: 'idle',
    spawning: false,
    createdAt: 1,
    started: false,
    ...extra,
  }) as Conversation;
const render = () =>
  renderToStaticMarkup(createElement(WorktreePicker, { conversationId: 'current' }));

beforeEach(() => {
  harness.conversations = {
    current: conversation('current'),
    source: conversation('source', { worktree }),
  };
  harness.statuses = {};
  harness.projectKind = 'local';
});

describe('WorktreePicker', () => {
  it('offers one existing worktree per path alongside the new isolation entry', () => {
    harness.conversations.duplicate = conversation('duplicate', { worktree, archived: true });
    const html = render();
    expect(html).toContain('Local workspace');
    expect(html).toContain('New isolated worktree');
    expect(html).toContain('Existing worktrees');
    expect(html.match(/block truncate">Readable task</g)).toHaveLength(1);
    expect(html).toContain('/worktrees/task');
  });
  it('hides existing worktree attachment after history exists', () => {
    harness.conversations.current.sessionFile = '/history.jsonl';
    expect(render()).not.toContain('Existing worktrees');
    expect(render()).toContain('New isolated worktree');
  });
  it('shows the current display name and both worktree actions', () => {
    harness.conversations.current.worktree = worktree;
    const html = render();
    expect(html).toContain('Readable task');
    expect(html).toContain('New conversation in this worktree');
    expect(html).toContain('Rename worktree');
    expect(html).not.toContain('Existing worktrees');
  });
  it('disables the picker while the conversation is busy', () => {
    harness.conversations.current.workspaceMigrating = true;
    expect(render()).toContain('<button disabled=""');
  });
  it('does not offer unavailable worktrees', () => {
    harness.statuses.source = { exists: false, dirty: false, ahead: 0 };
    expect(render()).not.toContain('Existing worktrees');
  });
  it('hides worktree UI for child conversations and SSH projects', () => {
    harness.conversations.current.parentId = 'parent';
    expect(render()).toBe('');
    delete harness.conversations.current.parentId;
    harness.projectKind = 'ssh';
    expect(render()).toBe('');
  });
});

describe('WorktreeBadge', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    key.replace('{{n}}', String(params?.n));
  it('keeps full name, branch, path and both dirty/ahead states in hover text', () => {
    expect(worktreeHoverText(worktree, { exists: true, dirty: true, ahead: 2 }, t)).toBe(
      'Readable task\nfeature/task\n/worktrees/task\nUncommitted changes · 2 unmerged commits'
    );
    const html = renderToStaticMarkup(createElement(WorktreeBadge, { worktree }));
    expect(html).toContain('truncate">Readable task');
    expect(html).toContain('data-slot="worktree-label"');
    expect(html).toContain('grid-cols-subgrid');
    expect(html).toContain('text-muted-foreground/70');
    expect(html).not.toContain('max-w-[35%]');
    expect(html).not.toContain('bg-muted');
  });
  it('distinguishes missing and unknown status from clean worktrees', () => {
    expect(worktreeHoverText(worktree, undefined, t)).toContain('Worktree status unknown');
    expect(worktreeHoverText(worktree, { exists: false, dirty: false, ahead: 0 }, t)).toContain(
      'Worktree missing'
    );
    expect(worktreeHoverText(worktree, { exists: true, dirty: false, ahead: 0 }, t)).toContain(
      'Working tree clean'
    );
  });
});
