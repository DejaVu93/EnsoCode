import type { WorkspaceBranchErrorCode } from '@shared/types/worktree';
import type { TFunction } from '@/i18n';

export function workspaceBranchFeedback(code: WorkspaceBranchErrorCode, t: TFunction): string {
  switch (code) {
    case 'running':
      return t(
        'Stop running conversations and coworkers in this workspace before switching branches.'
      );
    case 'dirty':
      return t('Commit or stash uncommitted changes before switching branches.');
    case 'busy':
      return t('This workspace is busy. Try again when its conversations are ready.');
    case 'occupied':
      return t('Branch is checked out in another worktree.');
    case 'invalid-branch':
      return t('Enter a valid Git branch name.');
    case 'branch-exists':
      return t('A branch with this name already exists.');
    case 'branch-not-found':
      return t('This branch no longer exists. Refresh the branch list.');
    case 'same-branch':
      return t('This workspace is already on that branch.');
    case 'unavailable':
      return t('Branches are not available for this workspace.');
    default:
      return t('Git could not switch branches.');
  }
}
