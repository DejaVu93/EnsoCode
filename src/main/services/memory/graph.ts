import type { UnitType } from '@shared/memory/constants';
import type {
  GraphEdgeDto,
  GraphNodeDto,
  GraphQuery,
  MemoryBriefDto,
  MemoryGraphDto,
  TreeNodeDto,
  TreeQuery,
} from '@shared/memory/graphDto';
import type Database from 'better-sqlite3';

/**
 * 知识图谱 / 知识树的查询层。纯 SQL，不碰 electron 也不调 LLM，便于单测。
 * 图数据来自 entities / entity_relations / mentions。
 */

const SUMMARY_CHARS = 160;
const ACTIVE = "m.is_latest = 1 AND m.lifecycle_state = 'active'";

function summarize(content: string): string {
  const chars = Array.from(content.replace(/\s+/g, ' ').trim());
  return chars.length <= SUMMARY_CHARS
    ? chars.join('')
    : `${chars.slice(0, SUMMARY_CHARS).join('')}…`;
}

interface EntityRow {
  id: string;
  name: string;
  entity_type: string;
  space_id: string;
  memory_count: number;
}

/**
 * 实体节点按「被多少条活动记忆提及」排序取前 N——只出现一次的实体多是抽取噪声，
 * 全画出来会让图糊成一团。focusEntityId 时改为取该实体 + 直接邻居。
 */
export function buildMemoryGraph(db: Database.Database, query: GraphQuery): MemoryGraphDto {
  const params: unknown[] = [];
  const scope: string[] = [];
  if (query.spaceId) {
    scope.push('e.space_id = ?');
    params.push(query.spaceId);
  }
  const where = scope.length > 0 ? `WHERE ${scope.join(' AND ')}` : '';
  const minMemories = Math.max(1, query.minMemories ?? 1);

  const totalEntities = (
    db.prepare(`SELECT count(*) AS n FROM entities e ${where}`).get(...params) as { n: number }
  ).n;

  const focusIds = query.focusEntityId
    ? new Set(
        [
          query.focusEntityId,
          ...(
            db
              .prepare(
                `SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END AS id
                 FROM entity_relations WHERE source_id = ? OR target_id = ?`
              )
              .all(query.focusEntityId, query.focusEntityId, query.focusEntityId) as {
              id: string;
            }[]
          ).map((r) => r.id),
        ].filter(Boolean)
      )
    : null;

  const rows = db
    .prepare(
      // 必须数 JOIN 之后的 m.id：mn.memory_id 不受 ACTIVE 约束，归档/旧版本会被算进来
      `SELECT e.id, e.name, e.entity_type, e.space_id,
              count(DISTINCT m.id) AS memory_count
       FROM entities e
       LEFT JOIN mentions mn ON mn.entity_id = e.id
       LEFT JOIN memories m ON m.id = mn.memory_id AND ${ACTIVE}
       ${where}
       GROUP BY e.id
       HAVING count(DISTINCT m.id) >= ?
       ORDER BY count(DISTINCT m.id) DESC, e.name ASC
       LIMIT ?`
    )
    .all(...params, minMemories, query.limit) as EntityRow[];

  const picked = focusIds ? rows.filter((r) => focusIds.has(r.id)) : rows;
  const nodes: GraphNodeDto[] = picked.map((r) => ({
    id: r.id,
    name: r.name,
    entityType: r.entity_type,
    memoryCount: r.memory_count,
    spaceId: r.space_id,
    spaceLabel: r.space_id,
  }));

  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size === 0) return { nodes: [], edges: [], totalEntities };
  const marks = [...ids].map(() => '?').join(',');
  const edges = (
    db
      .prepare(
        `SELECT source_id AS source, target_id AS target, relation_type AS relation, strength
         FROM entity_relations
         WHERE source_id IN (${marks}) AND target_id IN (${marks})
         ORDER BY strength DESC`
      )
      .all(...ids, ...ids) as GraphEdgeDto[]
  ).filter((e) => e.source !== e.target);

  return { nodes, edges, totalEntities };
}

