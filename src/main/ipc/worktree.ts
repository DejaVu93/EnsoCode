/**
 * 会话级 worktree 隔离的 IPC 层：参数校验 + 转发到 services/worktree。
 * 产品语义（默认本地、opt-in、拦截规则）见 docs/plans/2026-08-22-enso-code-design.md。
 */

import path from 'node:path';
import { IPC_CHANNELS } from '@shared/types';
import type { SessionWorktree, WorktreeStatus } from '@shared/types/worktree';
import { resolveWorktreeRoot } from '@shared/worktreeRoot';
import { app, ipcMain } from 'electron';
import { readSettingsState } from '../services/agentHost';
import { WorktreeRegistry } from '../services/worktree/registry';
import {
  createSessionWorktree,
  rebuildSessionWorktree,
  removeSessionWorktree,
  repoIsClean,
  worktreeStatus,
} from '../services/worktree/service';
import { isMainWebContents } from '../windows/MainWindow';
import { getSourceAuthorityRegistry } from './agent';
import { agentSessionIndex } from './capabilities';

let registry: WorktreeRegistry | null = null;
const busyWorktrees = new Map<string, Promise<void>>();
const bindingConversations = new Map<string, Promise<void>>();

function lockWorktree(worktreePath: string): () => void {
  let release!: () => void;
  busyWorktrees.set(
    worktreePath,
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  return () => {
    busyWorktrees.delete(worktreePath);
    release();
  };
}

function worktreesRoot(): string {
  return resolveWorktreeRoot(
    readSettingsState()?.worktreeRoot,
    path.join(app.getPath('userData'), 'worktrees')
  );
}

function ensureRegistry(): WorktreeRegistry {
  if (!registry) {
    registry = new WorktreeRegistry(path.join(app.getPath('userData'), 'worktrees.json'));
  }
  return registry;
}

/** spawn cwd 授权用：该会话登记过的 worktree 记录（main 权威，不信任 renderer 传路径） */
export function sessionWorktree(conversationId: string): SessionWorktree | undefined {
  return ensureRegistry().get(conversationId);
}

export function sessionWorktreeBusy(conversationId: string): boolean {
  const record = sessionWorktree(conversationId);
  return (
    bindingConversations.has(conversationId) || Boolean(record && busyWorktrees.has(record.path))
  );
}

export function shareSessionWorktree(fromConversationId: string, toConversationId: string): void {
  const record = sessionWorktree(fromConversationId);
  if (!record) return;
  const source = activeRoot(fromConversationId);
  const target = activeRoot(toConversationId);
  if (
    !source ||
    !target ||
    target.projectId !== source.projectId ||
    record.projectId !== source.projectId ||
    record.repoPath !== resolveRepoPath(source.projectId) ||
    target.lifecycle !== 'draft' ||
    target.sessionFile ||
    target.forkedFrom?.conversationId !== fromConversationId ||
    sessionWorktreeBusy(fromConversationId) ||
    sessionWorktreeBusy(toConversationId) ||
    sessionWorktree(toConversationId)
  ) {
    throw new Error('worktree cannot be shared with this fork');
  }
  ensureRegistry().share(fromConversationId, toConversationId);
}

export async function removeRegisteredWorktree(
  conversationId: string,
  expected?: SessionWorktree
): Promise<void> {
  for (;;) {
    const record = sessionWorktree(conversationId);
    const pending =
      bindingConversations.get(conversationId) ?? (record && busyWorktrees.get(record.path));
    if (pending) {
      await pending;
      continue;
    }
    if (
      !record ||
      (expected &&
        (record.path !== expected.path ||
          record.projectId !== expected.projectId ||
          record.repoPath !== expected.repoPath ||
          record.createdAt !== expected.createdAt))
    )
      return;
    const release = lockWorktree(record.path);
    try {
      if (ensureRegistry().bindings(record).length === 1) await removeSessionWorktree(record);
      ensureRegistry().delete(conversationId);
      return;
    } finally {
      release();
    }
  }
}

export type WorktreeResult<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: unknown): { ok: false; error: string } => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** 解析 conversationId+projectId 到项目根路径（走 source authority，不接受 renderer 路径） */
function resolveRepoPath(projectId: string): string | null {
  const authority = getSourceAuthorityRegistry();
  const project = authority?.project(projectId);
  // ssh 项目的 canonicalPath 是远端路径，本地 git worktree 操作无意义，一律拒绝（UI 已隐藏，此处防御）
  if (project?.kind === 'ssh') return null;
  return project?.state === 'active' ? project.canonicalPath : null;
}

