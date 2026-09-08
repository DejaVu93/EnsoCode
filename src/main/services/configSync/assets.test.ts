import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stageResources } from './assets';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'enso-config-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('config sync resource staging', () => {
  it('拒绝非规范 base64，并回滚已创建的批次目录', () => {
    expect(() =>
      stageResources(
        root,
        [{ id: 'skill', files: [{ path: 'SKILL.md', content: 'not base64!' }] }],
        []
      )
    ).toThrow('Invalid resource content');

    const imports = join(root, 'config-imports');
    expect(existsSync(imports) ? readdirSync(imports) : []).toEqual([]);
  });

  it('接近上限的大文件 base64 校验不会栈溢出', () => {
    const content = Buffer.alloc(4 * 1024 * 1024, 7).toString('base64');
    const staged = stageResources(
      root,
      [{ id: 'skill', files: [{ path: 'SKILL.md', content }] }],
      []
    );
    expect(staged.skillPaths.get('skill')).toBeTruthy();
  });
});
