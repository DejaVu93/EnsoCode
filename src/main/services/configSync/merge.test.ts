import { describe, expect, it } from 'vitest';
import { planImport } from './merge';

const provider = (id: string, name: string, apiKey?: string) => ({
  id,
  name,
  api: 'openai-completions' as const,
  ...(apiKey === undefined ? {} : { apiKey }),
  baseUrl: 'https://example.test',
  enabled: true,
  models: [],
});
const bundle = (providers: ReturnType<typeof provider>[]) => ({
  format: 'enso-config' as const,
  version: 1 as const,
  createdAt: '2025-09-05T00:00:00.000Z',
  state: {
    providers,
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
const current = (providers: ReturnType<typeof provider>[]) => ({
  providers,
  skills: [],
  mcpServers: [],
  instructions: [],
  presets: [],
  agentTypes: [],
  subagentModels: [],
});

describe('config sync merge planning', () => {
  it('合并时保留本机独有条目并为导入条目生成新增摘要', () => {
    const result = planImport(
      current([provider('local', 'Local', 'keep')]),
      bundle([provider('imported', 'Imported')]),
      'merge'
    );
    expect(result.state.providers).toEqual([
      expect.objectContaining({ id: 'local', apiKey: 'keep' }),
      expect.objectContaining({ id: 'imported' }),
    ]);
    expect(result.summary).toContainEqual({
      category: 'providers',
      added: 1,
      updated: 0,
      skipped: 0,
    });
  });

  it('导入更新省略凭证时保留本机凭证', () => {
    const result = planImport(
      current([provider('same', 'Old', 'keep-secret')]),
      bundle([provider('same', 'New')]),
      'merge'
    );
    expect(result.state.providers).toContainEqual(
      expect.objectContaining({ id: 'same', name: 'New', apiKey: 'keep-secret' })
    );
    expect(result.summary).toContainEqual({
      category: 'providers',
      added: 0,
      updated: 1,
      skipped: 0,
    });
  });
});
