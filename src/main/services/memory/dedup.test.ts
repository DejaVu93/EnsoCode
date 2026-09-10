import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEDUP_MIN_CHARS } from '@shared/memory/constants';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentHash, normalizeContent } from './contentHash';
import { openMemoryDb } from './db';
import { searchMemories } from './search';
import { createMemory, getMemory, listEvolves, reviewEvolves, updateMemory } from './store';
import { type Embedder, projectSpaceId } from './types';

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-memory-dedup-'));
  db = openMemoryDb(path.join(dir, 'memory.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = () => (db.prepare('SELECT count(*) AS n FROM memories').get() as { n: number }).n;
const LONG_PG =
  '选用 PostgreSQL 做主库，读写分离与逻辑复制后续再议；理由是团队熟悉且生态成熟。'.repeat(3);
const LONG_MY =
  'MySQL 8 作为报表从库，只读副本承接 BI 查询；理由是现有 BI 工具只支持 MySQL 协议。'.repeat(3);

/** 关键字向量：命中的关键字维=1，用来构造可预测的余弦相似度 */
function keywordEmbedder(keys: string[]): Embedder {
  const calls: string[] = [];
  const e: Embedder & { calls: string[] } = {
    model: 'kw',
    dim: keys.length,
    calls,
    embed: async (text) => {
      calls.push(text);
      return Float32Array.from(keys.map((k) => (text.includes(k) ? 1 : 0)));
    },
  };
  return e;
}
const constantEmbedder = (): Embedder => ({
  model: 'const',
  dim: 2,
  embed: async () => Float32Array.from([1, 0]),
});

describe('content_hash 精确去重', () => {
  it('规范化：NFC、trim、连续空白折叠；大小写不折叠', () => {
    expect(normalizeContent('  a \n\t b  ')).toBe('a b');
    expect(normalizeContent('e\u0301')).toBe('\u00e9');
    expect(contentHash('A b')).not.toBe(contentHash('a b'));
    expect(contentHash(' a   b ')).toBe(contentHash('a b'));
  });

  it('同 space 完全相同内容（含空白差异）返回已有行，不嵌入、不建候选网、不写入', async () => {
    const e = keywordEmbedder(['PostgreSQL']) as Embedder & { calls: string[] };
    const a = await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    if (a.status !== 'inserted') throw new Error();
    e.calls.length = 0;
    const b = await createMemory(
      db,
      { content: `  ${LONG_PG.replace(/ /g, '\n\n  ')}  `, spaceId: 'global' },
      { embedder: e }
    );
    expect(b).toMatchObject({ status: 'inserted', deduplicated: true });
    if (b.status !== 'inserted') throw new Error();
    expect(b.memory.id).toBe(a.memory.id);
    expect(e.calls).toEqual([]);
    expect(count()).toBe(1);
    // 短文本也走 hash（不受 DEDUP_MIN_CHARS 限制）
    const s1 = await createMemory(db, { content: 'k8s', spaceId: 'global' });
    const s2 = await createMemory(db, { content: 'k8s ', spaceId: 'global' });
    if (s1.status !== 'inserted' || s2.status !== 'inserted') throw new Error();
    expect(s2.memory.id).toBe(s1.memory.id);
    expect(count()).toBe(2);
  });

  it('不同 space 同内容各存一份；旧版本（is_latest=0）不参与 hash 去重', async () => {
    const a = await createMemory(db, { content: 'k8s', spaceId: 'global' });
    const p = await createMemory(db, { content: 'k8s', spaceId: projectSpaceId('p1') });
    if (a.status !== 'inserted' || p.status !== 'inserted') throw new Error();
    expect(p.memory.id).not.toBe(a.memory.id);
    updateMemory(db, a.memory.id, { isLatest: false });
    const again = await createMemory(db, { content: 'k8s', spaceId: 'global' });
    if (again.status !== 'inserted') throw new Error();
    expect(again.memory.id).not.toBe(a.memory.id);
    expect(again.deduplicated).toBeUndefined();
  });

  it('idempotency_key 与 content_hash 互不影响：不同 key 相同内容仍按 hash 去重，相同 key 优先返回', async () => {
    const a = await createMemory(db, { content: 'k8s', spaceId: 'global', idempotencyKey: 'k1' });
    const b = await createMemory(db, { content: 'k8s', spaceId: 'global', idempotencyKey: 'k2' });
    if (a.status !== 'inserted' || b.status !== 'inserted') throw new Error();
    expect(b.memory.id).toBe(a.memory.id);
    expect(getMemory(db, a.memory.id)?.idempotencyKey).toBe('k1');
  });

  it('updateMemory 改正文后 content_hash 跟着变，v4 迁移为旧行回填 hash', async () => {
    const a = await createMemory(db, { content: 'old body', spaceId: 'global' });
    if (a.status !== 'inserted') throw new Error();
    updateMemory(db, a.memory.id, { content: 'new body' });
    const row = db.prepare('SELECT content_hash FROM memories WHERE id = ?').get(a.memory.id) as {
      content_hash: string;
    };
    expect(row.content_hash).toBe(contentHash('new body'));
    const dup = await createMemory(db, { content: 'new body', spaceId: 'global' });
    if (dup.status !== 'inserted') throw new Error();
    expect(dup.memory.id).toBe(a.memory.id);
  });
});

describe('向量候选网', () => {
  it('近重复不写入：mock embed 返回同一向量 → candidates_found，不写入', async () => {
    const e = constantEmbedder();
    const a = await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    if (a.status !== 'inserted') throw new Error();
    const r = await createMemory(db, { content: LONG_MY, spaceId: 'global' }, { embedder: e });
    expect(r.status).toBe('candidates_found');
    if (r.status !== 'candidates_found') throw new Error();
    expect(r.candidates.map((c) => c.memory.id)).toEqual([a.memory.id]);
    expect(r.candidates[0].similarity).toBeCloseTo(1, 6);
    expect(r.candidates[0].memory.content).toBe(LONG_PG);
    expect(count()).toBe(1);
  });

  it('准入只看向量相似度 ≥ 0.80；bm25_top1 只是返回字段', async () => {
    // 三维关键字：候选 A 与新文共享 2/2 关键字（cos=1），B 只共享 1/2（cos≈0.707 < 0.8）
    const e = keywordEmbedder(['PostgreSQL', '主库', 'MySQL']);
    const a = await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    await createMemory(db, { content: LONG_MY, spaceId: 'global' }, { embedder: e });
    if (a.status !== 'inserted') throw new Error();
    const r = await createMemory(
      db,
      { content: '我们把 PostgreSQL 定为主库，这是最终决定。'.repeat(5), spaceId: 'global' },
      { embedder: e }
    );
    if (r.status !== 'candidates_found') throw new Error(r.status);
    expect(r.candidates.map((c) => c.memory.id)).toEqual([a.memory.id]);
    expect(r.candidates[0].bm25Top1).toBe(true);
    expect(count()).toBe(2);
  });

  it('候选网范围：同 space、is_latest、非 crystal；长度 < DEDUP_MIN_CHARS 跳过', async () => {
    const e = constantEmbedder();
    const other = await createMemory(
      db,
      { content: LONG_PG, spaceId: projectSpaceId('p1') },
      { embedder: e }
    );
    if (other.status !== 'inserted') throw new Error();
    // 别的 space 的相似行不算候选
    const g = await createMemory(db, { content: LONG_MY, spaceId: 'global' }, { embedder: e });
    expect(g.status).toBe('inserted');
    if (g.status !== 'inserted') throw new Error();
    // 旧版本不算候选
    updateMemory(db, g.memory.id, { isLatest: false });
    const g2 = await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    expect(g2.status).toBe('inserted');
    // crystal 不算候选
    db.prepare('UPDATE memories SET is_crystal = 1 WHERE space_id = ? AND is_latest = 1').run(
      'global'
    );
    const g3 = await createMemory(db, { content: LONG_MY, spaceId: 'global' }, { embedder: e });
    expect(g3.status).toBe('inserted');
    // 短文本跳过候选网
    const short = '短决策：用 pnpm。';
    expect(Array.from(short).length).toBeLessThan(DEDUP_MIN_CHARS);
    const s1 = await createMemory(db, { content: short, spaceId: 'global' }, { embedder: e });
    const s2 = await createMemory(db, { content: `${short}!`, spaceId: 'global' }, { embedder: e });
    expect(s1.status).toBe('inserted');
    expect(s2.status).toBe('inserted');
  });

  it('crystal / 非 active 行不占 KNN 名额：它们比合格候选更近时，合格候选仍被找到（Minor 1）', async () => {
    // 六条 crystal 与新文向量完全相同（cos=1），一条合格 active 行 cos≈0.9；若 KNN 名额被 crystal 吃掉就漏网
    const e: Embedder = {
      model: 'kw',
      dim: 2,
      embed: async (text) =>
        text.includes('MySQL') ? Float32Array.from([0.9, 0.436]) : Float32Array.from([1, 0]),
    };
    const near = await createMemory(db, { content: LONG_MY, spaceId: 'global' }, { embedder: e });
    if (near.status !== 'inserted') throw new Error();
    for (let i = 0; i < 6; i++) {
      const r = await createMemory(
        db,
        { content: `${LONG_PG} #${i}`, spaceId: 'global', force: true },
        { embedder: e }
      );
      if (r.status !== 'inserted') throw new Error(r.status);
      db.prepare(
        i % 2
          ? 'UPDATE memories SET is_crystal = 1 WHERE id = ?'
          : "UPDATE memories SET lifecycle_state = 'archived' WHERE id = ?"
      ).run(r.memory.id);
    }
    const r = await createMemory(
      db,
      { content: `${LONG_PG} 新`, spaceId: 'global' },
      { embedder: e }
    );
    expect(r.status).toBe('candidates_found');
    if (r.status !== 'candidates_found') throw new Error();
    expect(r.candidates.map((c) => c.memory.id)).toEqual([near.memory.id]);
  });

  it('候选最多 DEDUP_MAX=3，按相似度降序', async () => {
    const e = constantEmbedder();
    for (let i = 0; i < 5; i++) {
      const r = await createMemory(
        db,
        { content: `${LONG_PG} 变体 ${i}`, spaceId: 'global', force: true },
        { embedder: e }
      );
      expect(r.status).toBe('inserted');
    }
    const r = await createMemory(db, { content: LONG_MY, spaceId: 'global' }, { embedder: e });
    if (r.status !== 'candidates_found') throw new Error();
    expect(r.candidates).toHaveLength(3);
    expect(count()).toBe(5);
  });

  it('降级：没有 embedder / embed 失败 / 扩展未加载 → 跳过向量网只做 content_hash，照常写入', async () => {
    const e = constantEmbedder();
    await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    // 无 embedder
    const r1 = await createMemory(db, { content: LONG_MY, spaceId: 'global' });
    expect(r1.status).toBe('inserted');
    // embed 抛错
    const broken: Embedder = {
      model: 'const',
      dim: 2,
      embed: async () => {
        throw new Error('boom');
      },
    };
    const r2 = await createMemory(
      db,
      { content: `${LONG_MY} 2`, spaceId: 'global' },
      { embedder: broken }
    );
    expect(r2.status).toBe('inserted');
    // hash 仍生效
    const r3 = await createMemory(db, { content: LONG_MY, spaceId: 'global' });
    expect(r3).toMatchObject({ status: 'inserted', deduplicated: true });
    expect(count()).toBe(3);

    // sqlite-vec 未加载：BLOB 兜底仍能判出候选
    const plain = openMemoryDb(path.join(dir, 'novec.db'), { vecExtensionPath: null });
    try {
      await createMemory(plain, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
      const r = await createMemory(plain, { content: LONG_MY, spaceId: 'global' }, { embedder: e });
      expect(r.status).toBe('candidates_found');
    } finally {
      plain.close();
    }
  });

  it('并发去重：两个连接同时写相同内容只留一行', async () => {
    const other = openMemoryDb(path.join(dir, 'memory.db'));
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          createMemory(i % 2 ? db : other, { content: 'race body', spaceId: 'global' })
        )
      );
      const ids = new Set(results.map((r) => (r.status === 'inserted' ? r.memory.id : '')));
      expect(ids.size).toBe(1);
      expect(count()).toBe(1);
    } finally {
      other.close();
    }
  });
});

