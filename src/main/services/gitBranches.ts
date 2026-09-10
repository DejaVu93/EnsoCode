import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { WorkspaceBranchErrorCode } from '@shared/types/worktree';

export function workspaceIdentityPath(cwd: string): string {
  let canonical: string;
  try {
    canonical = realpathSync(cwd);
  } catch {
    return resolve(cwd);
  }
  for (let current = canonical; ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) return current;
    if (dirname(current) === current) return canonical;
  }
}

export class WorkspaceBranchError extends Error {
  constructor(
    public readonly code: WorkspaceBranchErrorCode,
    message: string
  ) {
    super(message);
  }
}

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new WorkspaceBranchError('git-error', stderr.trim() || error.message));
        else resolve(stdout);
      }
    );
  });
}

export interface GitWorkspaceBranches {
  currentBranch: string | null;
  defaultBranch?: string | null;
  headCommit: string | null;
  dirty: boolean;
  busy?: boolean;
  branches: { name: string; worktreePath?: string }[];
}

export async function readWorkspaceBranches(cwd: string): Promise<GitWorkspaceBranches> {
  const gitDir = (await git(cwd, 'rev-parse', '--absolute-git-dir')).replace(/\r?\n$/, '');
  const busy = [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_LOG',
    'rebase-merge',
    'rebase-apply',
    'sequencer',
  ].some((marker) => existsSync(join(gitDir, marker)));
  const [current, head, refs, worktrees, status, originHead, configuredDefault] = await Promise.all(
    [
      git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => ''),
      git(cwd, 'rev-parse', '--verify', 'HEAD').catch(() => ''),
      git(cwd, 'for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/'),
      git(cwd, 'worktree', 'list', '--porcelain', '-z'),
      busy ? Promise.resolve('') : git(cwd, 'status', '--porcelain=v1', '--untracked-files=all'),
      git(cwd, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD').catch(() => ''),
      git(cwd, 'config', '--get', 'init.defaultBranch').catch(() => ''),
    ]
  );
  const occupied = new Map<string, string>();
  let worktreePath: string | undefined;
  for (const field of worktrees.split('\0')) {
    if (field.startsWith('worktree ')) worktreePath = field.slice(9);
    else if (field.startsWith('branch refs/heads/') && worktreePath) {
      occupied.set(field.slice(18), worktreePath);
    } else if (!field) worktreePath = undefined;
  }
  const names = refs.trim().split('\n').filter(Boolean);
  const originPrefix = 'refs/remotes/origin/';
  const defaultBranch = originHead.trim().startsWith(originPrefix)
    ? originHead.trim().slice(originPrefix.length)
    : ([configuredDefault.trim(), 'main', 'master'].find((name) => names.includes(name)) ?? null);
  return {
    currentBranch: current.trim() || null,
    defaultBranch,
    headCommit: head.trim() || null,
    dirty: status.length > 0,
    busy,
    branches: names.map((name) => ({
      name,
      ...(occupied.has(name) ? { worktreePath: occupied.get(name)! } : {}),
    })),
  };
}

export async function validateWorkspaceBranch(cwd: string, branch: string): Promise<void> {
  if (!branch || branch.startsWith('-') || branch.includes('@{')) {
    throw new WorkspaceBranchError('invalid-branch', 'Invalid local branch name.');
  }
  try {
    const checked = await git(cwd, 'check-ref-format', '--branch', branch);
    if (checked.trim() !== branch) throw new Error('Branch shorthand is not allowed.');
  } catch {
    throw new WorkspaceBranchError('invalid-branch', 'Invalid local branch name.');
  }
}

export function checkWorkspaceBranchSwitch(
  cwd: string,
  snapshot: GitWorkspaceBranches,
  branch: string,
  create: boolean
): void {
  const target = snapshot.branches.find((candidate) => candidate.name === branch);
  if (!create && snapshot.currentBranch === branch) {
    throw new WorkspaceBranchError('same-branch', 'The workspace is already on this branch.');
  }
  if (create && target)
    throw new WorkspaceBranchError('branch-exists', 'The local branch already exists.');
  if (!create && !target)
    throw new WorkspaceBranchError('branch-not-found', 'The local branch does not exist.');
  if (
    target?.worktreePath &&
    workspaceIdentityPath(target.worktreePath) !== workspaceIdentityPath(cwd)
  ) {
    throw new WorkspaceBranchError('occupied', 'The branch is checked out in another worktree.');
  }
  if (snapshot.busy)
    throw new WorkspaceBranchError(
      'busy',
      'Complete or abort the current Git operation before switching branches.'
    );
  if (!snapshot.headCommit)
    throw new WorkspaceBranchError('unavailable', 'Create an initial commit first.');
  if (snapshot.dirty)
    throw new WorkspaceBranchError(
      'dirty',
      'Commit or remove uncommitted changes before switching branches.'
    );
}

export async function switchWorkspaceBranch(
  cwd: string,
  branch: string,
  create: boolean,
  beforeSwitch?: () => void,
  onSwitched?: (snapshot: GitWorkspaceBranches) => void
): Promise<GitWorkspaceBranches> {
  await validateWorkspaceBranch(cwd, branch);
  const before = await readWorkspaceBranches(cwd);
  checkWorkspaceBranchSwitch(cwd, before, branch, create);
  beforeSwitch?.();
  try {
    await git(
      cwd,
      'switch',
      '--no-guess',
      ...(create ? ['-c', branch, '--', 'HEAD'] : ['--', branch])
    );
  } catch (error) {
    const actual = await readWorkspaceBranches(cwd).catch(() => undefined);
    if (actual?.currentBranch === branch) onSwitched?.(actual);
    throw error;
  }
  onSwitched?.({
    ...before,
    currentBranch: branch,
    headCommit: create ? before.headCommit : null,
    branches: create ? [...before.branches, { name: branch, worktreePath: cwd }] : before.branches,
  });
  return readWorkspaceBranches(cwd);
}
