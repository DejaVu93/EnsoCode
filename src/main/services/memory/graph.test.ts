import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb } from './db';
import {
  buildMemoryGraph,
  buildMemoryTree,
  entityMemoryIds,
  memoriesForEntity,
  memoriesForPrompt,
} from './graph';
import { applyExtraction } from './kg';
import { createMemory, updateMemory } from './store';
import { projectSpaceId } from './types';

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-memory-graph-'));
  db = openMemoryDb(path.join(dir, 'memory.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function add(content: string, spaceId = 'global', extra: Record<string, unknown> = {}) {
  const r = await createMemory(db, { content, spaceId, force: true, ...extra });
  if (r.status !== 'inserted') throw new Error('not inserted');
  return r.memory;
}

function link(
  memory: { id: string; spaceId: string },
  names: string[],
  relations: { source: string; target: string }[] = []
) {
  applyExtraction(db, memory, {
    entities: names.map((name) => ({
      name,
      type: 'PRODUCT',
      description: null,
      confidence: 0.9,
      aliases: [],
    })),
    relations: relations.map((r) => ({ ...r, relation: 'USES', strength: 0.8 })),
  });
}

describe('buildMemoryGraph', () => {
  it('sizes nodes by how many active memories mention them and keeps edges within the node set', async () => {
    const a = await add('我们用 Redis 做缓存');
    const b = await add('Redis 的过期策略要注意');
    const c = await add('Kafka 用来解耦');
    link(a, ['Redis', 'Cache'], [{ source: 'Redis', target: 'Cache' }]);
    link(b, ['Redis']);
    link(c, ['Kafka']);

    const graph = buildMemoryGraph(db, { limit: 50 });
    const redis = graph.nodes.find((n) => n.name === 'Redis');
    const kafka = graph.nodes.find((n) => n.name === 'Kafka');
    expect(redis?.memoryCount).toBe(2);
    expect(kafka?.memoryCount).toBe(1);
    // 节点按提及数倒序
    expect(graph.nodes[0].name).toBe('Redis');
    expect(graph.totalEntities).toBe(3);
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
    }
  });

  it('excludes archived and superseded memories from the counts', async () => {
    const live = await add('Redis 现役说明');
    const archived = await add('Redis 旧说明');
    const stale = await add('Redis 更旧的说明');
    link(live, ['Redis']);
    link(archived, ['Redis']);
    link(stale, ['Redis']);
    updateMemory(db, archived.id, { lifecycleState: 'archived' });
    updateMemory(db, stale.id, { isLatest: false });
    const graph = buildMemoryGraph(db, { limit: 50 });
    expect(graph.nodes.find((n) => n.name === 'Redis')?.memoryCount).toBe(1);
  });

  it('minMemories drops one-off extraction noise', async () => {
    const a = await add('Redis 说明一');
    const b = await add('Redis 说明二');
    const c = await add('只出现一次的东西');
    link(a, ['Redis']);
    link(b, ['Redis']);
    link(c, ['Ephemeral']);
    const graph = buildMemoryGraph(db, { limit: 50, minMemories: 2 });
    expect(graph.nodes.map((n) => n.name)).toEqual(['Redis']);
  });

  it('focus mode returns the entity plus its direct neighbours only', async () => {
    const a = await add('Redis 与 Cache 的关系');
    const far = await add('毫不相关的话题');
    link(a, ['Redis', 'Cache'], [{ source: 'Redis', target: 'Cache' }]);
    link(far, ['Unrelated']);
    const all = buildMemoryGraph(db, { limit: 50 });
    const redisId = all.nodes.find((n) => n.name === 'Redis')?.id;
    const focused = buildMemoryGraph(db, { limit: 50, focusEntityId: redisId });
    expect(focused.nodes.map((n) => n.name).sort()).toEqual(['Cache', 'Redis']);
  });

  it('isolates spaces', async () => {
    const proj = projectSpaceId('p1');
    const mine = await add('项目内的 Redis', proj);
    const other = await add('全局的 Kafka', 'global');
    link(mine, ['Redis']);
    link(other, ['Kafka']);
    const scoped = buildMemoryGraph(db, { limit: 50, spaceId: proj });
    expect(scoped.nodes.map((n) => n.name)).toEqual(['Redis']);
  });
});

describe('buildMemoryTree', () => {
  it('groups by unit type with crystals first inside a group', async () => {
    await add('决策一', 'global', { unitType: 'decision' });
    await add('决策二', 'global', { unitType: 'decision' });
    await add('一条事实', 'global', { unitType: 'fact' });
    const tree = buildMemoryTree(db, { groupBy: 'unitType', limitPerGroup: 10 });
    const decision = tree.find((g) => g.label === 'decision');
    expect(decision?.count).toBe(2);
    expect(decision?.children).toHaveLength(2);
    expect(tree.map((g) => g.label)).toContain('fact');
  });

  it('groups by entity, so one memory can appear under several entities', async () => {
    const m = await add('Redis 和 Kafka 一起用');
    link(m, ['Redis', 'Kafka']);
    const tree = buildMemoryTree(db, { groupBy: 'entity', limitPerGroup: 10 });
    expect(tree.map((g) => g.label).sort()).toEqual(['Kafka', 'Redis']);
    expect(tree[0].children?.[0].memoryId).toBe(m.id);
  });

  it('groups by month, newest first', async () => {
    await createMemory(
      db,
      { content: '旧的', spaceId: 'global', force: true },
      { now: new Date('2024-03-05T00:00:00Z') }
    );
    await createMemory(
      db,
      { content: '新的', spaceId: 'global', force: true },
      { now: new Date('2025-08-09T00:00:00Z') }
    );
    const tree = buildMemoryTree(db, { groupBy: 'time', limitPerGroup: 10 });
    expect(tree.map((g) => g.label)).toEqual(['2025-08', '2024-03']);
  });

  it('caps children per group but still reports the real count', async () => {
    for (let i = 0; i < 5; i++) await add(`事实 ${i}`, 'global', { unitType: 'fact' });
    const tree = buildMemoryTree(db, { groupBy: 'unitType', limitPerGroup: 2 });
    const fact = tree.find((g) => g.label === 'fact');
    expect(fact?.count).toBe(5);
    expect(fact?.children).toHaveLength(2);
  });
});

describe('memoriesForPrompt', () => {
  it('stops before exceeding the char budget and reports how many made it', async () => {
    const a = await add('x'.repeat(400));
    const b = await add('y'.repeat(400));
    const packed = memoriesForPrompt(db, [a.id, b.id], 500);
    expect(packed.count).toBe(1);
    expect(packed.text.length).toBeLessThanOrEqual(500);
    expect(memoriesForPrompt(db, [], 500)).toEqual({ text: '', count: 0 });
  });
});

describe('memoriesForEntity / entityMemoryIds', () => {
  it('returns active memories for the entity, crystals first', async () => {
    const plain = await add('普通记忆提到 Redis');
    const crystal = await add('结晶提到 Redis');
    link(plain, ['Redis']);
    link(crystal, ['Redis']);
    db.prepare('UPDATE memories SET is_crystal = 1 WHERE id = ?').run(crystal.id);
    const entityId = buildMemoryGraph(db, { limit: 10 }).nodes.find((n) => n.name === 'Redis')?.id;
    if (!entityId) throw new Error('entity missing');
    expect(memoriesForEntity(db, entityId)[0].id).toBe(crystal.id);
    expect(entityMemoryIds(db, entityId)).toHaveLength(2);
  });
});