function activeRoot(conversationId: string) {
  const conversation = getSourceAuthorityRegistry()?.conversation(conversationId);
  return conversation?.kind === 'root' &&
    conversation.lifecycle !== 'ended' &&
    resolveRepoPath(conversation.projectId)
    ? conversation
    : undefined;
}

function bindable(conversationId: string, sourceId: string, record: SessionWorktree): boolean {
  const target = activeRoot(conversationId);
  const source = activeRoot(sourceId);
  return Boolean(
    target &&
      source &&
      target.projectId === source.projectId &&
      source.projectId === record.projectId &&
      resolveRepoPath(source.projectId) === record.repoPath &&
      target.lifecycle === 'draft' &&
      !target.sessionFile &&
      !target.forkedFrom &&
      !agentSessionIndex.currentIdentity(conversationId) &&
      !ensureRegistry().get(conversationId) &&
      ensureRegistry().get(sourceId) === record
  );
}

export function registerWorktreeHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_BIND,
    async (
      event,
      conversationId: unknown,
      sourceId: unknown
    ): Promise<WorktreeResult<SessionWorktree>> => {
      if (
        !isMainWebContents(event.sender.id) ||
        !isNonEmptyString(conversationId) ||
        !isNonEmptyString(sourceId) ||
        conversationId === sourceId
      ) {
        return { ok: false, error: 'invalid worktree bind request' };
      }
      const record = ensureRegistry().get(sourceId);
      if (!record || !bindable(conversationId, sourceId, record)) {
        return {
          ok: false,
          error: 'worktree binding requires fresh same-project root conversations',
        };
      }
      if (busyWorktrees.has(record.path) || bindingConversations.has(conversationId)) {
        return { ok: false, error: 'worktree operation in progress' };
      }
      const release = lockWorktree(record.path);
      bindingConversations.set(conversationId, busyWorktrees.get(record.path)!);
      try {
        if (!(await worktreeStatus(record)).exists)
          return { ok: false, error: 'worktree is missing' };
        if (!bindable(conversationId, sourceId, record))
          return { ok: false, error: 'worktree authority changed' };
        ensureRegistry().share(sourceId, conversationId);
        return { ok: true, value: ensureRegistry().get(conversationId)! };
      } catch (error) {
        return fail(error);
      } finally {
        bindingConversations.delete(conversationId);
        release();
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_RENAME,
    (event, conversationId: unknown, name: unknown): WorktreeResult<SessionWorktree[]> => {
      if (
        !isMainWebContents(event.sender.id) ||
        !isNonEmptyString(conversationId) ||
        typeof name !== 'string'
      ) {
        return { ok: false, error: 'invalid worktree rename request' };
      }
      const record = ensureRegistry().get(conversationId);
      const authority = activeRoot(conversationId);
      if (
        !record ||
        authority?.projectId !== record.projectId ||
        resolveRepoPath(record.projectId) !== record.repoPath ||
        busyWorktrees.has(record.path)
      ) {
        return { ok: false, error: 'worktree is unavailable' };
      }
      try {
        return { ok: true, value: ensureRegistry().rename(conversationId, name) };
      } catch (error) {
        return fail(error);
      }
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_CREATE,
    async (event, request: unknown): Promise<WorktreeResult<SessionWorktree>> => {
      if (
        !isMainWebContents(event.sender.id) ||
        !request ||
        typeof request !== 'object' ||
        !('conversationId' in request) ||
        !('projectId' in request) ||
        !isNonEmptyString(request.conversationId) ||
        !isNonEmptyString(request.projectId)
      ) {
        return { ok: false, error: 'invalid worktree create request' };
      }
      const { conversationId, projectId } = request;
      const repoPath = resolveRepoPath(projectId);
      if (!repoPath || activeRoot(conversationId)?.projectId !== projectId) {
        return { ok: false, error: 'unknown or inactive conversation project' };
      }
      if (sessionWorktree(conversationId) || bindingConversations.has(conversationId)) {
        return { ok: false, error: 'conversation already has a worktree operation' };
      }
      let release!: () => void;
      bindingConversations.set(
        conversationId,
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      try {
        const record = await createSessionWorktree({
          repoPath,
          conversationId,
          projectId,
          root: worktreesRoot(),
        });
        if (activeRoot(conversationId)?.projectId !== projectId) {
          await removeSessionWorktree(record);
          return { ok: false, error: 'conversation authority changed' };
        }
        ensureRegistry().set(record);
        return { ok: true, value: record };
      } catch (error) {
        return fail(error);
      } finally {
        bindingConversations.delete(conversationId);
        release();
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_GET,
    (_event, conversationId: unknown): SessionWorktree | null =>
      isNonEmptyString(conversationId) ? (ensureRegistry().get(conversationId) ?? null) : null
  );

  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST, (): SessionWorktree[] => ensureRegistry().list());

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_STATUS,
    async (_event, conversationId: unknown): Promise<WorktreeResult<WorktreeStatus>> => {
      if (!isNonEmptyString(conversationId)) return { ok: false, error: 'invalid conversationId' };
      const record = ensureRegistry().get(conversationId);
      if (!record) return { ok: false, error: 'no worktree for conversation' };
      try {
        return { ok: true, value: await worktreeStatus(record) };
      } catch (error) {
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_REMOVE,
    async (event, conversationId: unknown): Promise<WorktreeResult<null>> => {
      if (!isMainWebContents(event.sender.id) || !isNonEmptyString(conversationId)) {
        return { ok: false, error: 'invalid worktree remove request' };
      }
      try {
        await removeRegisteredWorktree(conversationId);
        return { ok: true, value: null };
      } catch (error) {
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_REBUILD,
    async (event, conversationId: unknown): Promise<WorktreeResult<SessionWorktree>> => {
      if (!isMainWebContents(event.sender.id) || !isNonEmptyString(conversationId)) {
        return { ok: false, error: 'invalid worktree rebuild request' };
      }
      const record = ensureRegistry().get(conversationId);
      if (!record) return { ok: false, error: 'no worktree record for conversation' };
      if (busyWorktrees.has(record.path))
        return { ok: false, error: 'worktree operation in progress' };
      const release = lockWorktree(record.path);
      try {
        if ((await worktreeStatus(record)).exists) return { ok: true, value: record };
        if (
          ensureRegistry()
            .bindings(record)
            .some((binding) => agentSessionIndex.isAlive(binding.conversationId))
        ) {
          return { ok: false, error: 'release all sessions using this worktree before rebuilding' };
        }
        const rebuilt = await rebuildSessionWorktree(record, worktreesRoot());
        ensureRegistry().replaceBindings(record, rebuilt);
        return { ok: true, value: rebuilt };
      } catch (error) {
        return fail(error);
      } finally {
        release();
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_REPO_CLEAN,
    async (_event, projectId: unknown): Promise<WorktreeResult<boolean>> => {
      if (!isNonEmptyString(projectId)) return { ok: false, error: 'invalid projectId' };
      const repoPath = resolveRepoPath(projectId);
      if (!repoPath) return { ok: false, error: 'unknown or inactive project' };
      try {
        return { ok: true, value: await repoIsClean(repoPath) };
      } catch (error) {
        return fail(error);
      }
    }
  );
}
