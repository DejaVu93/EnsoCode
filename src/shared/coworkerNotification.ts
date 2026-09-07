/** coworker 会话 id 恒为 `${parentId}::cw-${slug}` */
export function isCoworkerSessionId(sessionId: string | undefined): boolean {
  return typeof sessionId === 'string' && sessionId.includes('::cw-');
}

function sessionIdOf(event: {
  sessionId?: string;
  identity?: { sessionId?: string };
}): string | undefined {
  return event.identity?.sessionId ?? event.sessionId;
}

function isCompletionOrFailure(type: string, status?: string): boolean {
  return (
    type === 'turn-completed' ||
    type === 'turn-failed' ||
    (type === 'status' && status === 'failed')
  );
}

/** 仅主 agent 发完成/失败通知时，coworker 的完成与失败应静音；提问/审批不走这里 */
export function shouldMuteCoworkerCompletionNotification(
  event: {
    type: string;
    status?: string;
    sessionId?: string;
    identity?: { sessionId?: string };
  },
  notifyMainAgentOnly: boolean
): boolean {
  if (!notifyMainAgentOnly) return false;
  return isCoworkerSessionId(sessionIdOf(event)) && isCompletionOrFailure(event.type, event.status);
}
