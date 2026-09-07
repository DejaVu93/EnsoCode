import { describe, expect, it } from 'vitest';
import { planImport } from './merge';
import type { ConfigSyncBundle, ConfigSyncMcpServer, ConfigSyncProvider } from './types';

const provider = (
  id: string,
  name: string,
  overrides: Partial<ConfigSyncProvider> = {}
): ConfigSyncProvider => ({
  id,
  name,
  api: 'openai-completions',
  baseUrl: 'https://example.test',
  enabled: true,
  models: [{ id: 'model-1' }],
  ...overrides,
});

const bundle = (state: Partial<ConfigSyncBundle['state']> = {}): ConfigSyncBundle => ({
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
    ...state,
  },
  resources: { skills: [], instructions: [] },
  secretsIncluded: false,
});

const current = (state: Record<string, unknown> = {}): Record<string, unknown> => ({
  providers: [],
  skills: [],
  mcpServers: [],
  instructions: [],
  presets: [],
  agentTypes: [],
  subagentModels: [],
  ...state,
});

const mcp = (
  id: string,
  name: string,
  overrides: Partial<ConfigSyncMcpServer> = {}
): ConfigSyncMcpServer => ({
  id,
  name,
  transport: 'stdio',
  command: 'node server.js',
  source: 'import',
  enabled: true,
  ...overrides,
});

const skill = (id: string, name: string) => ({
  id,
  name,
  description: '',
  path: '',
  source: 'import',
  enabled: true,
});

describe('config sync import audit safety', () => {
  it('同 ID provider 的 endpoint 或 API 变化会拒绝导入，而不是先复用本机省略凭证', () => {
    expect(() =>
      planImport(
        current({
          providers: [provider('same', 'Shared', { apiKey: 'keep-local-secret' })],
        }),
        bundle({
          providers: [
            provider('same', 'Shared', {
              api: 'anthropic-messages',
              baseUrl: 'https://remote.example.test',
              omittedFields: ['apiKey'],
            }),
          ],
        }),
        'merge'
      )
    ).toThrow(/endpoint|api|conflict/i);
  });

  it('同名 MCP 的 command 变化会拒绝导入，而不是先携带本机 env 和 args', () => {
    expect(() =>
      planImport(
        current({
          mcpServers: [
            mcp('local', 'Shared MCP', {
              args: ['--local'],
              env: { TOKEN: 'keep-local-secret' },
            }),
          ],
        }),
        bundle({
          mcpServers: [
            mcp('remote', 'Shared MCP', {
              command: 'python remote.py',
              omittedFields: ['args', 'env'],
            }),
          ],
        }),
        'merge'
      )
    ).toThrow(/command|conflict|ambiguous/i);
  });

  it('同 ID MCP 的 transport 或 URL 变化会拒绝导入，而不是先携带本机 env 和 args', () => {
    expect(() =>
      planImport(
        current({
          mcpServers: [
            mcp('same', 'Local MCP', {
              args: ['--local'],
              env: { TOKEN: 'keep-local-secret' },
            }),
          ],
        }),
        bundle({
          mcpServers: [
            mcp('same', 'Remote MCP', {
              transport: 'http',
              command: undefined,
              url: 'https://remote.example.test/mcp',
              omittedFields: ['args', 'env'],
            }),
          ],
        }),
        'merge'
      )
    ).toThrow(/transport|url|conflict|ambiguous/i);
  });

  it('bundle 中的 __proto__ skill ID 会映射为实际字符串而不是修改映射对象原型', () => {
    const result = planImport(
      current({ skills: [skill('local-skill', 'Shared Skill')] }),
      bundle({
        skills: [skill('__proto__', 'Shared Skill')],
        presets: [{ id: 'preset', name: 'Preset', skillIds: ['__proto__'], mcpServerIds: [] }],
      }),
      'merge'
    );

    const protoId = '__proto__';
    expect(Object.hasOwn(result.skillIdMap, protoId)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result.skillIdMap, protoId)?.value).toBe('local-skill');
    expect(result.state.presets).toContainEqual(
      expect.objectContaining({ skillIds: ['local-skill'] })
    );
  });

  it('bundle 中的 constructor skill ID 会映射为实际字符串而不是读取继承属性', () => {
    const result = planImport(
      current({ skills: [skill('local-skill', 'Unrelated Skill')] }),
      bundle({
        skills: [skill('constructor', 'New Skill')],
        presets: [{ id: 'preset', name: 'Preset', skillIds: ['constructor'], mcpServerIds: [] }],
      }),
      'merge'
    );

    const constructorId = 'constructor';
    expect(Object.hasOwn(result.skillIdMap, constructorId)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result.skillIdMap, constructorId)?.value).toBe(
      constructorId
    );
    expect(Object.getPrototypeOf(result.skillIdMap)).toBe(null);
    expect(result.state.presets).toContainEqual(
      expect.objectContaining({ skillIds: ['constructor'] })
    );
  });

  it('replace 预览摘要会统计被移除的本机独有集合条目', () => {
    const result = planImport(
      current({ skills: [skill('local-only', 'Local Only')] }),
      bundle(),
      'replace'
    );

    const summaries = result.summary as Array<{
      category: string;
      added: number;
      updated: number;
      skipped: number;
      removed?: number;
    }>;
    expect(summaries).toContainEqual(
      expect.objectContaining({ category: 'skills', added: 0, updated: 0, skipped: 0, removed: 1 })
    );
  });
});
