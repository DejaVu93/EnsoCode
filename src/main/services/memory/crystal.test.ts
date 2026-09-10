import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CRYSTAL_BOOST } from '@shared/memory/constants';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCrystal, listCrystalSources, listCrystalsForSource } from './crystal';
import { openMemoryDb } from './db';
import { searchMemories } from './search';
import { type CreateMemoryOptions, createMemory, getMemory, updateMemory } from './store';
import { type Embedder, projectSpaceId } from './types';

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-memory-crystal-'));
  db = openMemoryDb(path.join(dir, 'memory.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function add(content: string, spaceId = 'global') {
  const r = await createMemory(db, { content, spaceId });
  if (r.status !== 'inserted') throw new Error();
  return r.memory;
}

async function seedSources(spaceId = 'global') {
  return [
    await add('检索先跑 FTS 通道', spaceId),
    await add('检索再跑向量通道', spaceId),
    await add('检索最后按 RRF 融合', spaceId),
  ];
}

describe('createCrystal', () => {
  it('≥3 个源才能结晶，标位与 CRYSTALLIZED_FROM 边都写入', async () => {
    const sources = await seedSources();
    const r = await createCrystal(db, {
      content: '检索是 FTS、向量、实体三通道并集后按 RRF 融合的结果',
      title: '检索融合方式',
      sourceIds: sources.map((s) => s.id),
      spaceId: 'global',
    });
    if (r.status !== 'inserted') throw new Error();
    expect(r.memory.isCrystal).toBe(true);
    expect(r.memory.crystalTitle).toBe('检索融合方式');
    expect(r.memory.sourceUnitCount).toBe(3);
    expect(getMemory(db, r.memory.id)?.isCrystal).toBe(true);

    const linked = listCrystalSources(db, r.memory.id);
    expect(linked.map((l) => l.memory.id).sort()).toEqual(sources.map((s) => s.id).sort());
    expect(linked.every((l) => Math.abs(l.contributionWeight - 1 / 3) < 1e-9)).toBe(true);
    expect(listCrystalsForSource(db, sources[0].id).map((m) => m.id)).toEqual([r.memory.id]);
  });

  it('源不足 3 个 / 重复源凑数 → 校验错误，不写任何行', async () => {
    const sources = await seedSources();
    const before = db.prepare('SELECT COUNT(*) AS n FROM memories').get();
    for (const sourceIds of [
      [sources[0].id, sources[1].id],
      [sources[0].id, sources[0].id, sources[0].id],
    ]) {
      await expect(
        createCrystal(db, { content: 'x'.repeat(20), title: 't', sourceIds, spaceId: 'global' })
      ).rejects.toMatchObject({ code: 'crystal_sources' });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM memories').get()).toEqual(before);
  });

  it('源必须存在、活动且同 space', async () => {
    const sources = await seedSources();
    const foreign = await add('别的 space', projectSpaceId('p1'));
    await expect(
      createCrystal(db, {
        content: 'x'.repeat(20),
        title: 't',
        sourceIds: [sources[0].id, sources[1].id, 'missing'],
        spaceId: 'global',
      })
    ).rejects.toMatchObject({ code: 'crystal_sources' });
    await expect(
      createCrystal(db, {
        content: 'x'.repeat(20),
        title: 't',
        sourceIds: [sources[0].id, sources[1].id, foreign.id],
        spaceId: 'global',
      })
    ).rejects.toMatchObject({ code: 'crystal_sources' });

    updateMemory(db, sources[2].id, { lifecycleState: 'archived' });
    await expect(
      createCrystal(db, {
        content: 'x'.repeat(20),
        title: 't',
        sourceIds: sources.map((s) => s.id),
        spaceId: 'global',
      })
    ).rejects.toMatchObject({ code: 'crystal_sources' });
  });

  it('标位与边和插入在同一事务：边写入失败时整条记忆回滚，不留半成品', async () => {
    const sources = await seedSources();
    const before = db.prepare('SELECT COUNT(*) AS n FROM memories').get();
    // 让 CRYSTALLIZED_FROM 插入必然失败（drop 表后重建由下一个 beforeEach 完成）
    db.exec('DROP TABLE crystallized_from');
    await expect(
      createCrystal(db, {
        content: '会被回滚的结晶',
        title: 't',
        sourceIds: sources.map((s) => s.id),
        spaceId: 'global',
      })
    ).rejects.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM memories').get()).toEqual(before);
  });

  it('正文与已有记忆完全相同（hash 去重）→ crystal_duplicate，不把旧的普通记忆改成 crystal', async () => {
    const sources = await seedSources();
    const existing = await add('已经存在的一段普通记忆正文');
    await expect(
      createCrystal(db, {
        content: '已经存在的一段普通记忆正文',
        title: 't',
        sourceIds: sources.map((s) => s.id),
        spaceId: 'global',
      })
    ).rejects.toMatchObject({ code: 'crystal_duplicate' });
    expect(getMemory(db, existing.id)?.isCrystal).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM crystallized_from').get()).toEqual({ n: 0 });
  });

  it('onCreated 收到的已是带 crystal 标位的行', async () => {
    const sources = await seedSources();
    const seen: boolean[] = [];
    const opts: CreateMemoryOptions = { onCreated: (m) => seen.push(m.isCrystal) };
    await createCrystal(
      db,
      {
        content: '钩子里看到的结晶',
        title: 't',
        sourceIds: sources.map((s) => s.id),
        spaceId: 'global',
      },
      opts
    );
    expect(seen).toEqual([true]);
  });

  it('候选网命中时只返回候选，不写入也不留边', async () => {
    const embedder: Embedder = {
      model: 'kw',
      dim: 1,
      embed: async () => Float32Array.from([1]),
    };
    const long =
      '检索由 FTS、向量与实体三个通道并集，再按 RRF(k=60) 融合，最后混入 decay 排序。'.repeat(3);
    const sources = await seedSources();
    const first = await createMemory(db, { content: long, spaceId: 'global' }, { embedder });
    if (first.status !== 'inserted') throw new Error();
    const r = await createCrystal(
      db,
      {
        content: `${long} 补充说明`,
        title: '检索融合方式',
        sourceIds: sources.map((s) => s.id),
        spaceId: 'global',
      },
      { embedder }
    );
    expect(r.status).toBe('candidates_found');
    expect(db.prepare('SELECT COUNT(*) AS n FROM crystallized_from').get()).toEqual({ n: 0 });
  });
});

describe('crystal 检索加权', () => {
  it('crystal 的最终分乘 CRYSTAL_BOOST，排在同页普通记忆之前', async () => {
    const sources = await seedSources();
    // 两字查词走 LIKE 通道，按 updated_at DESC 排名：结晶时间戳显式晚一秒，稳定排第一（归一后 semantic=1），
    // 不依赖同一毫秒内按 uuid 的随机次序
    const r = await createCrystal(
      db,
      {
        content: '检索通道的统一说明',
        title: '检索通道',
        sourceIds: sources.map((s) => s.id),
        spaceId: 'global',
        force: true,
      },
      { now: new Date(Date.now() + 1000) }
    );
    if (r.status !== 'inserted') throw new Error();
    const hits = await searchMemories(db, { q: '检索', spaceIds: ['global'], mmr: false });
    expect(hits[0].memory.id).toBe(r.memory.id);
    const plain = hits.find((h) => !h.memory.isCrystal)!;
    expect(hits[0].score / (0.85 * 1 + 0.15 * hits[0].decay)).toBeCloseTo(CRYSTAL_BOOST, 9);
    expect(hits[0].score).toBeGreaterThan(plain.score);
  });

  it('crystal 不进去重候选池，源记忆仍可正常检索到', async () => {
    const sources = await seedSources();
    await createCrystal(db, {
      content: '检索通道的统一说明',
      title: '检索通道',
      sourceIds: sources.map((s) => s.id),
      spaceId: 'global',
      force: true,
    });
    const ids = (await searchMemories(db, { q: '检索', spaceIds: ['global'], mmr: false })).map(
      (h) => h.memory.id
    );
    expect(ids).toEqual(expect.arrayContaining(sources.map((s) => s.id)));
  });
});
