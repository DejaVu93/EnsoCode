export type ConversationDotTone = 'running' | 'failed' | 'waiting' | 'unread' | 'idle';

type ChildActivityConversation = {
  status: string;
  spawning?: boolean;
  subagents?: readonly { status: string }[];
  coworkerIds?: readonly string[];
};

export function conversationHasRunningChild(
  conversation: ChildActivityConversation,
  conversations: Readonly<Record<string, ChildActivityConversation | undefined>>
): boolean {
  return (
    conversation.subagents?.some((agent) => agent.status === 'running') === true ||
    conversation.coworkerIds?.some((childId) => {
      const child = conversations[childId];
      return Boolean(child && (child.spawning || child.status === 'running'));
    }) === true
  );
}

export function conversationDotTone(input: {
  status: string;
  spawning?: boolean;
  unread?: boolean;
  pendingAskCount?: number;
  hasRunningChild?: boolean;
}): ConversationDotTone {
  if (input.status === 'failed' && !input.spawning) return 'failed';
  if ((input.pendingAskCount ?? 0) > 0) return 'waiting';
  if (input.status === 'running' || input.spawning || input.hasRunningChild) return 'running';
  if (input.unread) return 'unread';
  return 'idle';
}

/** coworker tab 特有：待审批 / 待能力确认是红色 attention，与提问的 waiting 区分开 */
export type CoworkerTabTone = 'attention' | Exclude<ConversationDotTone, 'unread'>;

/**
 * coworker tab 的状态色。审批与能力确认保持原有 attention 语义（优先于一切）；
 * 仅有 ask_user 挂起时走与侧栏 / 聊天区一致的 waiting（failed 仍优先）。
 */
export function coworkerTabTone(input: {
  status: string;
  spawning?: boolean;
  pendingApprovalCount?: number;
  pendingAskCount?: number;
  pendingCapabilityAskCount?: number;
}): CoworkerTabTone {
  if ((input.pendingApprovalCount ?? 0) > 0 || (input.pendingCapabilityAskCount ?? 0) > 0) {
    return 'attention';
  }
  const tone = conversationDotTone({
    status: input.status,
    spawning: input.spawning,
    pendingAskCount: input.pendingAskCount,
  });
  return tone === 'unread' ? 'idle' : tone;
}
