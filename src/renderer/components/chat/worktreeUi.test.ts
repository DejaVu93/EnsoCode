import type { SessionWorktree } from '@shared/types/worktree';
import { describe, expect, it } from 'vitest';
import { canAttachWorktree, existingProjectWorktrees, worktreeDisplayName } from './worktreeUi';

const worktree = (path: string, name?: string): SessionWorktree => ({
  conversationId: 'source',
  projectId: 'project',
  repoPath: '/repo',
  path,
  branch: 'feature/example',
  baseBranch: 'main',
  baseCommit: 'abc',
  createdAt: 1,
  name,
});
const conversation = (path: string) => ({ projectId: 'project', worktree: worktree(path) });

describe('worktree UI identity', () => {
  it('uses the trimmed display name, falling back to the unchanged branch', () => {
    expect(worktreeDisplayName(worktree('/one', '  My task  '))).toBe('My task');
    expect(worktreeDisplayName(worktree('/one', '  '))).toBe('feature/example');
    expect(worktreeDisplayName(worktree('/one'))).toBe('feature/example');
  });

  it('deduplicates paths within the project, includes archived sessions and excludes children and missing worktrees', () => {
    const candidates = existingProjectWorktrees(
      {
        first: conversation('/one'),
        duplicate: conversation('/one'),
        archived: { ...conversation('/two'), archived: true },
        otherProject: { ...conversation('/other'), projectId: 'other' },
        child: { ...conversation('/child'), parentId: 'first' },
        typedChild: { ...conversation('/typed'), child: {} },
        missing: { ...conversation('/missing'), worktreeMissing: true },
        absent: conversation('/absent'),
        local: { projectId: 'project' },
      },
      'project',
      { absent: { exists: false, dirty: false, ahead: 0 } }
    );
    expect(
      candidates.map(({ conversationId, worktree }) => [conversationId, worktree.path])
    ).toEqual([
      ['first', '/one'],
      ['archived', '/two'],
    ]);
  });

  it('skips unusable references before deduplicating a shared path', () => {
    const candidates = existingProjectWorktrees(
      {
        ended: { ...conversation('/one'), ended: true },
        history: { ...conversation('/one'), historyOnly: true },
        migrating: { ...conversation('/one'), workspaceMigrating: true },
        usable: conversation('/one'),
      },
      'project',
      {}
    );
    expect(candidates.map(({ conversationId }) => conversationId)).toEqual(['usable']);
  });

  it('does not merge different paths merely because their names or branches match', () => {
    expect(
      existingProjectWorktrees({ a: conversation('/a'), b: conversation('/b') }, 'project', {})
    ).toHaveLength(2);
  });
});

describe('existing worktree attachment eligibility', () => {
  const fresh = { started: false, messages: [], status: 'idle', spawning: false };
  it('only offers attachment to a fresh local parent session', () => {
    expect(canAttachWorktree(fresh)).toBe(true);
    for (const change of [
      { started: true },
      { sessionFile: '/history' },
      { messages: [{}] },
      { worktree: worktree('/one') },
      { parentId: 'parent' },
      { child: {} },
      { spawning: true },
      { status: 'running' },
      { workspaceMigrating: true },
      { reloading: true },
      { historyOnly: true },
      { ended: true },
      { archived: true },
      { forkedFromConversationId: 'source' },
    ])
      expect(canAttachWorktree({ ...fresh, ...change })).toBe(false);
  });
});
