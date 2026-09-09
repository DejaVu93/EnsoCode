import { describe, expect, it } from 'vitest';
import {
  CONFIG_SYNC_DECRYPT_ERROR_CODE,
  type ConfigSyncCodecError,
  decodeBundle,
  encodeBundle,
} from './codec';
import type { ConfigSyncBundle } from './types';

const bundle = (): ConfigSyncBundle => ({
  format: 'enso-config',
  version: 1,
  createdAt: '2025-09-05T00:00:00.000Z',
  state: {
    providers: [],
    skills: [],
    mcpServers: [],
    instructions: [],
    presets: [],
    agentTypes: [],
    subagentModels: [],
  },
  resources: { skills: [], instructions: [] },
  secretsIncluded: true,
});

describe('config sync codec errors', () => {
  it('错误密码返回稳定且不含秘密的解密错误', async () => {
    const encrypted = await encodeBundle(bundle(), 'correct horse');
    await expect(decodeBundle(encrypted, 'wrong password')).rejects.toMatchObject({
      name: 'ConfigSyncCodecError',
      code: CONFIG_SYNC_DECRYPT_ERROR_CODE,
      message: 'Unable to decrypt config sync bundle',
    } satisfies Partial<ConfigSyncCodecError>);
  });

  it('数 MB 的加密包可以解码（base64 校验不会栈溢出）', async () => {
    const content = Buffer.alloc(3 * 1024 * 1024, 7).toString('base64');
    const skill = { id: 'skill-1', name: 'Test', description: '', path: '', source: 'import' };
    const source: ConfigSyncBundle = {
      ...bundle(),
      state: { ...bundle().state, skills: [{ ...skill, enabled: true }] },
      resources: {
        skills: [{ id: skill.id, files: [{ path: 'SKILL.md', content }] }],
        instructions: [],
      },
    };
    const encrypted = await encodeBundle(source, 'correct horse');
    const decoded = await decodeBundle(encrypted, 'correct horse');
    expect(decoded.resources.skills[0]?.files[0]?.content).toBe(content);
  });
});
