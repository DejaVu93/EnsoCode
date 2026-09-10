import type { SessionWorktree } from '@shared/types/worktree';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorktreeRenameDialog } from './WorktreeRenameDialog';

const harness = vi.hoisted(() => ({
  rename: vi.fn(),
  toast: vi.fn(),
  save: undefined as (() => void) | undefined,
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (selector: (state: unknown) => unknown) =>
    selector({ renameWorktree: harness.rename }),
}));
vi.mock('@/components/ui/toast', () => ({ addToast: harness.toast }));
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Dialog: Wrap,
    DialogContent: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
    DialogDescription: Wrap,
    DialogPanel: Wrap,
    DialogFooter: Wrap,
  };
});
vi.mock('@/components/ui/input', () => ({
  Input: ({ value, placeholder }: { value: string; placeholder: string }) =>
    createElement('input', { value, placeholder, readOnly: true }),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => {
    if (Array.isArray(children) && children.includes('Save')) harness.save = onClick;
    return createElement('button', { type: 'button' }, children);
  },
}));

const worktree: SessionWorktree = {
  conversationId: 'source',
  projectId: 'project',
  repoPath: '/repo',
  path: '/worktree',
  branch: 'feature/task',
  baseBranch: 'main',
  baseCommit: 'abc',
  createdAt: 1,
  name: '  Display name  ',
};
const render = (name = worktree.name, onClose = vi.fn()) => {
  const html = renderToStaticMarkup(
    createElement(WorktreeRenameDialog, {
      entity: { conversationId: 'current', worktree: { ...worktree, name } },
      onClose,
    })
  );
  return { html, onClose };
};
beforeEach(() => {
  harness.rename.mockReset().mockResolvedValue(null);
  harness.toast.mockReset();
  harness.save = undefined;
});

describe('WorktreeRenameDialog', () => {
  it('edits the display name and submits only the conversation id plus trimmed name', async () => {
    const { html, onClose } = render();
    expect(html).toContain('value="  Display name  "');
    harness.save?.();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(harness.rename).toHaveBeenCalledWith('current', 'Display name');
    expect(harness.toast).not.toHaveBeenCalled();
  });
  it('allows empty names to restore the branch default', async () => {
    const { onClose } = render('');
    harness.save?.();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(harness.rename).toHaveBeenCalledWith('current', '');
  });
  it('keeps the dialog open and shows a toast when rename fails', async () => {
    harness.rename.mockResolvedValue('Permission denied');
    const { onClose } = render();
    harness.save?.();
    await vi.waitFor(() =>
      expect(harness.toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', description: 'Permission denied' })
      )
    );
    expect(onClose).not.toHaveBeenCalled();
  });
  it('handles rejected operations without closing or losing the form', async () => {
    harness.rename.mockRejectedValue(new Error('Offline'));
    const { onClose } = render();
    harness.save?.();
    await vi.waitFor(() =>
      expect(harness.toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', description: 'Error: Offline' })
      )
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
