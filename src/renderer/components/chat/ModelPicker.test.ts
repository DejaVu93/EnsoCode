import type { ModelEntry, ModelMeta, ModelProvider, ThinkingLevel } from '@shared/types';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker, persistClampedThinkingLevel, resolvePickerCapabilities } from './ModelPicker';

interface WrapperProps {
  children?: ReactNode;
}

interface ClickWrapperProps extends WrapperProps {
  onClick?: () => void;
}

const harness = vi.hoisted(() => ({
  menuItemClicks: [] as Array<() => void>,
  sliderProps: null as Record<string, unknown> | null,
  switchProps: null as Record<string, unknown> | null,
  meta: {} as Record<string, unknown>,
}));

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        key
      ),
  }),
}));

vi.mock('@/stores/modelMeta', () => ({
  useModelMeta: () => harness.meta,
}));

vi.mock('@/components/ui/menu', () => {
  const Wrap = ({ children }: WrapperProps) => createElement('div', null, children);
  const MenuItem = ({ children, onClick }: ClickWrapperProps) => {
    if (onClick) harness.menuItemClicks.push(onClick);
    return createElement('div', null, children);
  };
  return {
    Menu: Wrap,
    MenuGroup: Wrap,
    MenuGroupLabel: Wrap,
    MenuItem,
    MenuPopup: Wrap,
    MenuSub: Wrap,
    MenuSubPopup: Wrap,
    MenuSubTrigger: Wrap,
    MenuTrigger: Wrap,
  };
});

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: WrapperProps) => createElement('span', null, children),
}));

vi.mock('@/components/ui/slider', () => ({
  Slider: (props: Record<string, unknown>) => {
    harness.sliderProps = props;
    return createElement('i', { 'data-slider': 'true' });
  },
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: (props: Record<string, unknown>) => {
    harness.switchProps = props;
    return createElement('i', { 'data-switch': 'true' });
  },
}));

const providers: ModelProvider[] = [
  {
    id: 'api',
    name: 'API entry',
    api: 'openai-completions',
    apiKey: 'secret',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    models: [{ id: 'model', label: 'Chosen model' }],
  },
];

const commonProps = {
  providers,
  providerId: 'api',
  modelId: 'model',
  reasoningEnabled: true,
  thinkingLevel: 'medium' as const,
  onSelect: vi.fn(),
  onReasoningChange: vi.fn(),
  onThinkingChange: vi.fn(),
};

beforeEach(() => {
  harness.menuItemClicks = [];
  harness.sliderProps = null;
  harness.switchProps = null;
  harness.meta = {};
  commonProps.onSelect.mockClear();
  commonProps.onReasoningChange.mockClear();
  commonProps.onThinkingChange.mockClear();
});

