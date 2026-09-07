import type { TimelineItem } from '@/stores/sessions/timeline';

/** 工作区内相对路径；绝对路径、`..` 逃逸返回 null。 */
export function workspaceRel(rel: string): string | null {
  const trimmed = rel.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return null;
  const parts = trimmed.split(/[/\\]/).filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.includes('..')) return null;
  return parts.join('/');
}

/** 文件相对路径的每一层祖先目录（不含文件名；工作区根文件 / 树外路径为空）。 */
export function ancestorDirs(rel: string): string[] {
  const normalized = workspaceRel(rel);
  if (!normalized) return [];
  const parts = normalized.split('/');
  if (parts.length <= 1) return [];
  const dirs: string[] = [];
  let acc = '';
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    dirs.push(acc);
  }
  return dirs;
}

export interface CompletedWrites {
  refreshRels: string[];
  nextSeen: Set<string> | null;
}

/**
 * 打开 Files / 切会话 / 历史未权威时 `seen === null` 或 `authoritative === false`：
 * 只占位已完成 write，不刷新。之后只把新完成的 write（有 result，非 speculative）
 * 当作树刷新目标。树外路径会占位，但不进 refreshRels。
 */
export function applyCompletedWrites(
  timeline: TimelineItem[],
  seen: Set<string> | null,
  authoritative = true
): CompletedWrites {
  if (!authoritative) return { refreshRels: [], nextSeen: null };
  const completed: { key: string; rel: string | null }[] = [];
  const visit = (items: TimelineItem[]) => {
    for (const item of items) {
      if (item.kind === 'tool-group') {
        visit(item.children);
        continue;
      }
      if (item.kind !== 'tool' || item.state !== 'ok' || item.name !== 'write') continue;
      if (item.output === null && item.durationMs === null) continue;
      if (!item.summary) continue;
      completed.push({ key: item.key, rel: workspaceRel(item.summary) });
    }
  };
  visit(timeline);
  const nextSeen = new Set(completed.map((item) => item.key));
  if (seen === null) return { refreshRels: [], nextSeen };
  return {
    refreshRels: completed
      .filter((item) => !seen.has(item.key) && item.rel)
      .map((item) => item.rel as string),
    nextSeen,
  };
}
