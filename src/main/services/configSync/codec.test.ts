import { describe, expect, it } from 'vitest';
import {
  decodeBundle,
  encodeBundle,
  isEncryptedBundle,
  redactBundle,
  validateBundle,
} from './codec';

const bundle = () => ({
  format: 'enso-config' as const,
  version: 1 as const,
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
  secretsIncluded: false,
});
const skill = {
  id: 'skill-1',
  name: 'Test',
  description: '',
  path: '',
  source: 'import',
  enabled: true,
};

describe('config sync codec', () => {
  it('拒绝技能资源中的路径穿越', () => {
    expect(() =>
      validateBundle({
        ...bundle(),
        state: { ...bundle().state, skills: [skill] },
        resources: {
          skills: [
            {
              id: skill.id,
              files: [
                { path: 'SKILL.md', content: '' },
                { path: '../escape', content: '' },
              ],
            },
          ],
          instructions: [],
        },
      })
    ).toThrow();
  });

  it('拒绝大小写不敏感的重复资源路径', () => {
    expect(() =>
      validateBundle({
        ...bundle(),
        state: { ...bundle().state, skills: [skill] },
        resources: {
          skills: [
            {
              id: skill.id,
              files: [
                { path: 'SKILL.md', content: '' },
                { path: 'skill.md', content: '' },
              ],
            },
          ],
          instructions: [],
        },
      })
    ).toThrow();
  });

  it('脱敏导出移除凭证且不修改输入 bundle', () => {
    const source = {
      ...bundle(),
      state: {
        ...bundle().state,
        providers: [
          {
            id: 'p1',
            name: 'P',
            api: 'openai-completions' as const,
            apiKey: 'secret',
            baseUrl: 'https://example.test',
            enabled: true,
            models: [],
          },
        ],
        mcpServers: [
          {
            id: 'm1',
            name: 'M',
            transport: 'http' as const,
            env: { TOKEN: 'secret' },
            args: ['--token=secret'],
            url: 'https://user:pass@example.test/a?token=secret#frag',
            source: 'local',
            enabled: true,
          },
        ],
      },
    };
    const redacted = redactBundle(source);
    expect(JSON.stringify(redacted)).not.toContain('secret');
    expect(source.state.providers[0]).toHaveProperty('apiKey', 'secret');
    expect(source.state.mcpServers[0]).toHaveProperty('env.TOKEN', 'secret');
  });

  it('包含敏感信息时加密整个包并支持正确密码解密', async () => {
    const encrypted = await encodeBundle({ ...bundle(), secretsIncluded: true }, 'correct horse');
    expect(isEncryptedBundle(encrypted)).toBe(true);
    expect(encrypted.toString('utf8')).not.toContain(bundle().createdAt);
    await expect(decodeBundle(encrypted, 'correct horse')).resolves.toMatchObject({
      secretsIncluded: true,
    });
  });

  it('错误密码不能解密敏感配置包', async () => {
    const encrypted = await encodeBundle({ ...bundle(), secretsIncluded: true }, 'correct horse');
    await expect(decodeBundle(encrypted, 'wrong password')).rejects.toThrow();
  });
});