describe('ModelPicker reasoning controls mode', () => {
  it.each([
    { reasoningInherited: true, thinkingInherited: true, reasoningEnabled: true },
    { reasoningInherited: true, thinkingInherited: false, reasoningEnabled: true },
    { reasoningInherited: false, thinkingInherited: true, reasoningEnabled: false },
    { reasoningInherited: false, thinkingInherited: false, reasoningEnabled: true },
  ])('每个字段展示跟随或独立状态，不把默认预览伪装为父会话值：%j', (inheritance) => {
    const html = renderToStaticMarkup(
      createElement(ModelPicker, { ...commonProps, ...inheritance })
    );
    expect(html).toContain(
      `Reasoning: ${inheritance.reasoningInherited ? 'Follow conversation' : 'Explicit'}`
    );
    expect(html).toContain(
      `Thinking level: ${inheritance.thinkingInherited ? 'Follow conversation' : 'Explicit'}`
    );
    const hasInherited = inheritance.reasoningInherited || inheritance.thinkingInherited;
    expect(
      html.includes(
        'Inherited controls preview global defaults; actual values follow the parent conversation.'
      )
    ).toBe(hasInherited);
    expect(html.includes('data-model-picker-inherited="true"')).toBe(hasInherited);
  });

  it.each<ThinkingLevel[]>([
    ['high'],
    ['low', 'high'],
    ['minimal', 'low', 'medium', 'high'],
    ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  ])('刻度与滑块共用完整轨道百分比，单档不除零：%j', (...levels) => {
    harness.meta = {
      model: { modelId: 'model', source: 'catalog', reasoning: true, thinkingLevels: levels },
    };
    for (const [index, thinkingLevel] of levels.entries()) {
      const html = renderToStaticMarkup(
        createElement(ModelPicker, { ...commonProps, thinkingLevel })
      );
      expect(harness.sliderProps).toMatchObject({
        thumbAlignment: 'center',
        min: 0,
        max: Math.max(1, levels.length - 1),
        value: index,
        disabled: levels.length === 1,
      });
      expect(harness.sliderProps?.className).toContain('[&_[data-slot=slider-indicator]]:ms-0');
      const tickStyles = [...html.matchAll(/data-thinking-tick="[^"]+"[^>]*style="([^"]+)"/g)];
      expect(tickStyles.map((match) => match[1])).toEqual(
        levels.map((_, tickIndex) => `left:${(tickIndex / Math.max(1, levels.length - 1)) * 100}%`)
      );
    }
  });

  it.each([
    undefined,
    { modelId: 'model', source: 'unknown' as const },
    { modelId: 'model', source: 'catalog' as const },
  ])('缺失支持字段不把乐观展示当成已知能力回写：%j', (meta) => {
    const custom = resolvePickerCapabilities(providers[0], providers[0].models[0], meta);
    const oauth = resolvePickerCapabilities(
      { ...providers[0], oauthAccountKey: 'subscription' },
      providers[0].models[0],
      meta
    );
    expect(persistClampedThinkingLevel('max', custom.declaredThinkingLevels)).toBeUndefined();
    expect(persistClampedThinkingLevel('max', oauth.declaredThinkingLevels)).toBeUndefined();
    expect(oauth.reasoning).toBeUndefined();
  });

  it.each<{
    row: Partial<ModelEntry>;
    meta: ModelMeta;
    enabled: boolean;
    max?: number;
    oauth?: boolean;
  }>([
    {
      row: { reasoning: 'off' },
      meta: { modelId: 'model', source: 'catalog', reasoning: true },
      enabled: false,
    },
    {
      row: { reasoning: 'on', thinkingLevel: 'high' },
      meta: { modelId: 'model', source: 'catalog', reasoning: false, thinkingLevels: [] },
      enabled: true,
      max: 3,
    },
    {
      row: { thinkingLevel: 'xhigh' },
      meta: {
        modelId: 'model',
        source: 'catalog-fallback',
        reasoning: true,
        thinkingLevels: ['minimal', 'low'],
      },
      enabled: true,
      max: 4,
    },
    {
      row: { reasoning: 'on', thinkingLevel: 'max' },
      meta: { modelId: 'model', source: 'catalog', reasoning: false, thinkingLevels: [] },
      enabled: false,
      oauth: true,
    },
    {
      row: { reasoning: 'off', thinkingLevel: 'low' },
      meta: {
        modelId: 'model',
        source: 'catalog',
        reasoning: true,
        thinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      enabled: true,
      max: 5,
      oauth: true,
    },
  ])('自定义能力按行覆盖解析，OAuth 仅信 catalog：%j', ({ row, meta, enabled, max, oauth }) => {
    harness.meta = { model: meta };
    renderToStaticMarkup(
      createElement(ModelPicker, {
        ...commonProps,
        providers: [
          {
            ...providers[0],
            oauthAccountKey: oauth ? 'subscription' : undefined,
            models: [{ id: 'model', ...row }],
          },
        ],
      })
    );
    expect(harness.switchProps?.checked).toBe(enabled);
    expect(harness.sliderProps?.max).toBe(max);
  });

  it('选择尚无元数据的自定义模型仍按显式行上限归一化', () => {
    renderToStaticMarkup(
      createElement(ModelPicker, {
        ...commonProps,
        thinkingLevel: 'max',
        providers: [{ ...providers[0], models: [{ id: 'model', thinkingLevel: 'low' }] }],
      })
    );
    harness.menuItemClicks[0]?.();
    expect(commonProps.onThinkingChange).toHaveBeenCalledWith('low');
  });

  it('keeps reasoning and thinking controls by default for ChatView', () => {
    const html = renderToStaticMarkup(createElement(ModelPicker, commonProps));
    expect(html).toContain('Reasoning');
    expect(html).toContain('Med');
    expect(html).toContain('data-slider="true"');
  });

  it('hides session-only reasoning and thinking controls for default model settings', () => {
    const html = renderToStaticMarkup(
      createElement(ModelPicker, { ...commonProps, showReasoningControls: false })
    );
    expect(html).toContain('Chosen model');
    expect(html).not.toContain('Reasoning');
    expect(html).not.toContain('data-slider="true"');
    expect(html).not.toContain('data-switch="true"');
  });

  it('未知支持集不回写思考档；用户操作仍走 change 回调', () => {
    const onThinkingChange = vi.fn();
    renderToStaticMarkup(
      createElement(ModelPicker, {
        ...commonProps,
        thinkingLevel: 'max',
        onThinkingChange,
      })
    );
    harness.menuItemClicks[0]?.();
    expect(onThinkingChange).not.toHaveBeenCalled();

    harness.menuItemClicks = [];
    harness.sliderProps = null;
    harness.switchProps = null;
    const onReasoningChange = vi.fn();
    const onReasoningNormalize = vi.fn();
    const onThinkingNormalize = vi.fn();
    renderToStaticMarkup(
      createElement(ModelPicker, {
        ...commonProps,
        thinkingLevel: 'max',
        onReasoningChange,
        onThinkingChange,
        onReasoningNormalize,
        onThinkingNormalize,
      })
    );
    harness.menuItemClicks[0]?.();
    expect(onThinkingNormalize).not.toHaveBeenCalled();
    expect(onThinkingChange).not.toHaveBeenCalled();

    const switchProps = harness.switchProps as Record<string, unknown> | null;
    const onCheckedChange = switchProps?.onCheckedChange;
    if (typeof onCheckedChange === 'function') onCheckedChange(false);
    expect(onReasoningChange).toHaveBeenCalledWith(false);
    expect(onReasoningNormalize).not.toHaveBeenCalled();

    const sliderProps = harness.sliderProps as Record<string, unknown> | null;
    const onValueChange = sliderProps?.onValueChange;
    if (typeof onValueChange === 'function') onValueChange(1);
    expect(onThinkingChange).toHaveBeenCalledWith('low');
  });

  it('catalog 显式支持集才回写钳位档', () => {
    expect(persistClampedThinkingLevel('max', undefined)).toBeUndefined();
    expect(persistClampedThinkingLevel('max', ['low', 'high'])).toBe('high');
    expect(persistClampedThinkingLevel('high', ['low', 'high'])).toBeUndefined();
  });

  it('只渲染当前模型声明支持的思考档，normalize no-op 时仍显示钳位值', () => {
    harness.meta = {
      model: {
        modelId: 'model',
        source: 'catalog',
        reasoning: true,
        thinkingLevels: ['low', 'high'],
      },
    };
    const html = renderToStaticMarkup(
      createElement(ModelPicker, {
        ...commonProps,
        thinkingLevel: 'max',
        onThinkingNormalize: () => undefined,
      })
    );
    expect(html).toContain('>Low<');
    expect(html).toContain('>High<');
    expect(html).not.toContain('>Min<');
    expect(html).not.toContain('>Med<');
    expect(html).not.toContain('>Extra<');
    expect(html).not.toContain('>Max<');
  });

  it('模型不支持推理时 normalize no-op 也显示为关闭且隐藏滑杆', () => {
    harness.meta = {
      model: {
        modelId: 'model',
        source: 'catalog',
        reasoning: false,
        thinkingLevels: [],
      },
    };
    const html = renderToStaticMarkup(
      createElement(ModelPicker, {
        ...commonProps,
        onReasoningNormalize: () => undefined,
      })
    );
    const switchProps = harness.switchProps as Record<string, unknown> | null;
    expect(switchProps?.checked).toBe(false);
    expect(html).not.toContain('data-slider="true"');
    expect(html).not.toContain('>Med<');
  });
});
