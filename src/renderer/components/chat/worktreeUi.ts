import type { SessionWorktree, WorktreeStatus } from '@shared/types/worktree';

export function worktreeDisplayName(worktree: SessionWorktree): string {
  return worktree.name?.trim() || worktree.branch;
}

type WorktreeConversation = {
  projectId: string;
  worktree?: SessionWorktree;
  parentId?: string;
  child?: unknown;
  archived?: boolean;
  worktreeMissing?: boolean;
  ended?: boolean;
  historyOnly?: boolean;
  workspaceMigrating?: boolean;
};

export function existingProjectWorktrees(
  conversations: Record<string, WorktreeConversation>,
  projectId: string,
  statuses: Record<string, WorktreeStatus>
): { conversationId: string; worktree: SessionWorktree }[] {
  const seen = new Set<string>();
  const result: { conversationId: string; worktree: SessionWorktree }[] = [];
  for (const [conversationId, conversation] of Object.entries(conversations)) {
    const { worktree } = conversation;
    if (
      conversation.projectId !== projectId ||
      !worktree ||
      conversation.parentId ||
      conversation.child ||
      conversation.worktreeMissing ||
      conversation.ended ||
      conversation.historyOnly ||
      conversation.workspaceMigrating ||
      statuses[conversationId]?.exists === false ||
      seen.has(worktree.path)
    )
      continue;
    seen.add(worktree.path);
    result.push({ conversationId, worktree });
  }
  return result;
}

export function canAttachWorktree(conversation: {
  worktree?: SessionWorktree;
  parentId?: string;
  child?: unknown;
  started?: boolean;
  sessionFile?: string;
  messages: readonly unknown[];
  spawning?: boolean;
  status: string;
  workspaceMigrating?: boolean;
  reloading?: boolean;
  ended?: boolean;
  historyOnly?: boolean;
  archived?: boolean;
  forkedFromConversationId?: string;
}): boolean {
  return (
    !conversation.worktree &&
    !conversation.parentId &&
    !conversation.child &&
    !conversation.started &&
    !conversation.sessionFile &&
    conversation.messages.length === 0 &&
    !conversation.spawning &&
    conversation.status !== 'running' &&
    !conversation.workspaceMigrating &&
    !conversation.reloading &&
    !conversation.ended &&
    !conversation.historyOnly &&
    !conversation.archived &&
    !conversation.forkedFromConversationId
  );
}
