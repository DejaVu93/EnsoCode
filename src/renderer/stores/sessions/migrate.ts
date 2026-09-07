/**
 * sessions 持久化数据的版本迁移。
 *
 * 为什么用 zustand persist 的 `migrate` 而不是 `onRehydrateStorage`（对齐 settings/migrate.ts）：
 * `migrate` 只在持久版本落后时跑一次，跑完 persist 会把结果写回磁盘，旧字段就此消失；
 * `onRehydrateStorage` 每次 rehydrate 都会执行且不触发回写，等于把一次性的形状迁移
 * 变成永久的读侧补丁——且就地 mutate 不经过 setState，订阅方收不到变更。
 */

/** 当前持久化数据版本；改数据形状时 +1 并在 `migrateSessions` 里加一段 */
export const SESSIONS_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * v0 → v1：started 是运行态，历史版本误将其持久化，导致重启后 ChatView 的
 * `!started` 自动恢复门永假（会话点开空白、无报错、不重试）。一律清 false；
 * 无 sessionFile 的已启动会话重启后无从回放，落终态并带错误文案。
 */
function migrateConversationV1(conversation: Record<string, unknown>): Record<string, unknown> {
  const orphaned = conversation.started === true && !conversation.sessionFile;
  return {
    ...conversation,
    started: false,
    ...(orphaned
      ? { status: 'failed', error: 'Session ended — history not restored' }
      : { status: 'idle' }),
  };
}

/** v1 → v2：旧 persist 缺运行态集合，卡死巡检会对 undefined 做 Object.keys。 */
function migrateConversationV2(conversation: Record<string, unknown>): Record<string, unknown> {
  return {
    ...conversation,
    toolOutputs: asRecord(conversation.toolOutputs),
    toolStartedAt: asRecord(conversation.toolStartedAt),
    pendingApprovals: asArray(conversation.pendingApprovals),
    pendingAsks: asArray(conversation.pendingAsks),
    backgroundTasks: asArray(conversation.backgroundTasks),
    subagents: asArray(conversation.subagents),
    customEntries: asArray(conversation.customEntries),
    dispatchMainEvents: asRecord(conversation.dispatchMainEvents),
  };
}

export function migrateSessions(persisted: unknown, version: number): unknown {
  if (version >= SESSIONS_VERSION) return persisted;
  if (!isRecord(persisted)) return persisted;

  const state = { ...persisted };
  if (!isRecord(state.conversations)) return state;

  state.conversations = Object.fromEntries(
    Object.entries(state.conversations).map(([id, entry]) => {
      if (!isRecord(entry)) return [id, entry];
      let conversation = entry;
      if (version < 1) conversation = migrateConversationV1(conversation);
      if (version < 2) conversation = migrateConversationV2(conversation);
      return [id, conversation];
    })
  );
  return state;
}
