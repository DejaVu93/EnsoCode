/** 离开会话后，正文在 renderer 里再留这么久；worker/jsonl 仍是全文。 */
export const MESSAGE_CACHE_TTL_MS = 5 * 60_000;

export function viewedConversationId(
  activeId: string | null | undefined,
  activeTabId: string | undefined,
  hasConversation: (id: string) => boolean
): string | null {
  if (activeTabId && hasConversation(activeTabId)) return activeTabId;
  return activeId ?? null;
}

export function isMessageCacheHot(
  sessionId: string,
  viewedId: string | null,
  lastViewedAt: Readonly<Record<string, number>>,
  now: number,
  ttl = MESSAGE_CACHE_TTL_MS
): boolean {
  if (sessionId === viewedId) return true;
  const at = lastViewedAt[sessionId];
  return at !== undefined && now - at < ttl;
}

/**
 * 正文是否已有权威（worker 确认过的）消息。乐观回显是本地先上屏的未确认尾巴，
 * 不算：冷缓存清空后用户先发一句，length 变 1 但历史与正在跑的工具卡都还没补回，
 * 仍需要向 worker 要 snapshot。
 */
export function hasAuthoritativeMessages(messages: readonly { optimistic?: boolean }[]): boolean {
  return messages.some((message) => !message.optimistic);
}

/** 已启动或可 resume 的会话缺权威正文：应显示 Preparing，并补 snapshot */
export function needsHistoryHydration(conversation: {
  started: boolean;
  sessionFile?: string;
  messages: readonly { optimistic?: boolean }[];
  spawning: boolean;
  status?: string;
}): boolean {
  return (
    conversation.status !== 'failed' &&
    (conversation.started || Boolean(conversation.sessionFile)) &&
    !hasAuthoritativeMessages(conversation.messages) &&
    !conversation.spawning
  );
}

/** 输入框 busy：有权威正文后不再因 spawn/读历史锁输入 */
export function chatSurfaceBusy(conversation: {
  started: boolean;
  sessionFile?: string;
  messages: readonly { optimistic?: boolean }[];
  spawning: boolean;
  status?: string;
}): boolean {
  if (conversation.status === 'running') return true;
  if (hasAuthoritativeMessages(conversation.messages)) return false;
  return needsHistoryHydration(conversation) || conversation.spawning;
}

/** 时间线脚点：空窗读历史 / spawn / 乐观未确认 / running 立刻出 loading */
export function chatTimelineBusy(conversation: {
  started?: boolean;
  sessionFile?: string;
  messages: readonly { optimistic?: boolean }[];
  spawning: boolean;
  status?: string;
}): boolean {
  return (
    conversation.status === 'running' ||
    conversation.spawning ||
    conversation.messages.some((message) => message.optimistic) ||
    needsHistoryHydration({
      started: conversation.started === true,
      sessionFile: conversation.sessionFile,
      messages: conversation.messages,
      spawning: conversation.spawning,
      status: conversation.status,
    })
  );
}

export function isBulkyAgentEvent(type: string): boolean {
  return type === 'message-upsert' || type === 'session-custom-entry';
}

export function evictColdMessages<T extends { messages: unknown[]; customEntries: unknown[] }>(
  conversations: Record<string, T>,
  viewedId: string | null,
  lastViewedAt: Readonly<Record<string, number>>,
  now: number,
  ttl = MESSAGE_CACHE_TTL_MS
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = { ...conversations };
  for (const [id, conversation] of Object.entries(conversations)) {
    if (isMessageCacheHot(id, viewedId, lastViewedAt, now, ttl)) continue;
    if (conversation.messages.length === 0 && conversation.customEntries.length === 0) continue;
    next[id] = { ...conversation, messages: [], customEntries: [], historyBaseIndex: undefined };
    changed = true;
  }
  return changed ? next : conversations;
}

/** 已删会话的浏览/resync 时间戳不再占表 */
export function pruneSessionClocks(
  clocks: Record<string, number>,
  knownIds: ReadonlySet<string>
): void {
  for (const id of Object.keys(clocks)) {
    if (!knownIds.has(id)) delete clocks[id];
  }
}