describe('evolves', () => {
  const e = constantEmbedder();

  it('replaces：旧行 is_latest=0，新行 version+1，搜索只见新行', async () => {
    const old = await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    if (old.status !== 'inserted') throw new Error();
    const fresh = await createMemory(
      db,
      {
        content: `${LONG_PG} 补充：主库版本锁定 PostgreSQL 16。`,
        spaceId: 'global',
        evolvesFromId: old.memory.id,
        evolvesRelation: 'replaces',
        force: true,
      },
      { embedder: e }
    );
    if (fresh.status !== 'inserted') throw new Error();
    expect(getMemory(db, old.memory.id)?.isLatest).toBe(false);
    expect(fresh.memory.isLatest).toBe(true);
    expect(fresh.memory.version).toBe(2);
    expect(fresh.evolves).toMatchObject({
      olderId: old.memory.id,
      newerId: fresh.memory.id,
      relation: 'replaces',
      reviewState: 'accepted',
    });
    const hits = await searchMemories(db, { q: 'PostgreSQL', spaceIds: ['global'] });
    expect(hits.map((h) => h.memory.id)).toEqual([fresh.memory.id]);
    // 旧行不再占 vec 名额
    const vecRows = db.prepare('SELECT count(*) AS n FROM memory_vec_2').get() as { n: number };
    expect(vecRows.n).toBe(1);
  });

  it('enriches / confirms 不改旧行', async () => {
    for (const relation of ['enriches', 'confirms'] as const) {
      const old = await createMemory(db, { content: `${LONG_PG} ${relation}`, spaceId: 'global' });
      if (old.status !== 'inserted') throw new Error();
      const fresh = await createMemory(db, {
        content: `${LONG_MY} ${relation}`,
        spaceId: 'global',
        evolvesFromId: old.memory.id,
        evolvesRelation: relation,
      });
      if (fresh.status !== 'inserted') throw new Error();
      const after = getMemory(db, old.memory.id)!;
      expect(after.isLatest).toBe(true);
      expect(after.updatedAt).toBe(old.memory.updatedAt);
      expect(fresh.memory.isLatest).toBe(true);
      expect(listEvolves(db, old.memory.id).map((x) => x.relation)).toEqual([relation]);
    }
  });

  it('challenges：写关系 + pending 审阅；拒绝不删关系不改 is_latest', async () => {
    // 内容满足长度阈值且向量相同 —— 若不带关系会落到 candidates_found，这里走显式关系提交路径
    const a = await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    if (a.status !== 'inserted') throw new Error();
    const b = await createMemory(
      db,
      {
        content: LONG_MY,
        spaceId: 'global',
        evolvesFromId: a.memory.id,
        evolvesRelation: 'challenges',
        evolvesReason: '报表库选型与主库结论冲突',
        force: true,
      },
      { embedder: e }
    );
    if (b.status !== 'inserted') throw new Error();
    expect(getMemory(db, a.memory.id)?.isLatest).toBe(true);
    expect(getMemory(db, b.memory.id)?.isLatest).toBe(true);
    const [edge] = listEvolves(db, a.memory.id);
    expect(edge).toMatchObject({
      relation: 'challenges',
      reviewState: 'pending',
      reviewedAt: null,
    });
    const rejected = reviewEvolves(db, edge.id, 'rejected', {
      now: new Date('2025-03-01T00:00:00Z'),
    });
    expect(rejected).toMatchObject({
      reviewState: 'rejected',
      reviewedAt: '2025-03-01T00:00:00.000Z',
    });
    expect(listEvolves(db, a.memory.id)).toHaveLength(1);
    expect(getMemory(db, a.memory.id)?.isLatest).toBe(true);
    expect(getMemory(db, b.memory.id)?.isLatest).toBe(true);
    expect(count()).toBe(2);
  });

  it('显式关系跳过候选网（短文本亦然）；非法关系 / 缺一半 / 不存在 / 跨 space 拒绝且不写入', async () => {
    const a = await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    if (a.status !== 'inserted') throw new Error();
    const r = await createMemory(
      db,
      {
        content: LONG_MY,
        spaceId: 'global',
        evolvesFromId: a.memory.id,
        evolvesRelation: 'enriches',
      },
      { embedder: e }
    );
    expect(r.status).toBe('inserted');
    await expect(
      createMemory(db, {
        content: 'x',
        spaceId: 'global',
        evolvesFromId: a.memory.id,
        evolvesRelation: 'supersedes' as never,
      })
    ).rejects.toMatchObject({ code: 'invalid_evolves' });
    await expect(
      createMemory(db, { content: 'x', spaceId: 'global', evolvesFromId: a.memory.id })
    ).rejects.toMatchObject({ code: 'invalid_evolves' });
    await expect(
      createMemory(db, { content: 'x', spaceId: 'global', evolvesRelation: 'confirms' })
    ).rejects.toMatchObject({ code: 'invalid_evolves' });
    await expect(
      createMemory(db, {
        content: 'x',
        spaceId: 'global',
        evolvesFromId: 'missing',
        evolvesRelation: 'confirms',
      })
    ).rejects.toMatchObject({ code: 'evolves_target_not_found' });
    await expect(
      createMemory(db, {
        content: 'x',
        spaceId: projectSpaceId('p1'),
        evolvesFromId: a.memory.id,
        evolvesRelation: 'confirms',
      })
    ).rejects.toMatchObject({ code: 'evolves_space_mismatch' });
    expect(count()).toBe(2);
  });

  it('显式关系优先于精确去重：同文 replaces 仍写边、旧行退出 latest、version+1（Minor 2）', async () => {
    const old = await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    if (old.status !== 'inserted') throw new Error();
    const r = await createMemory(
      db,
      {
        content: `  ${LONG_PG}  `,
        spaceId: 'global',
        evolvesFromId: old.memory.id,
        evolvesRelation: 'replaces',
      },
      { embedder: e }
    );
    if (r.status !== 'inserted') throw new Error();
    expect(r.deduplicated).toBeUndefined();
    expect(r.memory.id).not.toBe(old.memory.id);
    expect(r.memory.version).toBe(2);
    expect(r.evolves?.relation).toBe('replaces');
    expect(getMemory(db, old.memory.id)?.isLatest).toBe(false);
    expect(count()).toBe(2);
    // force 同样优先于 hash 去重
    const f = await createMemory(
      db,
      { content: LONG_PG, spaceId: 'global', force: true },
      { embedder: e }
    );
    if (f.status !== 'inserted') throw new Error();
    expect(f.deduplicated).toBeUndefined();
    expect(count()).toBe(3);
  });

  it('evolvesFromId 指向已删除的行拒绝（Minor 3）', async () => {
    const a = await createMemory(db, { content: LONG_PG, spaceId: 'global' });
    if (a.status !== 'inserted') throw new Error();
    updateMemory(db, a.memory.id, { lifecycleState: 'deleted' });
    await expect(
      createMemory(db, {
        content: LONG_MY,
        spaceId: 'global',
        evolvesFromId: a.memory.id,
        evolvesRelation: 'confirms',
      })
    ).rejects.toMatchObject({ code: 'evolves_target_not_found' });
    expect(count()).toBe(1);
  });

  it('force=true 跳过候选网直接插入', async () => {
    await createMemory(db, { content: LONG_PG, spaceId: 'global' }, { embedder: e });
    const r = await createMemory(
      db,
      { content: LONG_MY, spaceId: 'global', force: true },
      { embedder: e }
    );
    expect(r.status).toBe('inserted');
    expect(count()).toBe(2);
  });
});
