import { CRYSTAL_MIN_SOURCES } from '@shared/memory/constants';
import type Database from 'better-sqlite3';
import {
  type CreateMemoryOptions,
  createMemory,
  getMemory,
  MEMORY_COLUMNS,
  type MemoryRow,
  rowToMemory,
} from './store';
import { type CreateMemoryResult, type Memory, MemoryValidationError } from './types';

const SOURCE_COLUMNS = MEMORY_COLUMNS.split(', ')
  .map((c) => `m.${c}`)
  .join(', ');

/**
 * Crystal：不是独立节点，是 `is_crystal = 1` 的 Memory + CRYSTALLIZED_FROM 边，
 * 至少 CRYSTAL_MIN_SOURCES 个源。
 */

export interface CreateCrystalInput {
  /** 结晶正文（合成后的知识，必须比单条源更有信息） */
  content: string;
  /** 结晶标题；也写进 memories.crystal_title */
  title: string;
  /** 源记忆 id，去重后至少 CRYSTAL_MIN_SOURCES 个，必须同 space 且处于活动状态 */
  sourceIds: string[];
  spaceId: string;
  importance?: number;
  /** 与创建普通记忆一致：不传就走 0.80 候选网 */
  force?: boolean;
}

export interface CrystalSource {
  memory: Memory;
  contributionWeight: number;
}

/**
 * 源集校验 → 复用 createMemory（含候选网、embedding、幂等），并通过 inTransaction 在同一事务内
 * 打 crystal 标位、写 CRYSTALLIZED_FROM 边（候选检查 / 关系写入 / 插入同事务）：边写失败则整行回滚，
 * 不会留下“普通记忆”半成品。候选网命中时原样返回 `candidates_found`，不写任何东西。
 * 正文与已有记忆完全相同（hash 去重命中）时拒绝：不能把旧的普通记忆就地改成 crystal。
 */
export async function createCrystal(
  db: Database.Database,
  input: CreateCrystalInput,
  opts: CreateMemoryOptions = {}
): Promise<CreateMemoryResult> {
  const sourceIds = [...new Set(input.sourceIds)];
  if (sourceIds.length < CRYSTAL_MIN_SOURCES) {
    throw new MemoryValidationError(
      'crystal_sources',
      `a crystal needs at least ${CRYSTAL_MIN_SOURCES} distinct source memories, got ${sourceIds.length}`
    );
  }
  for (const id of sourceIds) {
    const source = getMemory(db, id);
    if (source?.lifecycleState !== 'active') {
      throw new MemoryValidationError(
        'crystal_sources',
        `source memory not found or inactive: ${id}`
      );
    }
    if (source.spaceId !== input.spaceId) {
      throw new MemoryValidationError(
        'crystal_sources',
        `source memory ${id} belongs to another space: ${source.spaceId}`
      );
    }
  }

  const ts = (opts.now ?? new Date()).toISOString();
  const result = await createMemory(
    db,
    {
      content: input.content,
      title: input.title,
      spaceId: input.spaceId,
      importance: input.importance,
      source: 'distill',
      force: input.force,
    },
    {
      ...opts,
      inTransaction: (tx, id) => {
        tx.prepare(
          'UPDATE memories SET is_crystal = 1, crystal_title = ?, source_unit_count = ? WHERE id = ?'
        ).run(input.title, sourceIds.length, id);
        const edge = tx.prepare(
          `INSERT INTO crystallized_from (crystal_id, source_id, contribution_weight, created_at)
           VALUES (?, ?, ?, ?)`
        );
        // 贡献权重均分：没有逐源打分的后台流程，均分比编一个假分数诚实
        const weight = 1 / sourceIds.length;
        for (const sourceId of sourceIds) edge.run(id, sourceId, weight, ts);
      },
    }
  );
  if (result.status === 'inserted' && result.deduplicated) {
    throw new MemoryValidationError(
      'crystal_duplicate',
      `an identical memory already exists (${result.memory.id}); write a synthesis that adds information, or force=true`
    );
  }
  return result;
}

/** 某个结晶的源记忆（按写入顺序） */
export function listCrystalSources(db: Database.Database, crystalId: string): CrystalSource[] {
  const rows = db
    .prepare(
      `SELECT ${SOURCE_COLUMNS}, c.contribution_weight AS contribution_weight
       FROM crystallized_from c JOIN memories m ON m.id = c.source_id
       WHERE c.crystal_id = ? ORDER BY c.created_at ASC, m.id ASC`
    )
    .all(crystalId) as (MemoryRow & { contribution_weight: number })[];
  return rows.map((r) => ({ memory: rowToMemory(r), contributionWeight: r.contribution_weight }));
}

/** 引用了某条记忆的结晶（判断「已有 crystal 覆盖同一主题」用） */
export function listCrystalsForSource(db: Database.Database, sourceId: string): Memory[] {
  const rows = db
    .prepare(
      `SELECT ${SOURCE_COLUMNS}
       FROM crystallized_from c JOIN memories m ON m.id = c.crystal_id
       WHERE c.source_id = ? ORDER BY m.created_at DESC, m.id ASC`
    )
    .all(sourceId) as MemoryRow[];
  return rows.map(rowToMemory);
}
