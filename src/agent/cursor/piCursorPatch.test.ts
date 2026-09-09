import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

describe('pi-cursor pnpm patch', () => {
  it('keeps Enso exec/interaction hooks on the installed 1.4.33 bundle', () => {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@rahularya01/pi-cursor/package.json');
    const { version } = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version: string };
    expect(version).toBe('1.4.33');
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).toContain('__ensoCursorHandleInteraction');
    expect(bundle).toContain('__ensoCursorHandleExec');
  });

  // 上游 1.4.32 已不再发 model_details（#23）。回归守卫：补丁只挂 hook，不能把字段加回去。
  it('keeps the upstream Run request without modelDetails', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).not.toContain('modelDetails');
    expect(bundle).toContain('requestedModel:L');
  });
});
