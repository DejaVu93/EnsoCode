import type { EvolvesEdgeDto, MemoryListItem } from '@shared/memory/dto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyReason, isPristineEmpty, MemoryRows, PendingReviewSection } from './MemoryLibrary';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const t = (key: string, params?: Record<string, string>) =>
  params ? key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '') : key;

function item(overrides: Partial<MemoryListItem> = {}): MemoryListItem {
  return {
    id: 'm1',
    title: 'Use Postgres',
    contentSummary: 'Chosen after benchmarking',
    unitType: 'decision',
    spaceId: 'global',
    spaceLabel: 'Global',
    importance: 0.6,
    isCrystal: false,
    isLatest: true,
    lifecycleState: 'active',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    accessCount: 3,
    ...overrides,
  };
}

const edge: EvolvesEdgeDto = {
  id: 'e1',
  olderId: 'older-id-1234',
  newerId: 'newer-id-5678',
  relation: 'challenges',
  confidence: 0.8,
  reason: 'Contradicts the earlier note',
  reviewState: 'pending',
  reviewedAt: null,
  createdAt: '2025-01-03T00:00:00.000Z',
};

describe('emptyReason', () => {
  it('asks for a query in semantic mode instead of blaming the filters', () => {
    // 语义检索按相关度排序，没查询词后端直接返回空——说「没有符合筛选条件」是误导
    expect(emptyReason('semantic', '', false, false)).toBe('needs-query');
    expect(emptyReason('semantic', '   ', true, true)).toBe('needs-query');
  });

  it('falls back to the exact-mode distinction once a query exists', () => {
    expect(emptyReason('semantic', 'redis', false, false)).toBe('library-empty');
    expect(emptyReason('semantic', 'redis', true, true)).toBe('no-match');
    // 精确模式可以无查询词列全部，所以空查询不算 needs-query
    expect(emptyReason('exact', '', false, false)).toBe('library-empty');
    expect(emptyReason('exact', '', true, false)).toBe('no-match');
  });
});

describe('isPristineEmpty', () => {
  it('separates "library is empty" from "filters matched nothing"', () => {
    expect(isPristineEmpty(false, false)).toBe(true);
    expect(isPristineEmpty(false, true)).toBe(false);
    expect(isPristineEmpty(true, false)).toBe(false);
    // 统计尚未返回时不敢断言库是空的，按「无匹配」显示
    expect(isPristineEmpty(null, false)).toBe(false);
  });
});

describe('MemoryRows', () => {
  it('marks crystals and archived rows, and shows access counts', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRows, {
        t,
        onOpen: () => {},
        items: [
          item({ id: 'c1', isCrystal: true, title: 'Retrieval fuses three channels' }),
          item({ id: 'a1', lifecycleState: 'archived', title: 'Old decision' }),
        ],
      })
    );
    expect(html).toContain('★');
    expect(html).toContain('Archived');
    expect(html).toContain('Retrieval fuses three channels');
    expect(html).toContain('3 hits');
    expect(html).toContain('decision');
  });

  it('shows the caller-provided empty label instead of a bare list', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRows, {
        t,
        onOpen: () => {},
        items: [],
        emptyLabel: 'No memories match these filters.',
      })
    );
    expect(html).toContain('No memories match these filters.');
    expect(html).not.toContain('<li class="flex items-center gap-2 px-3 py-2">');
  });
});

describe('PendingReviewSection', () => {
  it('is absent when nothing is pending', () => {
    const html = renderToStaticMarkup(
      createElement(PendingReviewSection, { t, edges: [], onReview: () => {} })
    );
    expect(html).toBe('');
  });

  it('states that reviewing never deletes or supersedes anything', () => {
    const html = renderToStaticMarkup(
      createElement(PendingReviewSection, { t, edges: [edge], onReview: () => {} })
    );
    expect(html).toContain('Needs review');
    expect(html).toContain('challenges');
    expect(html).toContain('Contradicts the earlier note');
    expect(html).toContain(
      'Reviewing only records your judgement. Nothing is deleted and no memory is superseded.'
    );
    // 拒绝按钮的文案不能暗示删除
    expect(html).toContain('Dismiss');
    expect(html).not.toContain('Delete');
  });
});
