import fs from 'node:fs';
import path from 'node:path';
import { WM_MAX, WM_TARGET } from '@shared/memory/constants';
import { computeDecayScore } from '@shared/memory/decay';
import type Database from 'better-sqlite3';
import { MEMORY_COLUMNS, type MemoryRow, rowToMemory } from './store';
import type { Memory } from './types';

/**
 * Working Memory 文件。目标 WM_TARGET、硬顶 WM_MAX，均按 UTF-8 字节计。
 */

export interface WorkingMemoryOptions {
  spaceIds: string[];
  now?: Date;
  /** 硬顶，缺省 WM_MAX */
  maxBytes?: number;
}

const SUMMARY_CHARS = 160;
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

function selectRows(db: Database.Database, spaceIds: string[]): Memory[] {
  if (spaceIds.length === 0) return [];
  const marks = spaceIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ${MEMORY_COLUMNS} FROM memories
       WHERE is_latest = 1 AND lifecycle_state = 'active' AND space_id IN (${marks})`
    )
    .all(...spaceIds) as MemoryRow[];
  return rows.map(rowToMemory);
}

function rank(memories: Memory[], now: Date): Memory[] {
  const decay = new Map(
    memories.map((m) => [
      m.id,
      computeDecayScore({
        lastAccessedAt: m.lastAccessedAt,
        accessCount: m.accessCount,
        importance: m.importance,
        now,
      }),
    ])
  );
  return [...memories].sort(
    (a, b) =>
      Number(b.isCrystal) - Number(a.isCrystal) ||
      (decay.get(b.id) ?? 0) - (decay.get(a.id) ?? 0) ||
      b.importance - a.importance ||
      (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function summarize(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > SUMMARY_CHARS ? `${chars.slice(0, SUMMARY_CHARS).join('')}…` : flat;
}

function renderLine(m: Memory): string {
  const star = m.isCrystal ? ' ★' : '';
  return `- [${m.unitType}]${star} ${m.title} — ${summarize(m.content)} (ensocode://memory/${m.id})`;
}

export function buildWorkingMemory(db: Database.Database, opts: WorkingMemoryOptions): string {
  const now = opts.now ?? new Date();
  const max = opts.maxBytes ?? WM_MAX;
  const target = Math.min(WM_TARGET, max);
  const lines = ['# Working Memory', now.toISOString()];
  let used = bytes(lines.join('\n'));
  for (const m of rank(selectRows(db, opts.spaceIds), now)) {
    if (used > target) break;
    const line = renderLine(m);
    const next = used + bytes(`\n${line}`);
    if (next > max) break;
    lines.push(line);
    used = next;
  }
  // 硬顶只按整行回退：字节级硬切会截出半个 UTF-8 字符
  while (lines.length > 0 && bytes(lines.join('\n')) > max) lines.pop();
  return lines.join('\n');
}

// 同步写：文件 ≤ WM_MAX 字节，且退出前的 flush 发生在同步的 closeMemoryDb 里，异步写会被关库截断
export function writeWorkingMemoryFile(
  db: Database.Database,
  filePath: string,
  opts: WorkingMemoryOptions
): string {
  const content = buildWorkingMemory(db, opts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
  return content;
}
