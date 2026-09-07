import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

describe('pi-cursor pnpm patch', () => {
  it('keeps Enso exec/interaction hooks on the installed 1.4.31 bundle', () => {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@rahularya01/pi-cursor/package.json');
    const { version } = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version: string };
    expect(version).toBe('1.4.31');
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).toContain('__ensoCursorHandleInteraction');
    expect(bundle).toContain('__ensoCursorHandleExec');
  });

  // 上游 1.4.31 同时发 model_details 与 requested_model，Cursor 以 not_found 拒掉整轮
  // （上游 PR #24）。补丁只保留 requested_model。
  it('drops the legacy modelDetails field from the Run request', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).not.toContain('modelDetails');
    expect(bundle).toContain('requestedModel:L');
  });
});
