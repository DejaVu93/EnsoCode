import { conversationHasRunningChild } from '@shared/conversationDotTone';

export interface SidebarDirectoryEntry {
  id: string;
  title: string;
  status: string;
  spawning: boolean;
  /** 子会话 / subagent 仍在跑：侧栏蓝点，即使本会话 idle */
  hasRunningChild?: boolean;
  pinned?: boolean;
  archived?: boolean;
  archivedAt?: number;
  createdAt: number;
  projectId: string;
  lastActiveAt?: number;
  messages: { timestamp?: number }[];
  forkedFromConversationId?: string;
  unread?: boolean;
  pendingAsks?: readonly { requestId: string }[];
  pendingApprovals?: readonly unknown[];
  pendingCapabilityAsks?: readonly unknown[];
  coworkerIds?: readonly string[];
  coworkerName?: string;
  child?: { agentInstanceName?: string };
  subagents?: readonly { status: string }[];
  parentId?: string;
  sessionFile?: string;
  worktree?: { path?: string };
}

type Source = {
  id?: string;
  title: string;
  status?: string;
  spawning?: boolean;
  pinned?: boolean;
  archived?: boolean;
  archivedAt?: number;
  createdAt: number;
  projectId: string;
  lastActiveAt?: number;
  messages: { timestamp?: number }[];
  forkedFromConversationId?: string;
  unread?: boolean;
  pendingAsks?: readonly { requestId: string }[];
  pendingApprovals?: readonly unknown[];
  pendingCapabilityAsks?: readonly unknown[];
  coworkerIds?: readonly string[];
  coworkerName?: string;
  child?: { agentInstanceName?: string };
  subagents?: readonly { status: string }[];
  parentId?: string;
  sessionFile?: string;
  worktree?: { path?: string };
};

function lastActiveAt(conversation: Source): number | undefined {
  return conversation.messages.at(-1)?.timestamp ?? conversation.lastActiveAt;
}

function project(conversation: Source, hasRunningChild: boolean): SidebarDirectoryEntry {
  return {
    id: conversation.id ?? '',
    title: conversation.title,
    status: conversation.status ?? 'idle',
    spawning: conversation.spawning === true,
    hasRunningChild,
    pinned: conversation.pinned,
    archived: conversation.archived,
    archivedAt: conversation.archivedAt,
    createdAt: conversation.createdAt,
    projectId: conversation.projectId,
    lastActiveAt: lastActiveAt(conversation),
    messages: [],
    forkedFromConversationId: conversation.forkedFromConversationId,
    unread: conversation.unread,
    pendingAsks: conversation.pendingAsks,
    pendingApprovals: conversation.pendingApprovals,
    pendingCapabilityAsks: conversation.pendingCapabilityAsks,
    coworkerIds: conversation.coworkerIds,
    coworkerName: conversation.coworkerName,
    child: conversation.child,
    subagents: conversation.subagents,
    parentId: conversation.parentId,
    sessionFile: conversation.sessionFile,
    worktree: conversation.worktree,
  };
}

function fingerprint(entry: SidebarDirectoryEntry): string {
  return JSON.stringify(entry);
}

let cached: {
  source: Record<string, Source | undefined>;
  prints: string[];
  value: Record<string, SidebarDirectoryEntry>;
} | null = null;

export function selectSidebarConversations(
  conversations: Record<string, Source | undefined>
): Record<string, SidebarDirectoryEntry> {
  if (cached?.source === conversations) return cached.value;
  const next: Record<string, SidebarDirectoryEntry> = {};
  const prints: string[] = [];
  for (const [id, conversation] of Object.entries(conversations)) {
    if (!conversation) continue;
    const entry = project(
      conversation,
      conversationHasRunningChild(
        {
          status: conversation.status ?? 'idle',
          spawning: conversation.spawning,
          subagents: conversation.subagents,
          coworkerIds: conversation.coworkerIds,
        },
        conversations
      )
    );
    next[id] = entry;
    prints.push(`${id}:${fingerprint(entry)}`);
  }
  if (
    cached &&
    cached.prints.length === prints.length &&
    cached.prints.every((item, i) => item === prints[i])
  ) {
    cached = { source: conversations, prints, value: cached.value };
    return cached.value;
  }
  cached = { source: conversations, prints, value: next };
  return next;
}
