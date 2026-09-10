import { describe, expect, it } from 'vitest';
import { computeTemporalBoost, detectTemporalIntent } from './temporalIntent';

describe('detectTemporalIntent（正则门）', () => {
  it('年份 / 季度 / 相对词 / 中文关键词命中，普通技术词不命中', () => {
    expect(detectTemporalIntent('what did we decide in 2020')).toEqual({
      type: 'year',
      value: '2020',
      confidence: 1,
    });
    expect(detectTemporalIntent('Q1 2024 roadmap')).toMatchObject({ type: 'year', value: '2024' });
    expect(detectTemporalIntent('Q1 plan')?.type).toBe('relative');
    expect(detectTemporalIntent('recent changes to auth')?.type).toBe('relative');
    expect(detectTemporalIntent('last year migration')?.type).toBe('relative');
    expect(detectTemporalIntent('去年数据库选型')?.type).toBe('relative');
    expect(detectTemporalIntent('OAuth2 React hooks database design')).toBeNull();
    // 端口号 / 版本号里的四位数不该被当年份：\b 保证 8080、v2024x 不命中
    expect(detectTemporalIntent('listen on 8080')).toBeNull();
  });

  it('日文单字「前」「後」不算时间意图：目前 / 前提 / 后续 / 前后 等技术表述不得命中', () => {
    for (const q of ['目前的部署流程', '前提条件', '后续优化', '前后端分离方案', '後方互換性']) {
      expect(detectTemporalIntent(q), q).toBeNull();
    }
    // 完整词仍命中
    expect(detectTemporalIntent('去年数据库选型')?.type).toBe('relative');
    expect(detectTemporalIntent('迁移之前的架构')?.type).toBe('relative');
    expect(detectTemporalIntent('来年の計画')?.type).toBe('relative');
  });
});

describe('computeTemporalBoost', () => {
  const now = new Date('2025-01-01T00:00:00Z');
  it('无 event_start 为 0', () => {
    expect(computeTemporalBoost(null, now, { type: 'year', value: '2020', confidence: 1 })).toBe(0);
  });
  it('年份匹配：base*0.3 + 0.8*conf*0.7', () => {
    // 2020-01-01 距 now 1827 天
    const base = 1 / (1 + 1827 / 365);
    expect(
      computeTemporalBoost('2020-01-01', now, { type: 'year', value: '2020', confidence: 1 })
    ).toBeCloseTo(base * 0.3 + 0.8 * 0.7, 10);
    expect(
      computeTemporalBoost('2021-01-01', now, { type: 'year', value: '2020', confidence: 1 })
    ).toBeCloseTo((1 / (1 + 1461 / 365)) * 0.3, 10);
  });
  it('relative 意图只剩 recency 基线的 30%，事件越近越高', () => {
    const intent = { type: 'relative' as const, value: null, confidence: 0.5 };
    const near = computeTemporalBoost('2024-12-31', now, intent);
    const far = computeTemporalBoost('2015-01-01', now, intent);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeCloseTo((1 / (1 + 1 / 365)) * 0.3, 10);
  });
});
