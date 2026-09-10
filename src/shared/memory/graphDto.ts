import type { UnitType } from './constants';

/**
 * 知识视图（图谱 / 知识树 / 解读 / 结晶）的 renderer 侧数据契约。
 * 与 dto.ts 一样：Main 内部类型不外泄，只给展示需要的字段。
 */

export interface GraphNodeDto {
  id: string;
  name: string;
  /** UPPER_SNAKE，见 constants.KG_ENTITY_TYPES */
  entityType: string;
  /** 提及该实体的记忆数，决定节点大小 */
  memoryCount: number;
  spaceId: string;
  spaceLabel: string;
}

export interface GraphEdgeDto {
  source: string;
  target: string;
  relation: string;
  strength: number;
}

export interface MemoryGraphDto {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  /** 实体总数；nodes 被 limit 截断时用于提示 */
  totalEntities: number;
}

export interface GraphQuery {
  spaceId?: string | null;
  /** 只保留提及数 ≥ 该值的实体，滤掉一次性噪声 */
  minMemories?: number;
  limit: number;
  /** 聚焦某个实体：只返回它与其邻居 */
  focusEntityId?: string | null;
}

export type TreeNodeKind = 'space' | 'group' | 'memory';

export interface TreeNodeDto {
  id: string;
  kind: TreeNodeKind;
  label: string;
  /** 该子树下的记忆数 */
  count: number;
  /** memory 节点才有：用于打开详情 */
  memoryId?: string;
  isCrystal?: boolean;
  children?: TreeNodeDto[];
}

export type TreeGrouping = 'unitType' | 'entity' | 'time';

export interface TreeQuery {
  spaceId?: string | null;
  groupBy: TreeGrouping;
  /** 每组最多列多少条记忆，避免把整库塞进 DOM */
  limitPerGroup: number;
}

export interface InsightRequest {
  /** 二选一：按实体解读，或按明确的记忆集合解读 */
  entityId?: string | null;
  memoryIds?: string[];
  spaceId?: string | null;
}

export interface InsightResult {
  ok: boolean;
  /** 解读正文（markdown） */
  text?: string;
  /** 参与解读的记忆条数 */
  sourceCount?: number;
  error?: string;
}

export interface CrystallizeRequest {
  memoryIds: string[];
  /** 留空则由模型拟标题 */
  title?: string;
}

export interface CrystallizeResult {
  ok: boolean;
  memoryId?: string;
  title?: string;
  content?: string;
  /** 命中候选网时返回，调用方决定是否强制写入 */
  candidates?: { id: string; title: string; similarity: number }[];
  error?: string;
}

export interface MemoryBriefDto {
  id: string;
  title: string;
  unitType: UnitType;
  contentSummary: string;
  isCrystal: boolean;
  updatedAt: string;
}

export function isGraphQuery(value: unknown): value is GraphQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.limit) || (row.limit as number) < 1 || (row.limit as number) > 500)
    return false;
  if (row.spaceId !== undefined && row.spaceId !== null && typeof row.spaceId !== 'string')
    return false;
  if (row.minMemories !== undefined && !Number.isSafeInteger(row.minMemories)) return false;
  if (
    row.focusEntityId !== undefined &&
    row.focusEntityId !== null &&
    typeof row.focusEntityId !== 'string'
  )
    return false;
  return true;
}

export function isTreeQuery(value: unknown): value is TreeQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.groupBy !== 'unitType' && row.groupBy !== 'entity' && row.groupBy !== 'time')
    return false;
  if (
    !Number.isSafeInteger(row.limitPerGroup) ||
    (row.limitPerGroup as number) < 1 ||
    (row.limitPerGroup as number) > 200
  )
    return false;
  if (row.spaceId !== undefined && row.spaceId !== null && typeof row.spaceId !== 'string')
    return false;
  return true;
}

export function isInsightRequest(value: unknown): value is InsightRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.entityId !== undefined && row.entityId !== null && typeof row.entityId !== 'string')
    return false;
  if (row.memoryIds !== undefined) {
    if (!Array.isArray(row.memoryIds) || row.memoryIds.some((id) => typeof id !== 'string'))
      return false;
  }
  if (row.spaceId !== undefined && row.spaceId !== null && typeof row.spaceId !== 'string')
    return false;
  return typeof row.entityId === 'string' || Array.isArray(row.memoryIds);
}

export function isCrystallizeRequest(value: unknown): value is CrystallizeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.memoryIds) || row.memoryIds.some((id) => typeof id !== 'string'))
    return false;
  if (row.title !== undefined && typeof row.title !== 'string') return false;
  return true;
}
