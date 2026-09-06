import { describe, expect, it } from 'vitest';
import { formatSmartCompactSummaryModel, smartCompactInlineExtension } from './smartCompact';

describe('smartCompactInlineExtension', () => {
  it('挂 Enso compact 工厂，开关开时由 loader 内嵌加载', () => {
    const ext = smartCompactInlineExtension();
    expect(ext.name).toBe('enso-compact');
    expect(ext.hidden).toBe(true);
    expect(typeof ext.factory).toBe('function');
  });
});

describe('formatSmartCompactSummaryModel', () => {
  it('订阅走 oauthAccountKey/modelId', () => {
    expect(
      formatSmartCompactSummaryModel({
        api: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'k',
        modelId: 'claude-sonnet-4',
        settingsProviderId: 'anthropic-1',
        oauthAccountKey: 'anthropic',
      })
    ).toBe('anthropic/claude-sonnet-4');
  });

  it('自定义 API 走 worker 注册 id', () => {
    expect(
      formatSmartCompactSummaryModel({
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        modelId: 'gpt-4.1',
        settingsProviderId: 'openai-entry',
      })
    ).toMatch(/^enso-[0-9a-f]+-[0-9a-f]+\/gpt-4\.1$/);
  });
});
