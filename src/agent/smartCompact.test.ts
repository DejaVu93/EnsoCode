import { describe, expect, it } from 'vitest';
import {
  ENSO_SMART_COMPACT_CONFIG,
  formatSmartCompactSummaryModel,
  mergeSmartCompactSettings,
  smartCompactInlineExtension,
  usageForSmartCompactPlanning,
  wrapSmartCompactFactory,
} from './smartCompact';

describe('smartCompactInlineExtension', () => {
  it('挂默认工厂，开关开时由 loader 内嵌加载', () => {
    expect(smartCompactInlineExtension.name).toBe('pi-smart-compact');
    expect(smartCompactInlineExtension.hidden).toBe(true);
    expect(typeof smartCompactInlineExtension.factory).toBe('function');
  });

  it('before_compact 时把 preparation.tokensBefore 补进 getContextUsage', () => {
    let hook:
      | ((
          event: { preparation?: { tokensBefore?: number } },
          ctx: {
            getContextUsage: () => { tokens?: number | null } | undefined;
            model?: { contextWindow?: number };
          }
        ) => { tokens?: number | null } | undefined)
      | undefined;
    wrapSmartCompactFactory((pi) => {
      const on = pi.on as (name: string, fn: (...args: never[]) => unknown) => void;
      on('session_before_compact', ((
        _: unknown,
        ctx: { getContextUsage: () => { tokens?: number | null } | undefined }
      ) => ctx.getContextUsage()) as (...args: never[]) => unknown);
    })({
      on(name: string, fn: (...args: never[]) => unknown) {
        if (name === 'session_before_compact') hook = fn as typeof hook;
      },
    } as never);
    const event = { preparation: { tokensBefore: 91_490 } };
    const model = { contextWindow: 200_000 };
    expect(hook?.(event, { getContextUsage: () => undefined, model })?.tokens).toBe(91_490);
    expect(hook?.(event, { getContextUsage: () => ({ tokens: null }), model })?.tokens).toBe(
      91_490
    );
    expect(hook?.(event, { getContextUsage: () => ({ tokens: 12 }), model })?.tokens).toBe(12);
  });
});

describe('usageForSmartCompactPlanning', () => {
  it('手动 compact 把固定开销封到窗口 25%', () => {
    const usage = usageForSmartCompactPlanning({
      reason: 'manual',
      billedTokens: 194889,
      messageTokens: 58982,
      contextWindow: 256000,
    });
    expect(usage.tokens).toBe(58982 + 64_000);
    expect(usage.percent).toBeCloseTo((194889 / 256000) * 100);
  });

  it('自动门槛仍用 billed tokens', () => {
    expect(
      usageForSmartCompactPlanning({
        reason: 'threshold',
        billedTokens: 194889,
        messageTokens: 58982,
        contextWindow: 256000,
      }).tokens
    ).toBe(194889);
  });

  it('没有消息估算时回退 billed', () => {
    expect(
      usageForSmartCompactPlanning({
        reason: 'manual',
        billedTokens: 91490,
        contextWindow: 200000,
      }).tokens
    ).toBe(91490);
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

describe('mergeSmartCompactSettings', () => {
  it('只覆盖 smartCompact 安全默认，其它顶层键不动', () => {
    const merged = mergeSmartCompactSettings({
      theme: 'dark',
      smartCompact: { mode: 'thorough', requireApproval: true, extra: 1 },
    });
    expect(merged.theme).toBe('dark');
    expect(merged.smartCompact).toMatchObject({
      ...ENSO_SMART_COMPACT_CONFIG,
      extra: 1,
    });
    expect(merged.smartCompact).toEqual({
      extra: 1,
      ...ENSO_SMART_COMPACT_CONFIG,
    });
    expect((merged.smartCompact as { minContextPercent: number }).minContextPercent).toBe(0);
  });

  it('根不是对象时仍写出最小 smartCompact', () => {
    expect(mergeSmartCompactSettings(null)).toEqual({
      smartCompact: { ...ENSO_SMART_COMPACT_CONFIG },
    });
  });

  it('传入路由时写 summaryModel，清掉旧路由', () => {
    const withRoute = mergeSmartCompactSettings(
      { smartCompact: { extra: 1 } },
      { summaryModel: 'anthropic/claude-sonnet-4' }
    );
    expect(withRoute.smartCompact).toMatchObject({
      extra: 1,
      ...ENSO_SMART_COMPACT_CONFIG,
      summaryModel: 'anthropic/claude-sonnet-4',
    });
    const cleared = mergeSmartCompactSettings(
      { smartCompact: { extra: 1, summaryModel: 'old/model' } },
      { summaryModel: null }
    );
    expect(cleared.smartCompact).toMatchObject({
      extra: 1,
      ...ENSO_SMART_COMPACT_CONFIG,
    });
    expect((cleared.smartCompact as Record<string, unknown>).summaryModel).toBeUndefined();
  });

  it('路由携 mode 时覆盖默认 auto，无 mode 仍用安全默认', () => {
    const withMode = mergeSmartCompactSettings(
      { smartCompact: { extra: 1 } },
      { summaryModel: null, mode: 'balanced' }
    );
    expect((withMode.smartCompact as { mode: string }).mode).toBe('balanced');
    const fallback = mergeSmartCompactSettings(
      { smartCompact: { extra: 1 } },
      { summaryModel: null }
    );
    expect((fallback.smartCompact as { mode: string }).mode).toBe('auto');
  });
});
