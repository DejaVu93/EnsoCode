export type TabCloseKind = 'self' | 'others' | 'right' | 'saved' | 'all';

/** 按 VS Code 标签页关闭语义，从有序列表里选出要关的 id。 */
export function idsToClose(
  orderedIds: readonly string[],
  targetId: string,
  kind: TabCloseKind,
  isSaved?: (id: string) => boolean
): string[] {
  const index = orderedIds.indexOf(targetId);
  if (index < 0) return [];
  switch (kind) {
    case 'self':
      return [targetId];
    case 'others':
      return orderedIds.filter((id) => id !== targetId);
    case 'right':
      return orderedIds.slice(index + 1);
    case 'saved':
      return orderedIds.filter((id) => isSaved?.(id) ?? true);
    case 'all':
      return [...orderedIds];
  }
}
