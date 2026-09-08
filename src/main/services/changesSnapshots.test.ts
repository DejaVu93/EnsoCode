import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneSnapshots, readSnapshots, writeSnapshots } from './changesSnapshots';

const ID = '4aade2cb-d2a1-47c3-a4a2-848f28571a97';
const OTHER_ID = '11111111-2222-3333-4444-555555555555';
let tmp: string;

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-changes-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('changesSnapshots', () => {
  it('文件不存在时返回空快照', () => {
    expect(readSnapshots(path.join(tmp, 'missing'), ID)).toEqual({});
  });

  it('拒绝非 uuid，且不会在目标目录或其父目录创建文件', () => {
    const dir = path.join(tmp, 'snapshots');
    for (const id of ['../escape', 'foo']) {
      expect(readSnapshots(dir, id)).toEqual({});
      expect(writeSnapshots(dir, id, { 'src/a.ts': 'old' })).toBe(false);
    }
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('文件内容不是合法 JSON 时返回空快照', () => {
    fs.writeFileSync(path.join(tmp, `${ID}.json`), '{bad json');
    expect(readSnapshots(tmp, ID)).toEqual({});
  });

  it('JSON 顶层不是对象时返回空快照', () => {
    for (const value of [[], 'text', null]) {
      fs.writeFileSync(path.join(tmp, `${ID}.json`), JSON.stringify(value));
      expect(readSnapshots(tmp, ID)).toEqual({});
    }
  });

  it('读取时丢弃非字符串值并保留字符串值', () => {
    fs.writeFileSync(path.join(tmp, `${ID}.json`), JSON.stringify({ a: 'old', b: 1, c: null }));
    expect(readSnapshots(tmp, ID)).toEqual({ a: 'old' });
  });

  it('写入会创建目录并可完整读回', () => {
    const dir = path.join(tmp, 'nested', 'snapshots');
    const snapshots = { 'src/a.ts': 'before', '空 文件.txt': '' };
    expect(writeSnapshots(dir, ID, snapshots)).toBe(true);
    expect(readSnapshots(dir, ID)).toEqual(snapshots);
  });

  it('写入空快照会删除已有文件', () => {
    writeSnapshots(tmp, ID, { a: 'old' });
    expect(writeSnapshots(tmp, ID, {})).toBe(true);
    expect(fs.existsSync(path.join(tmp, `${ID}.json`))).toBe(false);
  });

  it('清理仅删除不再存活的 uuid 快照，并兼容目录不存在', () => {
    for (const name of [`${ID}.json`, `${OTHER_ID}.json`, 'foo.json', 'notes.txt'])
      fs.writeFileSync(path.join(tmp, name), '{}');
    pruneSnapshots(tmp, new Set([ID]));
    expect(fs.readdirSync(tmp).sort()).toEqual([`${ID}.json`, 'foo.json', 'notes.txt'].sort());
    expect(() => pruneSnapshots(path.join(tmp, 'missing'), new Set())).not.toThrow();
  });
});
