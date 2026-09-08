import fs from 'node:fs';
import path from 'node:path';

/** Changes 面板「Session」模式的编辑前快照：userData/changes-snapshots/<conversationId>.json */
const isValidId = (id: string): boolean => /^[a-f0-9-]{36}$/i.test(id);

const file = (dir: string, id: string): string => path.join(dir, `${id}.json`);

export function readSnapshots(dir: string, conversationId: string): Record<string, string> {
  if (!isValidId(conversationId)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file(dir, conversationId), 'utf8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** 整文件原子写；空对象即删除 */
export function writeSnapshots(
  dir: string,
  conversationId: string,
  snapshots: Record<string, string>
): boolean {
  if (!isValidId(conversationId)) return false;
  const target = file(dir, conversationId);
  try {
    if (Object.keys(snapshots).length === 0) {
      fs.rmSync(target, { force: true });
      return true;
    }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshots), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

/** settings.json 里 enso-conversations 的会话 id 集合；读不到会话表返回 null，调用方应跳过清理 */
export function liveConversationIds(settings: unknown): Set<string> | null {
  const state = (
    settings as { 'enso-conversations'?: { state?: { conversations?: unknown } } } | null
  )?.['enso-conversations']?.state;
  const conversations = state?.conversations;
  if (!conversations || typeof conversations !== 'object' || Array.isArray(conversations)) {
    return null;
  }
  return new Set(Object.keys(conversations));
}

/** 删掉已不存在会话的快照；非 uuid 命名的文件不动 */
export function pruneSnapshots(dir: string, liveIds: ReadonlySet<string>): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    if (!isValidId(id) || liveIds.has(id)) continue;
    fs.rmSync(path.join(dir, name), { force: true });
  }
}
