import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WM_MAX, WM_TARGET } from '@shared/memory/constants';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCrystal } from './crystal';
import { openMemoryDb } from './db';
import { createMemory } from './store';
import { buildWorkingMemory, writeWorkingMemoryFile } from './workingMemory';

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-memory-wm-'));
  db = openMemoryDb(path.join(dir, 'memory.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function add(content: string, spaceId = 'global', importance = 0.5) {
  const r = await createMemory(db, { content, spaceId, importance });
  if (r.status !== 'inserted') throw new Error();
  return r.memory;
}

const now = new Date('2026-09-09T00:00:00.000Z');
const lines = (text: string) => text.split('\n').filter((l) => l.startsWith('- '));

describe('buildWorkingMemory', () => {
  it('空库返回合法头部，不抛', () => {
    const out = buildWorkingMemory(db, { spaceIds: ['global'], now });
    expect(out.startsWith('# Working Memory\n')).toBe(true);
    expect(out).toContain(now.toISOString());
    expect(lines(out)).toEqual([]);
  });

  it('crystal 排在普通记忆之前并带 ★；每行带 deeplink', async () => {
    const plain = await add('普通记忆：团队用 pnpm 管理 monorepo', 'global', 0.9);
    const sources = [
      await add('检索先跑 FTS 通道'),
      await add('检索再跑向量通道'),
      await add('检索最后按 RRF 融合'),
    ];
    const crystal = await createCrystal(db, {
      content: '检索是三通道并集后 RRF 融合',
      title: '检索融合方式',
      sourceIds: sources.map((s) => s.id),
      spaceId: 'global',
      importance: 0.3,
    });
    if (crystal.status !== 'inserted') throw new Error();
    const out = buildWorkingMemory(db, { spaceIds: ['global'], now });
    const rows = lines(out);
    expect(rows[0]).toContain(`ensocode://memory/${crystal.memory.id}`);
    expect(rows[0]).toMatch(/^- \[\w+\] ★ /);
    for (const m of [plain, ...sources]) {
      expect(out).toContain(`(ensocode://memory/${m.id})`);
    }
    expect(rows.slice(1).some((l) => l.includes('★'))).toBe(false);
  });

  it('摘要压平换行并按 160 字符截断', async () => {
    const m = await add(`第一行\n第二行 ${'很长'.repeat(200)}`);
    const out = buildWorkingMemory(db, { spaceIds: ['global'], now });
    const line = lines(out).find((l) => l.includes(m.id)) ?? '';
    expect(line).not.toContain('\n');
    expect(line).toContain('第一行 第二行');
    expect(line).toContain('…');
    const summary = line.slice(line.indexOf(' — ') + 3, line.lastIndexOf(' ('));
    expect(Array.from(summary).length).toBe(161);
  });

  it('space 隔离：只出现请求 space 的记忆', async () => {
    const g = await add('全局记忆');
    const p = await add('项目记忆', 'proj:p1');
    const onlyProject = buildWorkingMemory(db, { spaceIds: ['proj:p1'], now });
    expect(onlyProject).toContain(p.id);
    expect(onlyProject).not.toContain(g.id);
    const both = buildWorkingMemory(db, { spaceIds: ['global', 'proj:p1'], now });
    expect(both).toContain(g.id);
    expect(both).toContain(p.id);
  });

  it('大量长记忆：字节数 ≤ WM_MAX、超过 WM_TARGET 即停、只按整行丢弃、无半个字符', async () => {
    for (let i = 0; i < 60; i++) {
      await add(`记忆${i} ${'多字节内容🧠'.repeat(40)} ${i}`);
    }
    const out = buildWorkingMemory(db, { spaceIds: ['global'], now });
    const bytes = Buffer.byteLength(out, 'utf8');
    expect(bytes).toBeLessThanOrEqual(WM_MAX);
    expect(bytes).toBeGreaterThan(WM_TARGET / 2);
    expect(out).not.toContain('\uFFFD');
    expect(lines(out).length).toBeLessThan(60);
    for (const l of lines(out)) expect(l).toMatch(/\(ensocode:\/\/memory\/[0-9a-f-]{36}\)$/);
    // 每行都完整：重新按 utf8 编解码不变
    expect(Buffer.from(out, 'utf8').toString('utf8')).toBe(out);
  });

  it('maxBytes 覆盖硬顶；头部超硬顶时安全截断为空串而不抛', async () => {
    await add(`单条 ${'x'.repeat(500)}`);
    const small = buildWorkingMemory(db, { spaceIds: ['global'], now, maxBytes: 300 });
    expect(Buffer.byteLength(small, 'utf8')).toBeLessThanOrEqual(300);
    expect(small.startsWith('# Working Memory')).toBe(true);
    expect(lines(small)).toEqual([]);
    const tiny = buildWorkingMemory(db, { spaceIds: ['global'], now, maxBytes: 5 });
    expect(Buffer.byteLength(tiny, 'utf8')).toBeLessThanOrEqual(5);
  });
});

describe('writeWorkingMemoryFile', () => {
  it('同步原子写入临时目录，可读回且与 buildWorkingMemory 一致', async () => {
    await add('写文件测试记忆');
    const file = path.join(dir, 'nested', 'wm', 'working-memory.md');
    const written = writeWorkingMemoryFile(db, file, { spaceIds: ['global'], now });
    expect(readFileSync(file, 'utf8')).toBe(written);
    expect(written).toBe(buildWorkingMemory(db, { spaceIds: ['global'], now }));
    expect(() => readFileSync(`${file}.tmp`)).toThrow();
  });
});
