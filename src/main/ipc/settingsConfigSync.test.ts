import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(path.join(tmpdir(), 'enso-settings-config-sync-'));
const send = vi.fn();
const webContents = { isDestroyed: () => false, send };

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents }],
  },
  ipcMain: { handle: vi.fn() },
}));

let settings: typeof import('./settings');

beforeAll(async () => {
  const file = path.join(userData, 'settings.json');
  writeFileSync(
    file,
    JSON.stringify({
      'enso-settings': { version: 7, state: { theme: 'dark', providers: [] } },
      'enso-conversations': { state: { conversations: { keep: true } } },
    })
  );
  chmodSync(file, 0o644);
  settings = await import('./settings');
});

afterAll(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('config sync settings transaction', () => {
  it('durable commit 保留无关 store，备份为仅用户可读并在成功后广播', () => {
    const current = settings.readSettings();
    const result = settings.commitSettingsTransaction(settings.settingsFingerprint(current), {
      providers: [{ id: 'imported' }],
    });

    expect(result.ok).toBe(true);
    expect(statSync(result.backupPath as string).mode & 0o777).toBe(0o600);
    const persisted = JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    expect(persisted['enso-settings'].state).toMatchObject({
      theme: 'dark',
      providers: [{ id: 'imported' }],
    });
    expect(persisted['enso-conversations'].state.conversations.keep).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('预览后设置发生变化时拒绝提交且不生成第二次广播', () => {
    const fingerprint = settings.settingsFingerprint(settings.readSettings());
    settings.patchSettingsState('theme', 'light');
    send.mockClear();
    const result = settings.commitSettingsTransaction(fingerprint, { providers: [] });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('changed');
    expect(send).not.toHaveBeenCalled();
  });
});