/** 某实体关联的活动记忆（图谱点击节点后展示） */
export function memoriesForEntity(
  db: Database.Database,
  entityId: string,
  limit = 50
): MemoryBriefDto[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.title, m.content, m.unit_type, m.is_crystal, m.updated_at
       FROM memories m
       JOIN mentions mn ON mn.memory_id = m.id
       WHERE mn.entity_id = ? AND ${ACTIVE}
       ORDER BY m.is_crystal DESC, m.updated_at DESC
       LIMIT ?`
    )
    .all(entityId, limit) as {
    id: string;
    title: string;
    content: string;
    unit_type: string;
    is_crystal: number;
    updated_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    unitType: r.unit_type as UnitType,
    contentSummary: summarize(r.content),
    isCrystal: r.is_crystal === 1,
    updatedAt: r.updated_at,
  }));
}

interface MemoryRowLite {
  id: string;
  title: string;
  content: string;
  unit_type: string;
  is_crystal: number;
  space_id: string;
  updated_at: string;
}

const memoryNode = (r: MemoryRowLite): TreeNodeDto => ({
  id: `memory:${r.id}`,
  kind: 'memory',
  label: r.title,
  count: 1,
  memoryId: r.id,
  isCrystal: r.is_crystal === 1,
});

/**
 * 知识树：一层分组 + 组内记忆。分组维度三选一——
 * unitType（记忆本身的类型）、entity（提及的实体，一条记忆可出现在多组）、time（按月）。
 */
export function buildMemoryTree(db: Database.Database, query: TreeQuery): TreeNodeDto[] {
  const params: unknown[] = [];
  const scope: string[] = [ACTIVE];
  if (query.spaceId) {
    scope.push('m.space_id = ?');
    params.push(query.spaceId);
  }
  const where = scope.join(' AND ');
  const limit = query.limitPerGroup;

  if (query.groupBy === 'entity') {
    const groups = db
      .prepare(
        `SELECT e.id, e.name, count(DISTINCT m.id) AS n
         FROM entities e
         JOIN mentions mn ON mn.entity_id = e.id
         JOIN memories m ON m.id = mn.memory_id
         WHERE ${where}
         GROUP BY e.id ORDER BY n DESC, e.name ASC LIMIT 100`
      )
      .all(...params) as { id: string; name: string; n: number }[];
    return groups.map((g) => ({
      id: `entity:${g.id}`,
      kind: 'group' as const,
      label: g.name,
      count: g.n,
      children: (
        db
          .prepare(
            `SELECT m.id, m.title, m.content, m.unit_type, m.is_crystal, m.space_id, m.updated_at
             FROM memories m JOIN mentions mn ON mn.memory_id = m.id
             WHERE mn.entity_id = ? AND ${where}
             ORDER BY m.is_crystal DESC, m.updated_at DESC LIMIT ?`
          )
          .all(g.id, ...params, limit) as MemoryRowLite[]
      ).map(memoryNode),
    }));
  }

  const groupExpr = query.groupBy === 'time' ? 'substr(m.created_at, 1, 7)' : 'm.unit_type';
  const groups = db
    .prepare(
      `SELECT ${groupExpr} AS key, count(*) AS n FROM memories m
       WHERE ${where} GROUP BY key ORDER BY ${query.groupBy === 'time' ? 'key DESC' : 'n DESC'}`
    )
    .all(...params) as { key: string; n: number }[];

  return groups.map((g) => ({
    id: `${query.groupBy}:${g.key}`,
    kind: 'group' as const,
    label: g.key,
    count: g.n,
    children: (
      db
        .prepare(
          `SELECT m.id, m.title, m.content, m.unit_type, m.is_crystal, m.space_id, m.updated_at
           FROM memories m WHERE ${where} AND ${groupExpr} = ?
           ORDER BY m.is_crystal DESC, m.updated_at DESC LIMIT ?`
        )
        .all(...params, g.key, limit) as MemoryRowLite[]
    ).map(memoryNode),
  }));
}

/** 解读 / 结晶的输入：把记忆压成给模型看的紧凑文本 */
export function memoriesForPrompt(
  db: Database.Database,
  memoryIds: readonly string[],
  maxChars = 6000
): { text: string; count: number } {
  if (memoryIds.length === 0) return { text: '', count: 0 };
  const marks = memoryIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT m.id, m.title, m.content, m.unit_type, m.created_at
       FROM memories m WHERE m.id IN (${marks}) AND m.lifecycle_state != 'deleted'
       ORDER BY m.created_at ASC`
    )
    .all(...memoryIds) as {
    id: string;
    title: string;
    content: string;
    unit_type: string;
    created_at: string;
  }[];
  const parts: string[] = [];
  let used = 0;
  let count = 0;
  for (const r of rows) {
    const block = `[${r.unit_type}] ${r.title}\n${r.content}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
    count++;
  }
  return { text: parts.join('\n\n'), count };
}

/** 某实体下用于解读的记忆 id（按 crystal 优先、近期优先） */
export function entityMemoryIds(db: Database.Database, entityId: string, limit = 30): string[] {
  return (
    db
      .prepare(
        `SELECT m.id FROM memories m JOIN mentions mn ON mn.memory_id = m.id
         WHERE mn.entity_id = ? AND ${ACTIVE}
         ORDER BY m.is_crystal DESC, m.updated_at DESC LIMIT ?`
      )
      .all(entityId, limit) as { id: string }[]
  ).map((r) => r.id);
}
