import { describe, expect, it } from 'vitest';
import { decodeBundle, redactBundle, validateBundle } from './codec';
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
  secretsIncluded: false,
});

const skill = (id: string, name = id) => ({
  id,
  name,
  description: '',
  path: '' as const,
  source: 'import',
  enabled: true,
});

describe('config sync codec security limits', () => {
  it('拒绝把 secretsIncluded=true 的载荷作为明文解码', async () => {
    const raw = Buffer.from(JSON.stringify({ ...bundle(), secretsIncluded: true }));
    await expect(decodeBundle(raw)).rejects.toThrow();
  });

  it('脱敏 provider endpoint 的认证信息、查询和片段', () => {
    const input = bundle();
    input.state.providers = [
      {
        id: 'p',
        name: 'P',
        api: 'openai-completions',
        apiKey: 'key',
        baseUrl: 'https://user:pass@example.test/v1?token=value#fragment',
        enabled: true,
        models: [],
      },
    ];
    const redacted = redactBundle(input);
    expect(redacted.state.providers[0]?.baseUrl).toBe('https://example.test/v1');
    expect(redacted.state.providers[0]?.omittedFields).toEqual(
      expect.arrayContaining(['baseUrlCredentials', 'baseUrlQuery', 'baseUrlFragment'])
    );
  });

  it('无效 endpoint 不会在脱敏结果中保留疑似凭证', () => {
    const input = bundle();
    input.state.mcpServers = [
      {
        id: 'm',
        name: 'M',
        transport: 'http',
        url: 'not-a-url:user-secret?token=value',
        source: 'import',
        enabled: true,
      },
    ];
    expect(JSON.stringify(redactBundle(input))).not.toContain('user-secret');
  });

  it('拒绝盘符、空路径段和控制字符资源路径', () => {
    for (const path of ['C:/escape', 'dir//file', 'dir/\u0001file']) {
      const input = bundle();
      input.state.skills = [skill('s')];
      input.resources.skills = [
        {
          id: 's',
          files: [
            { path: 'SKILL.md', content: '' },
            { path, content: '' },
          ],
        },
      ];
      expect(() => validateBundle(input)).toThrow();
    }
  });

  it('拒绝超过 4 MiB 的单个资源文件', () => {
    const input = bundle();
    input.state.skills = [skill('s')];
    input.resources.skills = [
      {
        id: 's',
        files: [
          {
            path: 'SKILL.md',
            content: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64'),
          },
        ],
      },
    ];
    expect(() => validateBundle(input)).toThrow();
  });

  it('拒绝解码后资源总量超过 32 MiB', () => {
    const input = bundle();
    input.state.skills = [skill('s')];
    const block = Buffer.alloc(4 * 1024 * 1024).toString('base64');
    input.resources.skills = [
      {
        id: 's',
        files: [
          { path: 'SKILL.md', content: block },
          ...Array.from({ length: 7 }, (_, index) => ({
            path: `block-${index}`,
            content: block,
          })),
          { path: 'overflow', content: Buffer.from('x').toString('base64') },
        ],
      },
    ];
    expect(() => validateBundle(input)).toThrow();
  });

  it('拒绝超过 4096 个资源文件', () => {
    const input = bundle();
    input.state.skills = [skill('s')];
    input.resources.skills = [
      {
        id: 's',
        files: Array.from({ length: 4097 }, (_, index) => ({
          path: index === 0 ? 'SKILL.md' : `file-${index}`,
          content: '',
        })),
      },
    ];
    expect(() => validateBundle(input)).toThrow();
  });

  it('拒绝同类实体中的重复规范化名称', () => {
    const input = bundle();
    input.state.skills = [skill('one', 'Same'), skill('two', ' ＳＡＭＥ ')];
    input.resources.skills = [
      { id: 'one', files: [{ path: 'SKILL.md', content: '' }] },
      { id: 'two', files: [{ path: 'SKILL.md', content: '' }] },
    ];
    expect(() => validateBundle(input)).toThrow();
  });

  it('拒绝与 transport 不匹配的 MCP 配置和未知内置禁用项', () => {
    const input = bundle();
    input.state.mcpServers = [
      {
        id: 'm',
        name: 'M',
        transport: 'stdio',
        url: 'https://example.test',
        source: 'import',
        enabled: true,
      },
    ];
    expect(() => validateBundle(input)).toThrow();

    input.state.mcpServers = [];
    input.state.disabledBuiltinAgentTypes = ['not-builtin'];
    expect(() => validateBundle(input)).toThrow();
  });
});
